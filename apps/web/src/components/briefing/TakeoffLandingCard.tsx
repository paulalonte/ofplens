import {
  formatAltimeter,
  formatZulu,
  type FlightPlanSummary,
  type LandingPlan,
  type TakeoffPlan,
} from '@ofplens/ofp';
import { runwayWind, type MetarWind, type RunwayWind } from '@ofplens/weather';
import type { ReactNode } from 'react';
import { Card, Row } from '../Card';

const number = new Intl.NumberFormat('en-US');
const deg = (value: number) => `${String(value).padStart(3, '0')}°`;

/** A component that got this much worse than planned is highlighted. */
const WORSE_BY_KT = 5;

/** The latest live METAR at an airport, as far as this card uses it. */
export interface LiveConditions {
  observedAt: string | null;
  /** Null when the METAR has no wind group. */
  wind: MetarWind | null;
  temperatureC: number | null;
  altimeterInHg: number | null;
}

interface Props {
  plan: FlightPlanSummary;
  /** Saved plans pass the latest METAR per phase; sample pages show planning data only. */
  live?: { takeoff: LiveConditions | null; landing: LiveConditions | null };
}

/**
 * The planned runways with their conditions and wind components. On a saved plan the latest
 * METAR gives the main values (wind, components, temperature, QNH) with SimBrief's values at
 * dispatch under them as "Before"; without a METAR, and on sample pages, SimBrief's only.
 * Every number comes from the OFP or is worked out in code. Setup (flaps, speeds, weights) is
 * left to the aircraft, which computes its own.
 */
export function TakeoffLandingCard({ plan, live }: Props) {
  const { performance } = plan;
  if (!performance) return null;

  return (
    <Card
      title="Takeoff & landing"
      aside={
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {live ? 'Latest METAR · Before = SimBrief at dispatch' : 'SimBrief planning at dispatch'}
        </span>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        {performance.takeoff && (
          <Phase
            label="Takeoff"
            phase={performance.takeoff}
            live={live ? live.takeoff : undefined}
          />
        )}
        {performance.landing && (
          <Phase
            label="Landing"
            phase={performance.landing}
            live={live ? live.landing : undefined}
          />
        )}
      </div>
    </Card>
  );
}

function Phase({
  label,
  phase,
  live,
}: {
  label: string;
  phase: TakeoffPlan | LandingPlan;
  /** Undefined on pages without live weather; null when there is no live METAR. */
  live: LiveConditions | null | undefined;
}) {
  const length =
    'toraFt' in phase
      ? phase.toraFt !== null && `TORA ${number.format(phase.toraFt)} ft`
      : phase.ldaFt !== null && `LDA ${number.format(phase.ldaFt)} ft`;
  const now =
    live?.wind && phase.trueCourseDeg !== null ? runwayWind(live.wind, phase.trueCourseDeg) : null;

  return (
    <section aria-label={`${label} runway`} className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">
          {label}{' '}
          <span className="font-mono text-xl font-bold tracking-tight">
            {[phase.airportIcao, phase.runway].filter(Boolean).join(' ')}
          </span>
        </h3>
        {phase.surface && <SurfaceBadge surface={phase.surface} />}
        {live !== undefined && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {live?.observedAt ? `METAR ${formatZulu(live.observedAt)}` : 'No live METAR'}
          </span>
        )}
      </div>
      <dl>
        <NowFirst
          label="Wind"
          planned={
            phase.windDirDeg !== null && phase.windSpeedKt !== null
              ? `${deg(phase.windDirDeg)} / ${phase.windSpeedKt} kt`
              : null
          }
          now={live?.wind ? describeWind(live.wind) : null}
        />
        {now ? (
          <NowFirst
            label={(now.headwindKt ?? 0) < 0 ? 'Tailwind' : 'Headwind'}
            planned={describePlannedAlong(phase.headwindKt)}
            now={now.headwindKt === null ? 'variable' : `${Math.abs(now.headwindKt)} kt`}
            worse={tailwindWorse(phase, now)}
          />
        ) : (
          phase.headwindKt !== null && (
            <Line label={phase.headwindKt < 0 ? 'Tailwind' : 'Headwind'}>
              {`${Math.abs(phase.headwindKt)} kt`}
            </Line>
          )
        )}
        <NowFirst
          label="Crosswind"
          planned={crosswind(phase.crosswindKt, phase.crosswindFrom)}
          now={now && describeCrosswind(now)}
          worse={now !== null && crosswindWorse(phase, now)}
        />
        <NowFirst
          label="Temperature"
          planned={phase.temperatureC === null ? null : `${phase.temperatureC}°C`}
          now={live?.temperatureC == null ? null : `${live.temperatureC}°C`}
        />
        <NowFirst
          label="QNH"
          planned={phase.altimeterInHg === null ? null : formatAltimeter(phase.altimeterInHg)}
          now={live?.altimeterInHg == null ? null : formatAltimeter(live.altimeterInHg)}
        />
        <Line label="Runway">
          {join([
            length,
            phase.magneticCourseDeg !== null && `course ${deg(phase.magneticCourseDeg)}`,
          ])}
        </Line>
      </dl>
    </section>
  );
}

