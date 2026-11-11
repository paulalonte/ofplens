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
  /** A briefing was produced and every applicable check passed. */
  pass: boolean;
  checks: CheckResult[];
}

/**
 * Grades one briefing against the case's tool data. `briefing` is null when the run produced
 * none (an API error, no JSON, a schema failure): "valid answer" then fails with `failure` and
 * the other checks do not apply, so each check's rate measures only its own thing.
 */
export function gradeBriefing(
  briefing: Briefing | null,
  reference: Reference,
  failure = 'No briefing was produced.',
): Grade {
  if (!briefing) {
    const checks = CHECK_IDS.map((id): CheckResult =>
      id === 'valid_answer'
        ? { id, pass: false, reasons: [failure] }
        : { id, pass: null, reasons: [] },
    );
    return { pass: false, checks };
  }
  const checks: CheckResult[] = [
    { id: 'valid_answer', pass: true, reasons: [] },
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
