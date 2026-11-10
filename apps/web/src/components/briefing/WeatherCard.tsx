import type { Airport, FlightPlanSummary } from '@ofplens/ofp';
import { Card } from '../Card';

/** METAR and TAF exactly as printed in the OFP at dispatch. Live weather comes in phase 4. */
export function WeatherCard({ plan }: { plan: FlightPlanSummary }) {
  const stations: { role: string; airport: Airport }[] = [
    { role: 'Departure', airport: plan.origin },
    { role: 'Destination', airport: plan.destination },
    ...(plan.alternate ? [{ role: 'Alternate', airport: plan.alternate }] : []),
  ];

  return (
    <Card
      title="Weather at dispatch"
      aside={<span className="text-xs text-slate-500 dark:text-slate-400">from the OFP</span>}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {stations.map(({ role, airport }) => (
          <section key={role} aria-label={`${role} weather`} className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold">
              {role} <span className="font-mono">{airport.icao}</span>
            </h3>
            <Report kind="METAR" text={airport.metar} />
            <Report kind="TAF" text={airport.taf} />
          </section>
        ))}
      </div>
    </Card>
  );
}

function Report({ kind, text }: { kind: string; text: string | null }) {
  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wider text-slate-500 dark:text-slate-400">
        {kind}
      </p>
      {text ? (
        <pre className="overflow-x-auto rounded-md bg-slate-100 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap dark:bg-slate-950">
          {text}
        </pre>
      ) : (
        <p className="text-xs text-slate-500 italic">Not in the OFP</p>
      )}
    </div>
  );
}
