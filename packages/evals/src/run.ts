import {
  runBriefing,
  SYSTEM_PROMPT,
  USER_PROMPT,
  type Briefing,
  type BriefingRun,
} from '@ofplens/agent';
import type { Database } from '@ofplens/db';
import type Anthropic from '@anthropic-ai/sdk';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvalCase } from './case';
import { gradeBriefing, gradeScores, type CheckId, type Grade, type Reference } from './grade';
import { ensureEvalPilot, prepareCase, runAllTools } from './setup';

/**
 * Runs eval cases through the real briefing agent, grades each answer and writes the results:
 *
 *   <outDir>/meta.json           what was run (prompt version, model)
 *   <outDir>/results.jsonl       one row per scored run, written as each one finishes
 *   <outDir>/errors.jsonl        attempts that never produced a gradable answer (API errors
 *                                after retries, time limit, wrong model), not scored
 *   <outDir>/traces/<case>_rep<k>.json   the exchange: prompts, tool calls and results, answer
 *
 * Resumes: a (case, rep) already in results.jsonl is not run again.
 */

export interface EvalRow {
  case_id: string;
  rep: number;
  tags: string[];
  /** The model that answered, as the API reported it. */
  model: string;
  prompt_version: string;
  status: 'ok';
  /** 1/0 per check (null: not applicable), and `pass` for all of them. */
  grade: Record<CheckId | 'pass', number | null>;
  /** Why each failed check failed. */
  reasons: Partial<Record<CheckId, string[]>>;
  /** The run's own failure (guardrails, schema, refusal...) when it did not finish as done. */
  run_error: string | null;
  /** The briefing graded: the run's, or the one its guardrails rejected; null when none. */
  answer: Briefing | null;
  cost_usd: number | null;
  usage: { input_tokens: number; output_tokens: number };
  latency_s: number;
  tool_calls: number;
  turns: number;
  trace: string;
  finished_at: string;
}

export interface EvalError {
  case_id: string;
  rep: number;
  class: 'api_error' | 'timeout' | 'model_mismatch' | 'harness_error';
  message: string;
  model: string | null;
  cost_usd: number | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  at: string;
}

export interface RunEvalOptions {
  cases: readonly EvalCase[];
  reps: number;
  model: string;
  promptVersion: string;
  /** Runs at the same time. */
  concurrency: number;
  /** A run taking longer is recorded as a timeout (its request may still finish unseen). */
  timeoutMs: number;
  /** Stop starting new runs once this much has been spent (USD, measured). */
  budgetUsd: number;
  outDir: string;
  client: Anthropic;
  /** A scratch database for the cases' plans. */
  db: Database;
  log?: (line: string) => void;
}

export interface RunEvalResult {
  ran: number;
  skipped: number;
  errors: number;
  spentUsd: number;
  stoppedForBudget: boolean;
}

export async function readRows(outDir: string): Promise<EvalRow[]> {
  return readJsonl<EvalRow>(join(outDir, 'results.jsonl'));
}

export async function readErrors(outDir: string): Promise<EvalError[]> {
  return readJsonl<EvalError>(join(outDir, 'errors.jsonl'));
}

