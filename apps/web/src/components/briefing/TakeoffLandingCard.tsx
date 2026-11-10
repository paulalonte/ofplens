import {
  formatAltimeter,
  formatWeight,
  type FlightPlanSummary,
  type LandingPlan,
  type TakeoffPlan,
  type WeightUnit,
} from '@ofplens/ofp';
import type { ReactNode } from 'react';
import { Card, Row } from '../Card';

interface Props {
  plan: FlightPlanSummary;
  displayUnit: WeightUnit;
}

const number = new Intl.NumberFormat('en-US');
const deg = (value: number) => `${String(value).padStart(3, '0')}°`;

/**
 * The planned runways as SimBrief computed them at dispatch: conditions, wind components and
 * setup. Planning data, not live weather; every number comes from the OFP.
 */
export function TakeoffLandingCard({ plan, displayUnit }: Props) {
  const { performance } = plan;
  if (!performance) return null;
  const weight = (value: number | null) =>
    value === null ? null : formatWeight(value, plan.units, displayUnit);

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
        {performance.takeoff && (
          <Phase label="Takeoff" phase={performance.takeoff}>
            <Line label="Flaps · thrust">
              {join([
                performance.takeoff.flaps && `Flaps ${performance.takeoff.flaps}`,
                thrust(performance.takeoff),
              ])}
            </Line>
            <Line label="V1 / VR / V2">
              {performance.takeoff.v1Kt !== null &&
              performance.takeoff.vrKt !== null &&
              performance.takeoff.v2Kt !== null
                ? `${performance.takeoff.v1Kt} / ${performance.takeoff.vrKt} / ${performance.takeoff.v2Kt} kt`
                : null}
            </Line>
            <Line label="Takeoff weight">{weight(performance.takeoff.plannedWeight)}</Line>
          </Phase>
        )}
        {performance.landing && (
          <Phase label="Landing" phase={performance.landing}>
            <Line label="Flaps">{performance.landing.flaps}</Line>
            <Line label="VREF">
              {performance.landing.vrefKt === null ? null : `${performance.landing.vrefKt} kt`}
            </Line>
            <Line label="Landing distance">
              {performance.landing.landingDistanceFt === null
                ? null
                : `${number.format(performance.landing.landingDistanceFt)} ft${
                    performance.landing.surface ? ` (factored, ${performance.landing.surface})` : ''
                  }`}
            </Line>
            <Line label="Landing weight">{weight(performance.landing.plannedWeight)}</Line>
          </Phase>
        )}
      </div>
    </Card>
  );
}

function Phase({
  label,
  phase,
  children,
}: {
  label: string;
  phase: TakeoffPlan | LandingPlan;
  children: ReactNode;
}) {
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
        <Line label="ILS">{phase.ilsFrequency}</Line>
        {children}
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

function thrust(takeoff: TakeoffPlan): string | null {
  if (!takeoff.thrust) return null;
  return takeoff.thrust === 'FLEX' && takeoff.flexTemperatureC !== null
    ? `FLEX ${takeoff.flexTemperatureC}°C`
    : takeoff.thrust;
}

const join = (parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' · ') || null;
