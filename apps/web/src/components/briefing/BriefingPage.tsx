import type { FlightPlanSummary, WeightUnit } from '@ofplens/ofp';
import type { RouteHazardView } from '@ofplens/weather';
import { useState, type ReactNode } from 'react';
import { BriefingHeader } from './BriefingHeader';
import { FlightDataCard } from './FlightDataCard';
import { FuelCard } from './FuelCard';
import { NavlogCard } from './NavlogCard';
import { PayloadCard } from './PayloadCard';
import { RouteMapCard } from './routeMap/RouteMapCard';
import { TakeoffLandingCard } from './TakeoffLandingCard';
import { TimesCard } from './TimesCard';
import { UnitToggle } from './UnitToggle';
import { WeatherCard } from './WeatherCard';

/**
 * The pilot briefing for one flight plan. Purely presentational: every number comes from
 * the parsed OFP, formatted by @ofplens/ofp.
 */
interface Props {
  plan: FlightPlanSummary;
  /** The pilot's preferred unit from Settings; defaults to the plan's own unit. */
  preferredUnit?: WeightUnit;
  /** Replaces the OFP-only weather card, e.g. with dispatch vs live weather for saved plans. */
  weather?: ReactNode;
  /** Replaces the planning-only takeoff & landing card, e.g. with the wind now on saved plans. */
  takeoffLanding?: ReactNode;
  /** The AI briefing, shown above the weather on saved plans. */
  aiBriefing?: ReactNode;
  /** Hazards along the route (saved plans), shown after the weather. */
  hazards?: ReactNode;
  /** Navlog fixes inside a hazard, by seq, with the hazards' codes. */
  navlogMarks?: ReadonlyMap<number, readonly string[]>;
  /** Hazards along the route, drawn on the route map (saved plans). */
  routeHazards?: readonly RouteHazardView[];
}

export function BriefingPage({
  plan,
  preferredUnit,
  weather,
  takeoffLanding,
  aiBriefing,
  hazards,
  navlogMarks,
  routeHazards,
}: Props) {
  const [displayUnit, setDisplayUnit] = useState<WeightUnit>(preferredUnit ?? plan.units);

  return (
    <article className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <BriefingHeader plan={plan} />
        <UnitToggle value={displayUnit} onChange={setDisplayUnit} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <TimesCard plan={plan} />
        <FuelCard plan={plan} displayUnit={displayUnit} />
        <PayloadCard plan={plan} displayUnit={displayUnit} />
      </div>
      <FlightDataCard plan={plan} />
      {takeoffLanding ?? <TakeoffLandingCard plan={plan} />}

      {aiBriefing}
      {weather ?? <WeatherCard plan={plan} />}
      {hazards}
      <RouteMapCard plan={plan} {...(routeHazards && { hazards: routeHazards })} />
      <NavlogCard plan={plan} displayUnit={displayUnit} hazardMarks={navlogMarks} />

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Planned in {plan.units === 'kgs' ? 'kilograms' : 'pounds'}
        {displayUnit !== plan.units && ', converted for display'}. SimBrief request{' '}
        {plan.simbriefRequestId}, generated{' '}
        {plan.generatedAt.replace('T', ' ').replace(/:\d\dZ$/, 'Z')}.
      </p>
    </article>
  );
}
