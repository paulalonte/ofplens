import {
  formatAltimeter,
  type FlightPlanSummary,
  type LandingPlan,
  type TakeoffPlan,
} from '@ofplens/ofp';
import type { ReactNode } from 'react';
import { Card, Row } from '../Card';

const number = new Intl.NumberFormat('en-US');
const deg = (value: number) => `${String(value).padStart(3, '0')}°`;

/**
 * The planned runways as SimBrief computed them at dispatch: conditions and wind components.
 * Planning data, not live weather; every number comes from the OFP. Setup (flaps, speeds,
 * weights) is left to the aircraft, which computes its own.
 */
export function TakeoffLandingCard({ plan }: { plan: FlightPlanSummary }) {
  const { performance } = plan;
  if (!performance) return null;

  return (
    <Card
      title="Takeoff & landing"
      aside={
        <span className="text-xs text-slate-500 dark:text-slate-400">
          SimBrief planning at dispatch
        </span>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        {performance.takeoff && <Phase label="Takeoff" phase={performance.takeoff} />}
        {performance.landing && <Phase label="Landing" phase={performance.landing} />}
      </div>
    </Card>
  );
}

function Phase({ label, phase }: { label: string; phase: TakeoffPlan | LandingPlan }) {
  const length =
    'toraFt' in phase
      ? phase.toraFt !== null && `TORA ${number.format(phase.toraFt)} ft`
      : phase.ldaFt !== null && `LDA ${number.format(phase.ldaFt)} ft`;
  return (
    <section aria-label={`${label} runway`} className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">
          {label}{' '}
          <span className="font-mono">
            {[phase.airportIcao, phase.runway].filter(Boolean).join(' ')}
          </span>
        </h3>
        {phase.surface && <SurfaceBadge surface={phase.surface} />}
      </div>
      <dl>
        <Line label="Wind">
          {phase.windDirDeg !== null && phase.windSpeedKt !== null
            ? `${deg(phase.windDirDeg)} / ${phase.windSpeedKt} kt`
            : null}
        </Line>
        {phase.headwindKt !== null && (
          <Line label={phase.headwindKt < 0 ? 'Tailwind' : 'Headwind'}>
            {`${Math.abs(phase.headwindKt)} kt`}
          </Line>
        )}
        <Line label="Crosswind">{crosswind(phase)}</Line>
        <Line label="Temperature">
          {phase.temperatureC === null ? null : `${phase.temperatureC}°C`}
        </Line>
        <Line label="QNH">
          {phase.altimeterInHg === null ? null : formatAltimeter(phase.altimeterInHg)}
        </Line>
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
function Line({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === false || children === '')
    return null;
  return <Row label={label}>{children}</Row>;
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
function crosswind(phase: TakeoffPlan | LandingPlan): string | null {
  if (phase.crosswindKt === null) return null;
  if (phase.crosswindKt === 0) return 'None';
  return `${phase.crosswindKt} kt${phase.crosswindFrom ? ` from the ${phase.crosswindFrom}` : ''}`;
}

const join = (parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' · ') || null;
