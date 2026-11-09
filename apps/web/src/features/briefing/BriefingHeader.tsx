import { formatZuluDate, type Airport, type FlightPlanSummary } from '@ofplens/ofp';

export function BriefingHeader({ plan }: { plan: FlightPlanSummary }) {
  const { flight, aircraft, origin, destination, alternate } = plan;
  const callsign = flight.callsign ?? `${flight.airlineIcao ?? ''}${flight.flightNumber ?? ''}`;

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-mono text-3xl font-bold tracking-tight">{callsign}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {formatZuluDate(plan.times.out)}
          {plan.airac && <> · AIRAC {plan.airac}</>}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Route">
        <AirportBadge airport={origin} />
        <span aria-hidden className="text-slate-400">
          →
        </span>
        <AirportBadge airport={destination} />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {alternate ? (
            <>
              Alternate <span className="font-mono">{alternate.icao}</span>
            </>
          ) : (
            'No alternate'
          )}
        </span>
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-300">
        <span className="font-mono">{aircraft.icao}</span>
        {aircraft.name && <> · {aircraft.name}</>}
        {aircraft.reg && (
          <>
            {' '}
            · <span className="font-mono">{aircraft.reg}</span>
          </>
        )}
      </p>
    </header>
  );
}

function AirportBadge({ airport }: { airport: Airport }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="font-mono text-xl font-semibold">{airport.icao}</span>
      <span className="text-sm text-slate-500 dark:text-slate-400">
        {airport.name}
        {airport.runway && <> · RWY {airport.runway}</>}
      </span>
    </span>
  );
}