/** A row, left out entirely when there is nothing to show. */
function Line({ label, now, children }: { label: string; now?: ReactNode; children: ReactNode }) {
  const empty =
    children === null || children === undefined || children === false || children === '';
  if (empty && !now) return null;
  return (
    <Row label={label}>
      {empty ? '—' : children}
      {now}
    </Row>
  );
}

/**
 * A row with the latest METAR value as the main one and the dispatch value under it as
 * "Before"; amber when the value now is worse than planned. Planned only without a METAR.
 */
function NowFirst({
  label,
  planned,
  now,
  worse = false,
}: {
  label: string;
  planned: string | null;
  now: string | null;
  worse?: boolean;
}) {
  if (now === null) return <Line label={label}>{planned}</Line>;
  return (
    <Line
      label={label}
      now={
        <span className="block text-xs text-slate-500 dark:text-slate-400">
          Before {planned ?? '—'}
        </span>
      }
    >
      {worse ? (
        <span className="font-semibold text-amber-700 dark:text-amber-400">{now}</span>
      ) : (
        now
      )}
    </Line>
  );
}

function SurfaceBadge({ surface }: { surface: string }) {
  const style =
    surface === 'dry'
      ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
      : 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200';
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-bold tracking-wide uppercase ${style}`}>
      {surface}
    </span>
  );
}

/** "11 kt from the left", "None" */
function crosswind(kt: number | null, from: 'left' | 'right' | null): string | null {
  if (kt === null) return null;
  if (kt === 0) return 'None';
  return `${kt} kt${from ? ` from the ${from}` : ''}`;
}

/** "240° / 18G28 kt", "variable / 3 kt", "calm" (METAR directions are true). */
function describeWind(wind: MetarWind): string {
  if (wind.speedKt === 0) return 'calm';
  const direction =
    wind.variable || wind.directionDeg === null ? 'variable' : deg(wind.directionDeg);
  return `${direction} / ${wind.speedKt}${wind.gustKt === null ? '' : `G${wind.gustKt}`} kt`;
}

/** The planned component along the runway, for the "Before" line: "6 kt headwind". */
function describePlannedAlong(headwindKt: number | null): string | null {
  if (headwindKt === null) return null;
  return headwindKt < 0 ? `${-headwindKt} kt tailwind` : `${headwindKt} kt headwind`;
}

function describeCrosswind(now: RunwayWind): string {
  if (now.crosswindKt === null) return 'variable';
  const steady = crosswind(now.crosswindKt, now.crosswindFrom) ?? '';
  return now.gustCrosswindKt !== null && now.gustCrosswindKt > now.crosswindKt
    ? `${steady}, gusts ${now.gustCrosswindKt} kt`
    : steady;
}

/** A tailwind now that is new, or stronger than planned by WORSE_BY_KT. */
function tailwindWorse(phase: TakeoffPlan | LandingPlan, now: RunwayWind): boolean {
  if (now.headwindKt === null || now.headwindKt >= 0) return false;
  const plannedTail = Math.max(0, -(phase.headwindKt ?? 0));
  return -now.headwindKt >= plannedTail + WORSE_BY_KT || plannedTail === 0;
}

/** Crosswind now (gusts included) stronger than planned by WORSE_BY_KT. */
function crosswindWorse(phase: TakeoffPlan | LandingPlan, now: RunwayWind): boolean {
  const strongest = Math.max(now.crosswindKt ?? 0, now.gustCrosswindKt ?? 0);
  return strongest >= (phase.crosswindKt ?? 0) + WORSE_BY_KT;
}

const join = (parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' · ') || null;
