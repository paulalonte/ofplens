import {
  addSeconds,
  formatWeightNumber,
  formatZulu,
  weightUnitLabel,
  type FlightPlanSummary,
  type Waypoint,
  type WeightUnit,
} from '@ofplens/ofp';
import { Card } from '../Card';

interface Props {
  plan: FlightPlanSummary;
  displayUnit: WeightUnit;
}

const altitude = new Intl.NumberFormat('en-US');

/** TOC and TOD are lat/long fixes in the OFP; pick them out by ident. */
const isClimbDescentPoint = (w: Waypoint) =>
  w.type === 'ltlg' && (w.ident === 'TOC' || w.ident === 'TOD');

/** Every navlog fix with planned altitude, wind, ETA and fuel on board. ETA = takeoff + elapsed. */
export function NavlogCard({ plan, displayUnit }: Props) {
  return (
    <Card title="Navigation log" aside={<RouteSummary plan={plan} />}>
      <p className="mb-3 font-mono text-xs break-words text-slate-600 dark:text-slate-400">
        {plan.origin.icao} {plan.route.text} {plan.destination.icao}
      </p>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <th scope="col" className="py-2 pr-3 font-medium">
                Fix
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Via
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Stage
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Alt (ft)
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Wind
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                OAT
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                ETA
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                FOB ({weightUnitLabel(displayUnit)})
              </th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {plan.waypoints.map((w) => (
              <tr
                key={w.seq}
                className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                  isClimbDescentPoint(w) ? 'bg-sky-50 dark:bg-sky-950/40' : ''
                }`}
              >
                <th scope="row" className="py-1.5 pr-3 text-left font-semibold">
                  {w.ident}
                  {w.name && w.name !== w.ident && (
                    <>
                      {' '}
                      <span className="ml-1 font-sans text-xs font-normal text-slate-500 dark:text-slate-400">
                        {w.name}
                      </span>
                    </>
                  )}
                </th>
                <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{w.via ?? ''}</td>
                <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{w.stage ?? ''}</td>
                <td className="py-1.5 pr-3 text-right">{altitude.format(w.altitudeFt)}</td>
                <td className="py-1.5 pr-3 text-right">
                  {String(w.windDirDeg).padStart(3, '0')}/{w.windSpeedKt}
                </td>
                <td className="py-1.5 pr-3 text-right">{w.oatC}°</td>
                <td className="py-1.5 pr-3 text-right">
                  {formatZulu(addSeconds(plan.times.off, w.elapsedS))}
                </td>
                <td className="py-1.5 text-right">
                  {formatWeightNumber(w.fuelOnBoard, plan.units, displayUnit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RouteSummary({ plan }: { plan: FlightPlanSummary }) {
  const { distanceNm, cruiseAltitudeFt, costIndex } = plan.route;
  return (
    <span className="text-xs text-slate-500 dark:text-slate-400">
      {distanceNm} nm · FL{Math.round(cruiseAltitudeFt / 100)}
      {costIndex !== null && <> · CI {costIndex}</>}
    </span>
  );
}
