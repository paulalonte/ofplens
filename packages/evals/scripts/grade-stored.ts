/**
 * Grades the briefings already stored in your dev database (made by the app or the API), each
 * against the tool results of its own run. Read-only, and no Claude call: a free look at how
 * real briefings score.
 *
 *   pnpm eval:stored              the 10 most recent finished briefings
 *   pnpm eval:stored --limit 30
 *
 * Reads DATABASE_URL from the root .env. Briefings from before get_route_hazards existed
 * (prompt v1 and v2) are skipped.
 */
import type { Briefing, ToolCallRecord } from '@ofplens/agent';
import { createDb, schema } from '@ofplens/db';
import { desc, eq } from 'drizzle-orm';
import { CHECK_LABELS, gradeBriefing, type Reference } from '../src';

const args = process.argv.slice(2).filter((a) => a !== '--');
const limitAt = args.indexOf('--limit');
const limit = limitAt === -1 ? 10 : Number(args[limitAt + 1]);
const url = process.env.DATABASE_URL;
if (!url || !Number.isInteger(limit) || limit < 1) {
  console.error('Usage: pnpm eval:stored [--limit N]   (needs DATABASE_URL in the root .env)');
  process.exit(1);
}

const TOOLS = ['get_flight_plan', 'get_planned_weather', 'get_weather', 'get_route_hazards'];
const { db, close } = createDb(url, { max: 1 });
try {
  const rows = await db
    .select({
      id: schema.briefings.id,
      createdAt: schema.briefings.createdAt,
      model: schema.briefings.model,
      promptVersion: schema.briefings.promptVersion,
      output: schema.briefings.output,
      toolCalls: schema.briefings.toolCalls,
      origin: schema.flightPlans.originIcao,
      destination: schema.flightPlans.destinationIcao,
    })
    .from(schema.briefings)
    .innerJoin(schema.flightPlans, eq(schema.flightPlans.id, schema.briefings.flightPlanId))
    .where(eq(schema.briefings.status, 'done'))
    .orderBy(desc(schema.briefings.createdAt))
    .limit(limit);

  let graded = 0;
  let passed = 0;
  for (const row of rows) {
    const calls = (row.toolCalls ?? []) as ToolCallRecord[];
    const outputs = Object.fromEntries(
      calls.filter((c) => c.ok && TOOLS.includes(c.name)).map((c) => [c.name, c.output]),
    );
    const title = `${row.createdAt.toISOString().slice(0, 16)}Z  ${row.origin} → ${row.destination}  ${row.model} ${row.promptVersion}`;
    if (TOOLS.some((t) => !(t in outputs))) {
      console.log(`\n${title}\n  skipped: the run did not call all four tools`);
      continue;
    }
    const grade = gradeBriefing(row.output as Briefing, outputs as unknown as Reference);
    graded += 1;
    if (grade.pass) passed += 1;
    console.log(`\n${title}\n  ${grade.pass ? 'PASS' : 'FAIL'}`);
    for (const check of grade.checks) {
      const mark = check.pass === null ? 'n/a ' : check.pass ? 'ok  ' : 'FAIL';
      console.log(`  ${mark} ${CHECK_LABELS[check.id]}`);
      for (const reason of check.reasons) console.log(`         ${reason}`);
    }
  }
  console.log(`\n${passed} of ${graded} graded briefings passed every check.`);
} finally {
  await close();
}
