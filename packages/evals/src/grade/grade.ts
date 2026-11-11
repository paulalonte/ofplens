import type { Briefing } from '@ofplens/agent';
import {
  checkGuardrails,
  checkHazardsInNotes,
  checkNoInventedWeather,
  checkNumbers,
  checkRisk,
  checkSaysWhatIsMissing,
  CHECK_IDS,
  type CheckId,
  type CheckResult,
} from './checks';
import type { Reference } from './reference';

export interface Grade {
  /** Every applicable check passed (and there was a briefing to check). */
  pass: boolean;
  checks: CheckResult[];
}

/**
 * Grades one briefing against the case's tool data. `briefing` is null when the run produced
 * none (an API error, no JSON, a schema failure): every check then fails with `failure`.
 */
export function gradeBriefing(
  briefing: Briefing | null,
  reference: Reference,
  failure = 'No briefing was produced.',
): Grade {
  if (!briefing) {
    const checks = CHECK_IDS.map((id): CheckResult => ({ id, pass: false, reasons: [failure] }));
    return { pass: false, checks };
  }
  const checks = [
    checkGuardrails(briefing, reference),
    checkRisk(briefing, reference),
    checkNoInventedWeather(briefing, reference),
    checkNumbers(briefing, reference),
    checkHazardsInNotes(briefing, reference),
    checkSaysWhatIsMissing(briefing, reference),
  ];
  return { pass: checks.every((c) => c.pass !== false), checks };
}

/** { guardrails: 1, risk: 0, ... } with null for not applicable, as eval results store it. */
export function gradeScores(grade: Grade): Record<CheckId | 'pass', number | null> {
  const scores = Object.fromEntries(
    grade.checks.map((c) => [c.id, c.pass === null ? null : c.pass ? 1 : 0]),
  ) as Record<CheckId, number | null>;
  return { pass: grade.pass ? 1 : 0, ...scores };
}
