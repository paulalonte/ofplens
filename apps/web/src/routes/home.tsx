import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ApiError } from '../api/client';
import { usePilot } from '../api/pilot';
import { useLatestPlan } from '../api/simbrief';
import { BriefingPage } from '../features/briefing/BriefingPage';
import { SAMPLE_NAMES } from '../features/briefing/samples';

export function HomePage() {
  const pilot = usePilot();
  const latest = useLatestPlan();
  const username = pilot.data?.simbriefUsername;
  const loading = latest.fetchStatus === 'fetching';

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
          onClick={() => void latest.refetch()}
          disabled={!username || loading}
          aria-busy={loading}
          className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {loading ? 'Loading…' : latest.data ? 'Reload latest plan' : 'Load latest plan'}
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

      {latest.isError && !loading && <LoadError error={latest.error} />}

      {latest.data ? (
        <div className={loading ? 'opacity-60 transition-opacity' : undefined}>
          <BriefingPage
            key={latest.data.simbriefRequestId}
            plan={latest.data}
            {...(pilot.data && { preferredUnit: pilot.data.weightUnit })}
          />
        </div>
      ) : (
        username &&
        !latest.isError &&
        !loading && (
          <p className="text-slate-600 dark:text-slate-400">
            Generate a flight on SimBrief, then load it here.
          </p>
        )
      )}

      {SAMPLE_NAMES.length > 0 && !latest.data && (
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
