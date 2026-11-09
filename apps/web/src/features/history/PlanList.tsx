import { formatDuration, formatZulu, formatZuluDate, type FlightPlanListItem } from '@ofplens/ofp';
import { Link } from '@tanstack/react-router';

/** Saved plans as rows linking to their briefing: date, callsign, route, aircraft, block time. */
export function PlanList({ items }: { items: FlightPlanListItem[] }) {
  return (
    <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            to="/plans/$planId"
            params={{ planId: item.id }}
            className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[9rem_6rem_1fr_5rem_4rem] dark:hover:bg-slate-800/60"
          >
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {formatZuluDate(item.out)} <span className="font-mono">{formatZulu(item.out)}</span>
            </span>
            <span className="text-right font-mono font-semibold sm:text-left">
              {item.callsign ?? '—'}
            </span>
            <span className="font-mono">
              {item.originIcao} → {item.destinationIcao}
              {item.alternateIcao && (
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                  ALT {item.alternateIcao}
                </span>
              )}
            </span>
            <span className="font-mono text-sm text-slate-600 dark:text-slate-300">
              {item.aircraftIcao}
            </span>
            <span
              className="text-right font-mono text-sm tabular-nums"
              title="Block time"
              aria-label={`Block time ${formatDuration(item.blockTimeS)}`}
            >
              {formatDuration(item.blockTimeS)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
