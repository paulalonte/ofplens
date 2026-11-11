/**
 * Grades every stored eval answer again with the current graders and rebuilds the report. For
 * after a grader change: no Claude call, no cost.
 *
 *   pnpm eval:regrade
 *
 * Needs Postgres (pnpm db:up) to rebuild each case's tool data in a temporary database.
 */
import { createTestDatabase } from '@ofplens/db/testing';
import { resolve } from 'node:path';
import { buildReport, EVAL_CASES, loadVariants, regrade } from '../src';

const RUNS_DIR = resolve(import.meta.dirname, '../runs');
const db = await createTestDatabase();
try {
  for (const variant of await loadVariants(RUNS_DIR)) {
    const { regraded, changed } = await regrade(resolve(RUNS_DIR, variant.dir), EVAL_CASES, db.db);
    console.log(`${variant.dir}: ${regraded} runs regraded, ${changed} changed`);
  }
} finally {
  await db.destroy();
}
console.log(`Report: ${await buildReport(RUNS_DIR)}`);
