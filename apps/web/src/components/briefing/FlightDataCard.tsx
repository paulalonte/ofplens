import {
  formatFlightLevel,
  formatIsaDeviation,
  formatWindComponent,
  type FlightPlanSummary,
} from '@ofplens/ofp';
import type { ReactNode } from 'react';
import { Card } from '../Card';

const number = new Intl.NumberFormat('en-US');
const NONE = '—';

/**
 * The numbers you set up the FMC with and glance at in cruise, in one place. Everything comes
 * from the OFP; route averages are SimBrief's.
 */
export function FlightDataCard({ plan }: { plan: FlightPlanSummary }) {
  const { route, origin, destination } = plan;
  // Cruise temperature: at top of climb, else the first cruise fix.
  const cruiseFix =
    plan.waypoints.find((w) => w.ident === 'TOC' && w.type === 'ltlg') ??
    plan.waypoints.find((w) => w.stage === 'CRZ');
  const steps = route.stepClimbs
    .map((s) => `${formatFlightLevel(s.altitudeFt)} at ${s.at}`)
    .join(', ');
  const ft = (value: number | null) => (value === null ? NONE : `${number.format(value)} ft`);
  const nm = (value: number | null) => (value === null ? NONE : `${number.format(value)} nm`);

  return (
    <Card title="Flight data">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
        <Item label="Cost index">{route.costIndex ?? NONE}</Item>
        <Item label="Cruise altitude" note={steps ? `Step to ${steps}` : 'No step climbs'}>
          {formatFlightLevel(route.cruiseAltitudeFt)}
        </Item>
        <Item
          label="Cruise temperature"
          note={[
            cruiseFix?.ident === 'TOC' ? 'At top of climb' : 'At cruise',
            route.avgIsaDevC !== null && `avg ${formatIsaDeviation(route.avgIsaDevC)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {cruiseFix ? `${cruiseFix.oatC}°C` : NONE}
        </Item>
        <Item label="Tropopause" note="Route average">
          {route.avgTropopauseFt === null ? NONE : formatFlightLevel(route.avgTropopauseFt)}
        </Item>
        <Item label="Wind component" note="Route average">
          {route.avgWindComponentKt === null ? NONE : formatWindComponent(route.avgWindComponentKt)}
        </Item>
        <Item label="Origin elevation" note={origin.icao}>
          {ft(origin.elevationFt)}
        </Item>
        <Item label="Destination elevation" note={destination.icao}>
          {ft(destination.elevationFt)}
        </Item>
        <Item label="G/C distance" note="Great circle">
          {nm(route.gcDistanceNm)}
        </Item>
        <Item label="Route distance" note="Planned route">
          {nm(route.distanceNm)}
        </Item>
      </dl>
    </Card>
  );
}

function Item({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-mono text-lg font-semibold tabular-nums">{children}</dd>
      {note && <dd className="text-xs text-slate-500 dark:text-slate-400">{note}</dd>}
    </div>
  );
}
