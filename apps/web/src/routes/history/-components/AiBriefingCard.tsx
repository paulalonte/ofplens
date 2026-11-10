import {
  reportId,
  type Briefing,
  type Conditions,
  type StoredBriefing,
} from '@ofplens/agent/contract';
import { formatZulu, formatZuluDate } from '@ofplens/ofp';
import type { FlightPlanWeatherResponse } from '@ofplens/weather';
import { useQueryClient } from '@tanstack/react-query';
import {
  latestBriefingQuery,
  useGenerateBriefing,
  useLatestBriefing,
  type BriefingStep,
} from '../../../api/briefings';
import { ApiError } from '../../../api/client';
import { usePlanWeather } from '../../../api/weather';
import { Callout } from '../../../components/Callout';
import { Card } from '../../../components/Card';
import { FlightCategoryBadge } from './CategoryBadge';

/** What each agent tool does, for the live progress list. */
const STEP_LABEL: Record<string, string> = {
  get_flight_plan: 'Read the flight plan',
  get_planned_weather: 'Read the weather at dispatch',
  get_weather: 'Checked live weather',
};

const RISK_STYLE: Record<Briefing['overallRisk'], string> = {
  low: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
  moderate: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  high: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200',
};

const zulu = (iso: string) => `${formatZuluDate(iso).slice(0, 6)} ${formatZulu(iso)}`;

/**
 * The AI weather briefing for a saved plan. Never generated automatically: each one is a paid
 * call to Claude, so it runs only on a click. The latest stored briefing loads with the page.
 */
export function AiBriefingCard({ planId }: { planId: string }) {
  const stored = useLatestBriefing(planId);
  const generate = useGenerateBriefing(planId);
  const queryClient = useQueryClient();
  const running = generate.isPending;

  const buttonLabel = running
    ? 'Generating…'
    : !stored
      ? 'Generate briefing'
      : stored.status === 'failed'
        ? 'Try again'
        : 'Generate again';

  return (
    <Card
      title="AI weather briefing"
      aside={
        <button
          type="button"
          onClick={() => generate.mutate()}
          disabled={running || stored?.status === 'pending'}
          aria-busy={running}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {buttonLabel}
        </button>
      }
    >
      <div className="space-y-4">
        {generate.isError && !running && <StartError error={generate.error} />}

        {running ? (
          <Progress steps={generate.steps} />
        ) : !stored ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Claude reads this plan&apos;s route and the weather at dispatch and now, then writes a
            short briefing. It runs only when you click, and it never changes fuel, times or
            weights.
          </p>
        ) : stored.status === 'pending' ? (
          <div role="status" className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
            <p>A briefing started at {formatZulu(stored.createdAt)} is still being written.</p>
            <button
              type="button"
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: latestBriefingQuery(planId).queryKey,
                })
              }
              className="underline"
            >
              Check again
            </button>
          </div>
        ) : stored.status === 'failed' ? (
          <Callout tone="error">
            <p className="font-medium">The briefing could not be completed.</p>
            <p className="text-sm">{stored.error ?? 'No reason was recorded.'}</p>
          </Callout>
        ) : (
          stored.briefing && <BriefingBody planId={planId} briefing={stored.briefing} />
        )}

        <Label stored={running ? null : stored} />
      </div>
    </Card>
  );
}

function StartError({ error }: { error: Error }) {
  const code = error instanceof ApiError ? error.code : null;
  const title =
    code === 'BRIEFING_DAILY_LIMIT'
      ? 'Daily briefing limit reached'
      : code === 'BRIEFINGS_NOT_CONFIGURED'
        ? 'AI briefings are not set up'
        : code === 'BRIEFING_IN_PROGRESS'
          ? 'Already generating'
          : 'Could not start the briefing';
  return (
    <Callout tone="error">
      <p className="font-medium">{title}</p>
      <p className="text-sm">{error.message}</p>
    </Callout>
  );
}

