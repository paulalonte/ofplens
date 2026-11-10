import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { flightPlansQuery, useFlightPlans, useImportLatestPlan } from '../api/flightPlans';
import { pilotQuery, usePilot } from '../api/pilot';
import { Callout } from '../components/Callout';
import { PlanList } from '../components/PlanList';
import { SAMPLE_NAMES } from '../lib/samples';
import { LoadError } from './-components/LoadError';

export const Route = createFileRoute('/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(pilotQuery),
      queryClient.ensureInfiniteQueryData(flightPlansQuery),
    ]),
  component: HomePage,
});

const RECENT = 5;

function HomePage() {
  const pilot = usePilot();
  const recent = useFlightPlans();
  const importLatest = useImportLatestPlan();
  const navigate = useNavigate();
  const username = pilot?.simbriefUsername;
  const recentItems = recent.data.pages[0]?.items.slice(0, RECENT) ?? [];

  function load() {
    importLatest.mutate(undefined, {
      onSuccess: ({ id, created }) =>
        void navigate({
          to: '/history/$planId',
          params: { planId: id },
          search: { imported: created ? 'new' : 'existing' },
        }),
    });
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div>
          {username ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              SimBrief user <span className="font-mono font-semibold">{username}</span> ·{' '}
              <Link to="/settings" className="underline">
                Change
              </Link>
            </p>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">No SimBrief username yet.</p>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={!username || importLatest.isPending}
          aria-busy={importLatest.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {importLatest.isPending ? 'Loading…' : 'Load latest plan'}
        </button>
      </section>

      {!username && (
        <Callout>
          <p className="font-medium">Set your SimBrief username first.</p>
          <p className="text-sm">
            OFP Lens reads your most recent plan from SimBrief.{' '}
            <Link to="/settings" className="underline">
              Go to Settings
            </Link>
          </p>
        </Callout>
      )}

      {importLatest.isError && <LoadError error={importLatest.error} />}

      {username && (
        <section aria-labelledby="recent-heading" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 id="recent-heading" className="text-lg font-semibold">
              Recent plans
            </h2>
            {recentItems.length > 0 && (
              <Link to="/history" className="text-sm underline">
                All plans
              </Link>
            )}
          </div>
          {recentItems.length > 0 ? (
            <PlanList items={recentItems} />
          ) : (
            <p className="text-slate-600 dark:text-slate-400">
              Generate a flight on SimBrief, then load it here. Each plan you load is saved to your
              history.
            </p>
          )}
        </section>
      )}

      {SAMPLE_NAMES.length > 0 && (
        <nav
          aria-label="Sample plans"
          className="space-y-2 border-t border-slate-200 pt-6 dark:border-slate-800"
        >
          <h2 className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
            Sample plans (development)
          </h2>
          <ul className="flex flex-wrap gap-2">
            {SAMPLE_NAMES.map((name) => (
              <li key={name}>
                <Link
                  to="/sample/$name"
                  params={{ name }}
                  className="inline-block rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  {name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
