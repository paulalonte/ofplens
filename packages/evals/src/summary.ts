import { CHECK_IDS, CHECK_LABELS, type CheckId } from './grade';
import type { EvalError, EvalRow } from './run';

/** Pass rates per check over a set of rows, with a 95% interval, plus cost and time. */

export interface Rate {
  passed: number;
  /** Runs the check applied to. */
  of: number;
  /** passed / of, or null when it never applied. */
  rate: number | null;
  /** Wilson 95% interval. */
  low: number | null;
  high: number | null;
}

export interface Summary {
  runs: number;
  cases: number;
  errors: number;
  /** Every check passed. */
  pass: Rate;
  checks: Record<CheckId, Rate>;
  costUsd: { total: number; perRun: number | null; unknown: number };
  latencyS: { mean: number | null; max: number | null };
}

export function wilson(passed: number, of: number): Pick<Rate, 'low' | 'high'> {
  if (of === 0) return { low: null, high: null };
  const z = 1.96;
  const p = passed / of;
  const denominator = 1 + (z * z) / of;
  const centre = (p + (z * z) / (2 * of)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / of + (z * z) / (4 * of * of))) / denominator;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

function rate(values: (number | null)[]): Rate {
  const applied = values.filter((v): v is number => v !== null);
  const passed = applied.filter((v) => v === 1).length;
  return {
    passed,
    of: applied.length,
    rate: applied.length ? passed / applied.length : null,
    ...wilson(passed, applied.length),
  };
}

export function summarize(rows: readonly EvalRow[], errors: readonly EvalError[] = []): Summary {
  const costs = rows.map((r) => r.cost_usd);
  const known = costs.filter((c): c is number => c !== null);
  const errorCost = errors.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);
  const latencies = rows.map((r) => r.latency_s);
  return {
    runs: rows.length,
    cases: new Set(rows.map((r) => r.case_id)).size,
    errors: errors.length,
    pass: rate(rows.map((r) => r.grade.pass)),
    checks: Object.fromEntries(
      CHECK_IDS.map((id) => [id, rate(rows.map((r) => r.grade[id] ?? null))]),
    ) as Record<CheckId, Rate>,
    costUsd: {
      // Failed attempts that were billed count too.
      total: known.reduce((a, b) => a + b, 0) + errorCost,
      perRun: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null,
      unknown: costs.length - known.length,
    },
    latencyS: {
      mean: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
      max: latencies.length ? Math.max(...latencies) : null,
    },
  };
}

const percent = (r: Rate) =>
  r.rate === null
    ? 'n/a'
    : `${Math.round(r.rate * 100)}% (${r.passed}/${r.of}, ${Math.round(r.low! * 100)}–${Math.round(r.high! * 100)}%)`;

/** The summary as terminal lines. */
export function formatSummary(summary: Summary): string[] {
  const width = Math.max(...Object.values(CHECK_LABELS).map((l) => l.length), 'All checks'.length);
  return [
    `${summary.runs} runs of ${summary.cases} cases${summary.errors ? `, ${summary.errors} failed attempts not scored` : ''}`,
    `${'All checks'.padEnd(width)}  ${percent(summary.pass)}`,
    ...CHECK_IDS.map((id) => `${CHECK_LABELS[id].padEnd(width)}  ${percent(summary.checks[id])}`),
    `Cost: $${summary.costUsd.total.toFixed(4)}` +
      (summary.costUsd.perRun === null ? '' : `, $${summary.costUsd.perRun.toFixed(4)} per run`) +
      (summary.costUsd.unknown ? ` (${summary.costUsd.unknown} runs not measured)` : ''),
    summary.latencyS.mean === null
      ? 'Time: not measured'
      : `Time: ${summary.latencyS.mean.toFixed(1)} s per run on average, ${summary.latencyS.max!.toFixed(1)} s at most`,
  ];
}