function Progress({ steps }: { steps: BriefingStep[] }) {
  return (
    <ol role="status" aria-label="Briefing progress" className="space-y-1 text-sm">
      {steps.map((step, i) => (
        <li key={i} className={step.ok ? '' : 'text-amber-700 dark:text-amber-400'}>
          {step.ok ? '✓' : '!'} {STEP_LABEL[step.name] ?? step.name}
          {!step.ok && ' (unavailable)'}
        </li>
      ))}
      <li className="text-slate-500 dark:text-slate-400">
        {steps.length === 0 ? 'Starting…' : 'Working on the briefing…'}
      </li>
    </ol>
  );
}

function BriefingBody({ planId, briefing }: { planId: string; briefing: Briefing }) {
  const weather = usePlanWeather(planId);
  const airports: [string, Conditions | null][] = [
    ['Departure', briefing.departure],
    ['Destination', briefing.destination],
    ['Alternate', briefing.alternate],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-lg font-semibold">{briefing.headline}</p>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${RISK_STYLE[briefing.overallRisk]}`}
        >
          Risk: {briefing.overallRisk}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {airports.map(
          ([label, conditions]) =>
            conditions && (
              <AirportConditions
                key={label}
                label={label}
                conditions={conditions}
                weather={weather}
              />
            ),
        )}
      </div>

      {briefing.enrouteHazards.length > 0 && (
        <section aria-label="Enroute hazards" className="space-y-1">
          <h3 className="text-sm font-semibold">Enroute hazards</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {briefing.enrouteHazards.map((h, i) => (
              <li key={i}>
                {h.severity && `${h.severity} `}
                {h.type.replace('_', ' ')} from {h.fromWaypoint} to {h.toWaypoint}
                {h.validUntil && ` until ${formatZulu(h.validUntil)}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {briefing.pilotNotes.length > 0 && (
        <section aria-label="Pilot notes" className="space-y-1">
          <h3 className="text-sm font-semibold">Pilot notes</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {briefing.pilotNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AirportConditions({
  label,
  conditions,
  weather,
}: {
  label: string;
  conditions: Conditions;
  weather: FlightPlanWeatherResponse;
}) {
  const cited = findReport(weather, conditions.sourceReportId);
  return (
    <section
      aria-label={`${label} briefing`}
      className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {label} <span className="font-mono">{conditions.icao}</span>
        </h3>
        <FlightCategoryBadge category={conditions.flightCategory} />
      </div>
      <p className="text-sm">{conditions.summary}</p>
      {conditions.changedSinceDispatch && (
        <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
          Changed since dispatch
        </p>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-slate-600 dark:text-slate-400">
          Based on {describeReport(conditions.sourceReportId)}
        </summary>
        <pre className="mt-1 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap">
          {cited ?? conditions.sourceReportId}
        </pre>
      </details>
    </section>
  );
}

/** The raw METAR a report id points at, if the page's weather still has it. */
function findReport(weather: FlightPlanWeatherResponse, id: string): string | null {
  for (const station of weather.stations) {
    for (const source of ['dispatch', 'live'] as const) {
      const metar = station[source].metar;
      if (metar && reportId(source, 'metar', station.icao, metar.observedAt) === id) {
        return metar.raw;
      }
    }
  }
  return null;
}

/** "live:metar:EDDB:2026-11-10T0850Z" → "the live METAR of 10 NOV 08:50Z". */
function describeReport(id: string): string {
  const match = /^(dispatch|live):(metar|taf):[A-Z0-9]{4}:(\d{4}-\d\d-\d\d)T(\d\d)(\d\d)Z$/.exec(
    id,
  );
  if (!match) return id;
  const [, source, kind, date, hh, mm] = match;
  const when = zulu(`${date}T${hh}:${mm}:00Z`);
  return `the ${source === 'live' ? 'live' : 'dispatch'} ${kind?.toUpperCase()} of ${when}`;
}

/** Always shown: what this is, which model wrote it and when. */
function Label({ stored }: { stored: StoredBriefing | null }) {
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      AI-generated · for flight simulation only
      {stored && (
        <>
          {' '}
          · {stored.model} · {zulu(stored.finishedAt ?? stored.createdAt)}
        </>
      )}
    </p>
  );
}
