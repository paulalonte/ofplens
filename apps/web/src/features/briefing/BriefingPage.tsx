import type { FlightPlanSummary, WeightUnit } from '@ofplens/ofp';
import { useState } from 'react';
import { BriefingHeader } from './BriefingHeader';
import { FuelCard } from './FuelCard';
import { NavlogCard } from './NavlogCard';
import { PayloadCard } from './PayloadCard';
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
}

export function BriefingPage({ plan, preferredUnit }: Props) {
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

      <WeatherCard plan={plan} />
      <NavlogCard plan={plan} displayUnit={displayUnit} />

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Planned in {plan.units === 'kgs' ? 'kilograms' : 'pounds'}
        {displayUnit !== plan.units && ', converted for display'}. SimBrief request{' '}
        {plan.simbriefRequestId}, generated{' '}
        {plan.generatedAt.replace('T', ' ').replace(/:\d\dZ$/, 'Z')}.
      </p>
    </article>
  );
}
