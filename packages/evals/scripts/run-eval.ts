/**
 * Runs the briefing evals with your Anthropic key: every case (or a selection) a few times on one
 * model, graded by code, then prints the pass rates and rebuilds the report.
 *
 *   pnpm eval                          all cases, 3 runs each, Claude Haiku 5.5
 *   pnpm eval --case eddf-lepa-quiet   one case (repeatable); --tag hazard for a group
 *   pnpm eval --reps 1 --model claude-sonnet-5-5 --concurrency 4 --budget 2
 *   pnpm eval --dry-run                show what would run and its estimated cost, run nothing
 *   pnpm eval --yes                    do not ask before spending
 *
 * Results go to packages/evals/runs/<prompt version>__<model>/ and the report to
 * packages/evals/runs/report.html. A run that stopped part way resumes where it left off.
 * Needs Postgres (pnpm db:up) for a temporary database, dropped afterwards. Every run is a paid
 * Claude call: the estimate is shown and confirmed first, and the run stops at --budget (USD).
 */
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_BRIEFING_CONFIG, PRICES_PER_MTOK, PROMPT_VERSION } from '@ofplens/agent';
import { createTestDatabase } from '@ofplens/db/testing';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  buildReport,
  EVAL_CASES,
  formatSummary,
  loadVariants,
  readErrors,
  readRows,
  runEval,
  summarize,
} from '../src';

const RUNS_DIR = resolve(import.meta.dirname, '../runs');

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(
    'Usage: pnpm eval [--case <id>]... [--tag <tag>] [--reps N] [--model <id>] [--concurrency N]\n' +
      '                 [--timeout-s N] [--budget USD] [--dry-run] [--yes]',
  );
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const opts = {
  cases: [] as string[],
  tag: null as string | null,
  reps: 3,
  model: process.env.BRIEFING_MODEL ?? DEFAULT_BRIEFING_CONFIG.model,
  concurrency: 4,
  timeoutS: 180,
  budget: 1,
  dryRun: false,
  yes: false,
};
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  const value = () => args[++i] ?? usage(`${arg} needs a value`);
  const number = () => {
    const n = Number(value());
    if (!Number.isFinite(n) || n <= 0) usage(`${arg} needs a positive number`);
    return n;
  };
  if (arg === '--case') opts.cases.push(value());
  else if (arg === '--tag') opts.tag = value();
  else if (arg === '--reps') opts.reps = Math.round(number());
  else if (arg === '--model') opts.model = value();
  else if (arg === '--concurrency') opts.concurrency = Math.round(number());
  else if (arg === '--timeout-s') opts.timeoutS = number();
  else if (arg === '--budget') opts.budget = number();
  else if (arg === '--dry-run') opts.dryRun = true;
  else if (arg === '--yes') opts.yes = true;
  else usage(`Unknown option ${arg}`);
}

const unknown = opts.cases.filter((id) => !EVAL_CASES.some((c) => c.id === id));
if (unknown.length) usage(`No such case: ${unknown.join(', ')}`);
const cases = EVAL_CASES.filter(
  (c) =>
    (opts.cases.length === 0 || opts.cases.includes(c.id)) &&
    (opts.tag === null || c.tags.includes(opts.tag)),
);
if (cases.length === 0) usage('No case matches.');

const outDir = resolve(RUNS_DIR, `${PROMPT_VERSION}__${opts.model}`);
const finished = new Set((await readRows(outDir)).map((r) => `${r.case_id}#${r.rep}`));
const runs = cases.flatMap((c) =>
  Array.from({ length: opts.reps }, (_, rep) => `${c.id}#${rep}`).filter((k) => !finished.has(k)),
).length;

// Cost per run: measured on earlier runs of this model if there are any, else a rough guess
// from the price table (about 25,000 tokens in and 2,500 out per briefing).
const measured = (await loadVariants(RUNS_DIR))
  .filter((v) => v.model === opts.model)
  .flatMap((v) => v.rows.map((r) => r.cost_usd))
  .filter((c): c is number => c !== null);
const price = PRICES_PER_MTOK[opts.model];
const perRun = measured.length
  ? measured.reduce((a, b) => a + b, 0) / measured.length
  : price
    ? (25_000 * price.input + 2_500 * price.output) / 1_000_000
    : null;
const basis = measured.length
  ? `measured on ${measured.length} earlier runs`
  : price
    ? 'a rough guess: no runs of this model yet'
    : 'unknown: the model is not in the price table';

console.log(
  `${PROMPT_VERSION} on ${opts.model}: ${cases.length} cases × ${opts.reps} runs` +
    (finished.size ? `, ${runs} left to run` : ` = ${runs} runs`),
);
console.log(
  perRun === null
    ? `Estimated cost: unknown (${basis}). Budget: $${opts.budget.toFixed(2)}.`
    : `Estimated cost: ${runs} × $${perRun.toFixed(4)} ≈ $${(runs * perRun).toFixed(2)} (${basis}). Budget: $${opts.budget.toFixed(2)}.`,
);
if (opts.dryRun || runs === 0) {
  if (runs === 0) console.log('Nothing left to run. Report: ' + (await buildReport(RUNS_DIR)));
  process.exit(0);
}
if (perRun !== null && runs * perRun > opts.budget) {
  usage(`The estimate is over the budget. Run fewer cases or raise --budget.`);
}
if (!opts.yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const reply = await rl.question('Run it? These are paid Claude calls. [y/N] ');
  rl.close();
  if (!/^y(es)?$/i.test(reply.trim())) process.exit(0);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) usage('Set ANTHROPIC_API_KEY in the root .env first.');
// The SDK retries 429 and 529 (overloaded) with backoff; a run still failing is not scored.
const client = new Anthropic({ apiKey, maxRetries: 4 });

const db = await createTestDatabase();
const started = Date.now();
try {
  const result = await runEval({
    cases,
    reps: opts.reps,
    model: opts.model,
    promptVersion: PROMPT_VERSION,
    concurrency: opts.concurrency,
    timeoutMs: opts.timeoutS * 1000,
    budgetUsd: opts.budget,
    outDir,
    client,
    db: db.db,
    log: (line) => console.log(line),
  });
  console.log(
    `\nRan ${result.ran} in ${((Date.now() - started) / 1000).toFixed(0)} s, spent $${result.spentUsd.toFixed(4)}` +
      (result.errors
        ? `; ${result.errors} attempts failed and were not scored (they run again next time)`
        : '') +
      (result.stoppedForBudget ? '; stopped at the budget' : '') +
      '.',
  );
} finally {
  await db.destroy();
}

const summary = summarize(await readRows(outDir), await readErrors(outDir));
console.log(`\n=== ${PROMPT_VERSION} · ${opts.model} (all runs so far) ===`);
for (const line of formatSummary(summary)) console.log(line);
console.log(`\nReport: ${await buildReport(RUNS_DIR)}`);
