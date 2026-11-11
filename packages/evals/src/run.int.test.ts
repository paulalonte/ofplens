import Anthropic from '@anthropic-ai/sdk';
import { createTestDatabase, type TestDatabase } from '@ofplens/db/testing';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EVAL_CASES } from './cases';
import { oracleBriefing, type Reference } from './grade';
import { buildReport } from './report';
import { readErrors, readRows, regrade, runEval, type RunEvalOptions } from './run';
import { summarize } from './summary';

/**
 * The eval runner end to end with a scripted Claude (no network, no cost): it calls the four
 * tools, reads their results from the request and answers with the case's model answer,
 * changed by `tweak`.
 */
const TOOLS = ['get_flight_plan', 'get_planned_weather', 'get_weather', 'get_route_hazards'];

interface Fake {
  model?: string;
  error?: number;
  hang?: boolean;
  tweak?: (briefing: ReturnType<typeof oracleBriefing>) => void;
}

function scriptedClaude(fake: Fake = {}): Anthropic {
  const fetch = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (fake.hang) return new Promise<Response>(() => {});
    if (fake.error) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'down' } }),
          {
            status: fake.error,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    }
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      model: string;
      messages: { role: string; content: unknown }[];
    };
    const last = body.messages.at(-1)!;
    const results = Array.isArray(last.content)
      ? (last.content as { type: string; tool_use_id: string; content: unknown }[]).filter(
          (b) => b.type === 'tool_result',
        )
      : [];
    const content =
      results.length === 0
        ? TOOLS.map((name) => ({ type: 'tool_use', id: `toolu_${name}`, name, input: {} }))
        : [{ type: 'text', text: JSON.stringify(answerFrom(results)) }];
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: fake.model ?? body.model,
          content,
          stop_reason: results.length === 0 ? 'tool_use' : 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10_000, output_tokens: 1_000 },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
  };

  const answerFrom = (results: { tool_use_id: string; content: unknown }[]) => {
    const text = (c: unknown) =>
      typeof c === 'string' ? c : (c as { text: string }[]).map((b) => b.text).join('');
    const reference = Object.fromEntries(
      results.map((r) => [r.tool_use_id.replace('toolu_', ''), JSON.parse(text(r.content))]),
    ) as unknown as Reference;
    const briefing = oracleBriefing(reference);
    fake.tweak?.(briefing);
    return briefing;
  };

  return new Anthropic({ apiKey: 'test-key', fetch, maxRetries: 0 });
}

let testDb: TestDatabase;
let outDir: string;
beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await testDb.destroy();
});
beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'ofplens-eval-'));
  return () => rm(outDir, { recursive: true, force: true });
});

const cases = EVAL_CASES.filter((c) =>
  ['eddb-eddm-ts-sigmet', 'eddf-lepa-hazard-feeds-down', 'egll-kjfk-alternate-fog'].includes(c.id),
);
const options = (client: Anthropic, more: Partial<RunEvalOptions> = {}): RunEvalOptions => ({
  cases,
  reps: 2,
  model: 'claude-haiku-5-5',
  promptVersion: 'briefing-test',
  concurrency: 3,
  timeoutMs: 30_000,
  budgetUsd: 10,
  outDir,
  client,
  db: testDb.db,
  ...more,
});

