import { Link, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ApiError } from '../api/client';
import { useFlightPlans, useImportLatestPlan } from '../api/flightPlans';
import { usePilot } from '../api/pilot';
import { SAMPLE_NAMES } from '../features/briefing/samples';
import { PlanList } from '../features/history/PlanList';

const RECENT = 5;

export function HomePage() {
  const pilot = usePilot();
  const recent = useFlightPlans();
  const importLatest = useImportLatestPlan();
  const navigate = useNavigate();
  const username = pilot.data?.simbriefUsername;
  const recentItems = recent.data?.pages[0]?.items.slice(0, RECENT) ?? [];

  function load() {
    importLatest.mutate(undefined, {
      onSuccess: ({ id, created }) =>
        void navigate({
          to: '/plans/$planId',
          params: { planId: id },
          search: { imported: created ? 'new' : 'existing' },
        }),
    });
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div>
          {pilot.isPending ? (
            <p className="text-slate-500">Loading settings…</p>
          ) : username ? (
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

      {pilot.isSuccess && !username && (
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
          {recent.isPending ? (
            <p className="text-slate-500">Loading…</p>
          ) : recentItems.length > 0 ? (
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

function LoadError({ error }: { error: Error }) {
  const code = error instanceof ApiError ? error.code : undefined;
  const fixInSettings = code === 'USERNAME_REQUIRED' || code === 'SIMBRIEF_NOT_FOUND';
  const transient = code === 'SIMBRIEF_UNAVAILABLE' || code === 'NETWORK_ERROR';

  return (
    <Callout tone="error">
      <p className="font-medium">Could not load your latest plan</p>
      <p className="text-sm">{error.message}</p>
      {fixInSettings && (
        <p className="text-sm">
          <Link to="/settings" className="underline">
            Check your username in Settings
          </Link>
        </p>
      )}
      {transient && <p className="text-sm">This is usually temporary. Try again in a moment.</p>}
    </Callout>
  );
}

function Callout({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'note'}
      className={`space-y-1 rounded-lg border p-4 ${
        tone === 'error'
          ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200'
          : 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200'
      }`}
    >
      {children}
    </div>
  );
}
