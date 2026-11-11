import { formatZulu, formatZuluDate } from '@ofplens/ofp';
import type { FlightPlanHazardsResponse, HazardSource, RouteHazardView } from '@ofplens/weather';
import { useHazardRefreshState, usePlanHazards, useRefreshHazards } from '../../../api/hazards';
import { useAutoRefreshWeather } from '../../../api/weather';
import { HAZARD_LABEL, hazardLevels } from '../../../components/briefing/hazardStyle';
import { Card } from '../../../components/Card';

const SOURCE_LABEL: Record<HazardSource, string> = {
  isigmet: 'SIGMETs',
  airsigmet: 'US SIGMETs',
  gairmet: 'US G-AIRMETs',
};

/** ICAO SIGMET qualifiers, in words. Anything else (a volcano, a storm name) is shown as is. */
const QUALIFIERS: Record<string, string> = {
  EMBD: 'embedded',
  FRQ: 'frequent',
  OBSC: 'obscured',
  SQL: 'squall line',
  ISOL: 'isolated',
  OCNL: 'occasional',
  HVY: 'heavy',
};

/**
 * SIGMETs and G-AIRMETs that touch the route, between which fixes, at which levels and until
 * when, all worked out in code (area, level and time). Checked again when the stored check is
 * more than 10 minutes old, and with the weather card's Refresh.
 */
export function HazardsCard({ planId }: { planId: string }) {
  const hazards = usePlanHazards(planId);
  const refresh = useRefreshHazards(planId);
  const { running, failed } = useHazardRefreshState(planId);
  useAutoRefreshWeather(hazards.checkedAt, refresh);

  return (
    <Card
      title="Hazards along the route"
      aside={
        <span role="status" className="text-xs text-slate-500 dark:text-slate-400">
          {running
            ? 'Checking advisories…'
            : hazards.checkedAt
              ? `Checked ${formatZulu(hazards.checkedAt)}`
              : 'Not checked yet'}
        </span>
      }
    >
      {failed && (
        <p role="alert" className="mb-3 text-sm text-amber-700 dark:text-amber-400">
          Hazard advisories are unavailable right now.
          {hazards.checkedAt && ' Showing the last check.'}
        </p>
      )}
      {hazards.unavailable.length > 0 && (
        <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">
          {hazards.unavailable.map((s) => SOURCE_LABEL[s]).join(' and ')} could not be read at this
          check, so hazards from {hazards.unavailable.length > 1 ? 'them' : 'it'} may be missing.
        </p>
      )}

      {hazards.hazards.length > 0 ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {hazards.hazards.map((hazard) => (
            <HazardItem key={hazard.id} hazard={hazard} checkedAt={hazards.checkedAt} />
          ))}
        </ul>
      ) : (
        hazards.checkedAt && <NoneFound hazards={hazards} />
      )}

      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        SIGMETs and G-AIRMETs from aviationweather.gov, matched to your route by area, level and
        time
        {hazards.takeoffAt && <> (from takeoff at {formatZulu(hazards.takeoffAt)})</>}. For flight
        simulation only.
      </p>
    </Card>
  );
}

function NoneFound({ hazards }: { hazards: FlightPlanHazardsResponse }) {
  return (
    <p className="text-sm">
      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
        None on your route.
      </span>{' '}
      <span className="text-slate-600 dark:text-slate-400">
        {hazards.advisoriesChecked} advisories checked
        {hazards.checkedAt && <> at {formatZulu(hazards.checkedAt)}</>}.
      </span>
    </p>
  );
}

function HazardItem({ hazard, checkedAt }: { hazard: RouteHazardView; checkedAt: string | null }) {
  const detail = hazard.detail && (QUALIFIERS[hazard.detail] ?? hazard.detail.toLowerCase());
  return (
    <li aria-label={HAZARD_LABEL[hazard.hazard]} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{HAZARD_LABEL[hazard.hazard]}</h3>
        {hazard.severity && <SeverityBadge severity={hazard.severity} />}
        {detail && <span className="text-xs text-slate-600 dark:text-slate-400">{detail}</span>}
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          {sourceOf(hazard)}
        </span>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-slate-600 dark:text-slate-400">Route</dt>
        <dd className="font-mono">
          {hazard.segments.map((s) => `${s.fromIdent} → ${s.toIdent}`).join(', ')}
        </dd>
        <dt className="text-slate-600 dark:text-slate-400">Levels</dt>
        <dd className="font-mono">{hazardLevels(hazard)}</dd>
        <dt className="text-slate-600 dark:text-slate-400">Valid</dt>
        <dd className="font-mono">{validity(hazard, checkedAt)}</dd>
      </dl>
      {hazard.rawText && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-600 dark:text-slate-400">Bulletin</summary>
          <pre className="mt-1 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap">
            {hazard.rawText}
          </pre>
        </details>
      )}
    </li>
  );
}

function SeverityBadge({ severity }: { severity: 'moderate' | 'severe' }) {
  const style =
    severity === 'severe'
      ? 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200'
      : 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200';
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-bold tracking-wide uppercase ${style}`}>
      {severity === 'severe' ? 'Severe' : 'Moderate'}
    </span>
  );
}

/** "SIGMET · RPHI MANILA", "US convective SIGMET", "G-AIRMET". */
function sourceOf(hazard: RouteHazardView): string {
  switch (hazard.source) {
    case 'isigmet':
      return ['SIGMET', hazard.firName ?? hazard.fir].filter(Boolean).join(' · ');
    case 'airsigmet':
      return hazard.code === 'CONVECTIVE' ? 'US convective SIGMET' : 'US SIGMET';
    case 'gairmet':
      return 'G-AIRMET';
  }
}

/** "until 16:00Z", or "14:00Z to 16:00Z" when it starts later; the date when it is not today. */
function validity({ validFrom, validTo }: RouteHazardView, checkedAt: string | null): string {
  const reference = checkedAt ?? new Date().toISOString();
  const day = (iso: string) => iso.slice(0, 10);
  const at = (iso: string) =>
    day(iso) === day(reference)
      ? formatZulu(iso)
      : `${formatZuluDate(iso).slice(0, 6)} ${formatZulu(iso)}`;
  return Date.parse(validFrom) > Date.parse(reference)
    ? `${at(validFrom)} to ${at(validTo)}`
    : `until ${at(validTo)}`;
}

/** Navlog marks: for each fix inside a hazard stretch, the hazards' codes ("TS", "TURB-HI"). */
export function hazardMarks(hazards: FlightPlanHazardsResponse): Map<number, string[]> {
  const marks = new Map<number, string[]>();
  for (const hazard of hazards.hazards) {
    for (const { fromSeq, toSeq } of hazard.segments) {
      for (let seq = fromSeq; seq <= toSeq; seq++) {
        const codes = marks.get(seq) ?? [];
        if (!codes.includes(hazard.code)) codes.push(hazard.code);
        marks.set(seq, codes);
      }
    }
  }
  return marks;
}
