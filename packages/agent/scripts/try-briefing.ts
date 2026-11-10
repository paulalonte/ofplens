/**
 * Runs real briefings with your Anthropic key and prints what came back: the briefing, tool
 * calls, tokens, cost and any guardrail failure. For tuning the system prompt (OFP-28).
 *
 *   pnpm briefing:try <planId>                 a plan saved in your dev database
 *   pnpm briefing:try ksfo-kjfk-b739-lbs       a captured plan from fixtures/ofp
 *   pnpm briefing:try --fixtures               all captured plans, one after another
 *   pnpm briefing:try --model claude-sonnet-5-5 <plan>
 *
 * Reads ANTHROPIC_API_KEY (and DATABASE_URL for saved plans) from the root .env. Live weather
 * comes from aviationweather.gov. Nothing is stored and the daily limit does not apply: every
 * run here is a paid call, so the script refuses more than 5 at once.
 *
 * Captured plans run in a temporary database that is dropped afterwards.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  createDb,
  createFlightPlanRepository,
  createPilotRepository,
  createWeatherRepository,
  type Database,
} from '@ofplens/db';
import { createTestDatabase } from '@ofplens/db/testing';
import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { createCachedWeatherClient, createWeatherClient } from '@ofplens/weather';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_BRIEFING_CONFIG, runBriefing, type BriefingRun, type ToolDeps } from '../src';

const MAX_RUNS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIXTURES_DIR = resolve(import.meta.dirname, '../../../fixtures/ofp');

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(
    'Usage: pnpm briefing:try [--model <id>] <planId | fixture name>... | --fixtures\n' +
      `Fixtures: ${fixtureNames().join(', ')}`,
  );
  process.exit(1);
}

function fixtureNames(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

// Arguments
const args = process.argv.slice(2).filter((a) => a !== '--');
let model = process.env.BRIEFING_MODEL ?? DEFAULT_BRIEFING_CONFIG.model;
const targets: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === '--model') model = args[++i] ?? usage('--model needs a model id');
  else if (arg === '--fixtures') targets.push(...fixtureNames());
  else if (arg.startsWith('-')) usage(`Unknown option ${arg}`);
  else targets.push(arg);
}
if (targets.length === 0) usage();
if (targets.length > MAX_RUNS) usage(`At most ${MAX_RUNS} briefings per run (each one is paid).`);
for (const t of targets) {
  if (!UUID.test(t) && !fixtureNames().includes(t)) usage(`Not a plan id or fixture: ${t}`);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) usage('Set ANTHROPIC_API_KEY in the root .env first.');

const client = new Anthropic({ apiKey });
const weather = createCachedWeatherClient(
  createWeatherClient(
    process.env.AVIATION_WEATHER_URL ? { baseUrl: process.env.AVIATION_WEATHER_URL } : {},
  ),
);
const depsFor = (db: Database): ToolDeps => ({
  flightPlans: createFlightPlanRepository(db),
  weatherReports: createWeatherRepository(db),
  weather,
});

// Saved plans: the dev database. Captured plans: one temporary database for all of them.
const open: {
  devDb?: ReturnType<typeof createDb>;
  scratch?: Awaited<ReturnType<typeof createTestDatabase>>;
} = {};

async function planFor(target: string): Promise<{ id: string; deps: ToolDeps }> {
  if (UUID.test(target)) {
    const url = process.env.DATABASE_URL;
    if (!url) usage('Set DATABASE_URL in the root .env to brief a saved plan.');
    open.devDb ??= createDb(url, { max: 2 });
    return { id: target, deps: depsFor(open.devDb.db) };
  }
  if (!open.scratch) {
    open.scratch = await createTestDatabase();
    await createPilotRepository(open.scratch.db).save({
      simbriefUsername: 'briefing-try',
      weightUnit: 'kgs',
    });
  }
  const raw = loadFixture(target);
  const { id } = await createFlightPlanRepository(open.scratch.db).import({
    simbriefUsername: 'briefing-try',
    plan: parseOfp(raw),
    rawOfp: raw,
  });
  return { id, deps: depsFor(open.scratch.db) };
}

const usd = (n: number | null) =>
  n === null ? 'unknown (model not in price table)' : `$${n.toFixed(5)}`;

function report(target: string, run: BriefingRun) {
  console.log(`\n=== ${target} · ${run.model} · ${run.promptVersion} ===`);
  console.log(`Status:  ${run.status === 'done' ? 'DONE' : 'FAILED'}`);
  if (run.status === 'failed') console.log(`Reason:  ${run.error}`);
  console.log(
    `Tools:   ${run.toolCalls.map((c) => `${c.name}${c.ok ? '' : ` (failed: ${c.error})`} ${c.ms} ms`).join(', ') || 'none'}`,
  );
  console.log(
    `Tokens:  ${run.inputTokens} in, ${run.outputTokens} out · ${run.turns} turns · ${(run.latencyMs / 1000).toFixed(1)} s`,
  );
  console.log(`Cost:    ${usd(run.costUsd)}`);
  if (run.status === 'done') console.log(JSON.stringify(run.briefing, null, 2));
}

const results: { target: string; run: BriefingRun }[] = [];
try {
  for (const target of targets) {
    const { id, deps } = await planFor(target);
    const run = await runBriefing(id, { client, deps, config: { model } });
    report(target, run);
    results.push({ target, run });
  }
} finally {
  await open.scratch?.destroy();
  await open.devDb?.close();
}

if (results.length > 1) {
  console.log('\n=== Summary ===');
  for (const { target, run } of results) {
    console.log(
      `${run.status === 'done' ? 'DONE  ' : 'FAILED'}  ${usd(run.costUsd).padEnd(10)}  ${target}`,
    );
  }
  const total = results.reduce((sum, { run }) => sum + (run.costUsd ?? 0), 0);
  console.log(`Total: $${total.toFixed(5)}`);
}
process.exit(results.every((r) => r.run.status === 'done') ? 0 : 1);