describe('runEval', () => {
  it('runs, grades and writes every case and rep, then resumes without repeating', async () => {
    const result = await runEval(options(scriptedClaude()));
    expect(await readErrors(outDir)).toEqual([]);
    expect(result).toMatchObject({ ran: 6, skipped: 0, errors: 0, stoppedForBudget: false });
    expect(result.spentUsd).toBeCloseTo((6 * 2 * (10_000 * 0.1 + 1_000 * 0.5)) / 1e6, 6);

    const rows = await readRows(outDir);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row).toMatchObject({
        model: 'claude-haiku-5-5',
        status: 'ok',
        run_error: null,
        tool_calls: 4,
        turns: 2,
        usage: { input_tokens: 20_000, output_tokens: 2_000 },
      });
      expect(row.grade.pass).toBe(1);
      expect(row.cost_usd).toBeGreaterThan(0);
      expect(row.latency_s).toBeGreaterThan(0);
      const trace = JSON.parse(await readFile(join(outDir, row.trace), 'utf8')) as {
        role: string;
        name?: string;
      }[];
      expect(trace.map((t) => t.role)).toEqual([
        'system',
        'user',
        'tool_call',
        'tool_result',
        'tool_call',
        'tool_result',
        'tool_call',
        'tool_result',
        'tool_call',
        'tool_result',
        'assistant',
      ]);
    }
    expect(summarize(rows).pass).toMatchObject({ passed: 6, of: 6, rate: 1 });
    expect(JSON.parse(await readFile(join(outDir, 'meta.json'), 'utf8'))).toEqual({
      promptVersion: 'briefing-test',
      model: 'claude-haiku-5-5',
    });

    const again = await runEval(options(scriptedClaude()));
    expect(again).toMatchObject({ ran: 0, skipped: 6 });
    expect(await readRows(outDir)).toHaveLength(6);
  });

  it('grades a briefing the guardrails rejected, with the run failure as the reason', async () => {
    await runEval(
      options(
        scriptedClaude({
          tweak: (b) => {
            b.enrouteHazards = [];
          },
        }),
        { cases: cases.slice(0, 1), reps: 1 },
      ),
    );
    const [row] = await readRows(outDir);
    expect(row!.run_error).toMatch(/^Guardrails rejected the briefing/);
    expect(row!.grade).toMatchObject({
      pass: 0,
      valid_answer: 1,
      guardrails: 0,
      risk: 1,
      hazards_in_notes: 1,
    });
    expect(row!.answer?.enrouteHazards).toEqual([]);
    expect(row!.reasons.guardrails!.join(' ')).toContain('missing from enrouteHazards');
  });

  it('keeps API errors, wrong models and timeouts out of the scores, and runs them again later', async () => {
    const one = { cases: cases.slice(0, 1), reps: 1 };
    await runEval(options(scriptedClaude({ error: 529 }), one));
    await runEval(options(scriptedClaude({ model: 'claude-sonnet-5-5' }), one));
    await runEval(options(scriptedClaude({ hang: true }), { ...one, timeoutMs: 50 }));

    expect(await readRows(outDir)).toEqual([]);
    const errors = await readErrors(outDir);
    expect(errors.map((e) => e.class)).toEqual(['api_error', 'model_mismatch', 'timeout']);
    expect(errors[1]).toMatchObject({
      model: 'claude-sonnet-5-5',
      message: 'Asked for claude-haiku-5-5, answered by claude-sonnet-5-5.',
    });
    expect(errors[1]!.cost_usd).toBeGreaterThan(0);

    const retry = await runEval(options(scriptedClaude(), one));
    expect(retry).toMatchObject({ ran: 1, errors: 0 });
    expect(summarize(await readRows(outDir), errors).errors).toBe(3);
  });

  it('stops starting runs once the budget is spent', async () => {
    const result = await runEval(
      options(scriptedClaude(), { concurrency: 1, budgetUsd: 0.000001 }),
    );
    expect(result).toMatchObject({ ran: 1, stoppedForBudget: true });
  });

  it('builds a report with every case, escaped, linking traces inside the runs folder', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'ofplens-runs-'));
    try {
      await runEval(
        options(scriptedClaude(), {
          outDir: join(runsDir, 'briefing-test__claude-haiku-5-5'),
          reps: 1,
        }),
      );
      const html = await readFile(await buildReport(runsDir), 'utf8');
      expect(html).toContain('Content-Security-Policy');
      expect(html).toContain('briefing-test');
      for (const c of EVAL_CASES) expect(html).toContain(c.id);
      expect(html).toContain(
        'href="briefing-test__claude-haiku-5-5/traces/eddb-eddm-ts-sigmet_rep0.json"',
      );
      expect(html).not.toMatch(/<script/i);
      expect(existsSync(join(runsDir, 'report.html'))).toBe(true);
    } finally {
      await rm(runsDir, { recursive: true, force: true });
    }
  });
});

describe('regrade', () => {
  it('grades stored answers again without calling Claude', async () => {
    await runEval(options(scriptedClaude(), { cases: cases.slice(0, 1), reps: 1 }));
    // As if a grader had been stricter when the row was written.
    const path = join(outDir, 'results.jsonl');
    const [row] = await readRows(outDir);
    await writeFile(
      path,
      JSON.stringify({ ...row, grade: { ...row!.grade, pass: 0, risk: 0 } }) + '\n',
    );

    expect(await regrade(outDir, cases, testDb.db)).toEqual({ regraded: 1, changed: 1 });
    expect((await readRows(outDir))[0]!.grade).toMatchObject({ pass: 1, risk: 1 });
  });
});
