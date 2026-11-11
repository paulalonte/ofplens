import { formatZulu, formatZuluDate } from '@ofplens/ofp';
import type { StationWeather, StationRole } from '@ofplens/weather';
import { useRefreshHazards } from '../../../api/hazards';
import { useAutoRefreshWeather, usePlanWeather, useRefreshWeather } from '../../../api/weather';
import { Card } from '../../../components/Card';
import { CategoryBadge } from './CategoryBadge';

const ROLE_LABEL: Record<StationRole, string> = {
  origin: 'Departure',
  destination: 'Destination',
  alternate: 'Alternate',
};

/**
 * Weather at dispatch (from the OFP) next to the latest live report, per airport.
 * Live weather is refreshed automatically when it is more than 10 minutes old.
 */
export function LiveWeatherCard({ planId }: { planId: string }) {
  const weather = usePlanWeather(planId);
  const refresh = useRefreshWeather(planId);
  const refreshHazards = useRefreshHazards(planId);
  useAutoRefreshWeather(weather.liveCheckedAt, refresh);

  return (
    <Card
      title="Weather: dispatch vs now"
      aside={
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span role="status">
            {refresh.isPending
              ? 'Updating live weather…'
              : weather.liveCheckedAt
                ? `Live as of ${formatZulu(weather.liveCheckedAt)}`
                : 'No live weather yet'}
          </span>
          <button
            type="button"
            onClick={() => {
              // Hazards along the route are checked again with the weather.
              refresh.mutate();
              refreshHazards.mutate();
            }}
            disabled={refresh.isPending}
            className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>
      }
    >
      {refresh.isError && (
        <p role="alert" className="mb-3 text-sm text-amber-700 dark:text-amber-400">
          Live weather is unavailable right now. Showing what was stored last.
        </p>
      )}
      <div className="space-y-5">
        {weather.stations.map((station) => (
          <StationRow key={station.role} station={station} />
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        Live reports from aviationweather.gov. For flight simulation only.
      </p>
    </Card>
  );
}

function StationRow({ station }: { station: StationWeather }) {
  return (
    <section aria-label={`${ROLE_LABEL[station.role]} weather`} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">
          {ROLE_LABEL[station.role]} <span className="font-mono">{station.icao}</span>
        </h3>
        {station.changedSinceDispatch && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            Changed since dispatch: {station.dispatch.metar?.category} →{' '}
            {station.live.metar?.category}
          </span>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Side label="At dispatch" reports={station.dispatch} />
        <Side
          label="Now"
          reports={station.live}
          note={station.newerTaf ? 'TAF updated since dispatch' : undefined}
          empty="No live report yet"
        />
      </div>
    </section>
  );
}

function Side({
  label,
  reports,
  note,
  empty = 'Not in the OFP',
}: {
  label: string;
  reports: StationWeather['dispatch'];
  note?: string | undefined;
  empty?: string;
}) {
  const { metar, taf } = reports;
  return (
    <div className="min-w-0 space-y-1.5 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
          {label}
        </span>
        <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {metar?.observedAt && (
            <time dateTime={metar.observedAt}>
              {formatZuluDate(metar.observedAt).slice(0, 6)} {formatZulu(metar.observedAt)}
            </time>
          )}
          <CategoryBadge metar={metar} />
        </span>
      </div>
      {metar ? (
        <pre className="overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {metar.raw}
        </pre>
      ) : (
        <p className="text-xs text-slate-500 italic">{empty}</p>
      )}
      {taf && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-600 dark:text-slate-400">
            TAF{note && <span className="ml-2 text-sky-700 dark:text-sky-400">{note}</span>}
          </summary>
          <pre className="mt-1 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap">
            {taf.raw}
          </pre>
        </details>
      )}
    </div>
  );
}
