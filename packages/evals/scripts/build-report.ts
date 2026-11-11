/**
 * Rebuilds packages/evals/runs/report.html from the stored results, without running anything.
 *
 *   pnpm eval:report
 */
import { resolve } from 'node:path';
import { buildReport } from '../src';

console.log(`Report: ${await buildReport(resolve(import.meta.dirname, '../runs'))}`);