async function readJsonl<T>(path: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

export async function runEval(options: RunEvalOptions): Promise<RunEvalResult> {
  const { cases, reps, outDir, log = () => {} } = options;
  await mkdir(join(outDir, 'traces'), { recursive: true });
  await writeFile(
    join(outDir, 'meta.json'),
    JSON.stringify({ promptVersion: options.promptVersion, model: options.model }, null, 2) + '\n',
  );

  const done = new Set((await readRows(outDir)).map((r) => `${r.case_id}#${r.rep}`));
  const todo = cases.flatMap((c) =>
    Array.from({ length: reps }, (_, rep) => ({ evalCase: c, rep })).filter(
      ({ rep }) => !done.has(`${c.id}#${rep}`),
    ),
  );
  const result: RunEvalResult = {
    ran: 0,
    skipped: cases.length * reps - todo.length,
    errors: 0,
    spentUsd: 0,
    stoppedForBudget: false,
  };

  // The tools' answers for each case, computed once: what the graders judge against.
  const references = new Map<string, Promise<Reference>>();
  const referenceFor = (c: EvalCase) => {
    let ref = references.get(c.id);
    if (!ref) {
      ref = prepareCase(options.db, c).then(
        async (p) => (await runAllTools(p)) as unknown as Reference,
      );
      references.set(c.id, ref);
    }
    return ref;
  };

  // Before the runs start in parallel: their first pilot saves would otherwise race.
  await ensureEvalPilot(options.db);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      if (result.spentUsd >= options.budgetUsd) {
        result.stoppedForBudget = true;
        return;
      }
      const { evalCase, rep } = todo[next++]!;
      const outcome = await runOne(evalCase, rep, options, referenceFor);
      result.spentUsd += outcome.costUsd ?? 0;
      if (outcome.kind === 'row') {
        result.ran += 1;
        await appendFile(join(outDir, 'results.jsonl'), JSON.stringify(outcome.row) + '\n');
        log(
          `${outcome.row.grade.pass ? 'PASS' : 'FAIL'}  ${evalCase.id} #${rep}  ` +
            `$${(outcome.row.cost_usd ?? 0).toFixed(4)}  ${outcome.row.latency_s.toFixed(1)} s`,
        );
      } else {
        result.errors += 1;
        await appendFile(join(outDir, 'errors.jsonl'), JSON.stringify(outcome.error) + '\n');
        log(`ERROR ${evalCase.id} #${rep}  ${outcome.error.class}: ${outcome.error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
  return result;
}

type Outcome =
  | { kind: 'row'; row: EvalRow; costUsd: number | null }
  | { kind: 'error'; error: EvalError; costUsd: number | null };

async function runOne(
  evalCase: EvalCase,
  rep: number,
  options: RunEvalOptions,
  referenceFor: (c: EvalCase) => Promise<Reference>,
): Promise<Outcome> {
  const at = () => new Date().toISOString();
  const error = (cls: EvalError['class'], message: string, run: BriefingRun | null): Outcome => ({
    kind: 'error',
    costUsd: run?.costUsd ?? null,
    error: {
      case_id: evalCase.id,
      rep,
      class: cls,
      message,
      model: run?.responseModel ?? null,
      cost_usd: run?.costUsd ?? null,
      usage: run ? { input_tokens: run.inputTokens, output_tokens: run.outputTokens } : null,
      at: at(),
    },
  });

  let run: BriefingRun;
  let reference: Reference;
  try {
    reference = await referenceFor(evalCase);
    const prepared = await prepareCase(options.db, evalCase);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), options.timeoutMs);
    });
    const answer = await Promise.race([
      runBriefing(prepared.flightPlanId, {
        client: options.client,
        deps: prepared.deps,
        config: { model: options.model },
      }),
      timeout,
    ]).finally(() => clearTimeout(timer));
    if (answer === 'timeout') {
      return error('timeout', `No answer within ${options.timeoutMs / 1000} s.`, null);
    }
    run = answer;
  } catch (err) {
    return error('harness_error', err instanceof Error ? err.message : String(err), null);
  }

  // Failures that say nothing about the model: not scored, and retried on the next resume.
  if (run.status === 'failed' && /^(Claude API error|Briefing run failed)/.test(run.error)) {
    return error('api_error', run.error, run);
  }
  if (run.responseModel && !run.responseModel.startsWith(options.model)) {
    return error(
      'model_mismatch',
      `Asked for ${options.model}, answered by ${run.responseModel}.`,
      run,
    );
  }

  const briefing: Briefing | null =
    run.status === 'done' ? run.briefing : (run.rejectedBriefing ?? null);
  const grade = gradeBriefing(briefing, reference, run.status === 'failed' ? run.error : undefined);
  const trace = `traces/${evalCase.id}_rep${rep}.json`;
  await writeFile(join(options.outDir, trace), JSON.stringify(traceOf(run, briefing), null, 2));

  return {
    kind: 'row',
    costUsd: run.costUsd,
    row: {
      case_id: evalCase.id,
      rep,
      tags: evalCase.tags,
      model: run.responseModel ?? options.model,
      prompt_version: run.promptVersion,
      status: 'ok',
      ...gradeFields(grade),
      run_error: run.status === 'failed' ? run.error : null,
      answer: briefing,
      cost_usd: run.costUsd,
      usage: { input_tokens: run.inputTokens, output_tokens: run.outputTokens },
      latency_s: run.latencyMs / 1000,
      tool_calls: run.toolCalls.length,
      turns: run.turns,
      trace,
      finished_at: at(),
    },
  };
}

interface Turn {
  role: 'system' | 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  name?: string;
}

/** The exchange as far as the run records it: prompts, each tool call and result, the answer. */
function traceOf(run: BriefingRun, briefing: Briefing | null): Turn[] {
  const turns: Turn[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_PROMPT },
  ];
  for (const call of run.toolCalls) {
    turns.push({ role: 'tool_call', name: call.name, content: '{}' });
    turns.push({
      role: 'tool_result',
      name: call.name,
      content: call.ok ? JSON.stringify(call.output, null, 2) : `Error: ${call.error ?? ''}`,
    });
  }
  const answer = briefing ? JSON.stringify(briefing, null, 2) : '(no briefing)';
  turns.push({
    role: 'assistant',
    content: run.status === 'failed' ? `${answer}\n\nRun failed: ${run.error}` : answer,
  });
  return turns;
}

function gradeFields(grade: Grade): Pick<EvalRow, 'grade' | 'reasons'> {
  return {
    grade: gradeScores(grade),
    reasons: Object.fromEntries(
      grade.checks.filter((c) => c.reasons.length > 0).map((c) => [c.id, c.reasons]),
    ),
  };
}

/**
 * Grades the stored answers again with the current graders (after a grader change), without
 * calling Claude. Rows from before answers were stored read theirs from the trace.
 */
export async function regrade(
  outDir: string,
  cases: readonly EvalCase[],
  db: Database,
): Promise<{ regraded: number; changed: number }> {
  const rows = await readRows(outDir);
  const references = new Map<string, Reference>();
  let changed = 0;
  const updated: EvalRow[] = [];
  for (const row of rows) {
    const evalCase = cases.find((c) => c.id === row.case_id);
    if (!evalCase) {
      updated.push(row);
      continue;
    }
    if (!references.has(evalCase.id)) {
      const prepared = await prepareCase(db, evalCase);
      references.set(evalCase.id, (await runAllTools(prepared)) as unknown as Reference);
    }
    const answer = row.answer !== undefined ? row.answer : await answerFromTrace(outDir, row.trace);
    const grade = gradeBriefing(answer, references.get(evalCase.id)!, row.run_error ?? undefined);
    const next = { ...row, answer, ...gradeFields(grade) };
    if (JSON.stringify(next.grade) !== JSON.stringify(row.grade)) changed += 1;
    updated.push(next);
  }
  await writeFile(
    join(outDir, 'results.jsonl'),
    updated.map((r) => JSON.stringify(r)).join('\n') + (updated.length ? '\n' : ''),
  );
  return { regraded: rows.length, changed };
}

async function answerFromTrace(outDir: string, trace: string): Promise<Briefing | null> {
  try {
    const turns = JSON.parse(await readFile(join(outDir, trace), 'utf8')) as Turn[];
    const text = turns.at(-1)?.content.split('\n\nRun failed: ')[0] ?? '';
    return text.startsWith('{') ? (JSON.parse(text) as Briefing) : null;
  } catch {
    return null;
  }
}
