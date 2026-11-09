import { Link } from '@tanstack/react-router';
import { useFlightPlans } from '../../api/flightPlans';
import { PlanList } from './PlanList';

export function HistoryPage() {
  const plans = useFlightPlans();
  const items = plans.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">History</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Every plan you have loaded, newest first.
        </p>
      </div>

      {plans.isPending ? (
        <p className="text-slate-500">Loading your plans…</p>
      ) : plans.isError ? (
        <p role="alert" className="text-red-600 dark:text-red-400">
          Could not load your history: {plans.error.message}
        </p>
      ) : items.length === 0 ? (
        <p className="text-slate-600 dark:text-slate-400">
          No saved plans yet.{' '}
          <Link to="/" className="underline">
            Load your latest SimBrief plan
          </Link>{' '}
          to start your history.
        </p>
      ) : (
        <>
          <PlanList items={items} />
          {plans.hasNextPage && (
            <button
              type="button"
              onClick={() => void plans.fetchNextPage()}
              disabled={plans.isFetchingNextPage}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              {plans.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
