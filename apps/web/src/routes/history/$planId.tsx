import { createFileRoute, Link } from '@tanstack/react-router';
import { ApiError } from '../../api/client';
import { useFlightPlan } from '../../api/flightPlans';
import { usePilot } from '../../api/pilot';
import { BriefingPage } from '../../components/briefing/BriefingPage';
import { DeletePlan } from './-components/DeletePlan';

type ImportOutcome = 'new' | 'existing';

/**
 * A saved plan's briefing, read from the database, with delete.
 * `?imported=new|existing` is set when arriving straight from "Load latest plan".
 */
export const Route = createFileRoute('/history/$planId')({
  validateSearch: (search: Record<string, unknown>): { imported?: ImportOutcome } =>
    search.imported === 'new' || search.imported === 'existing'
      ? { imported: search.imported }
      : {},
  component: PlanPage,
});

function PlanPage() {
  const { planId } = Route.useParams();
  const { imported } = Route.useSearch();
  const stored = useFlightPlan(planId);
  const pilot = usePilot();

  if (stored.isPending) return <p className="text-slate-500">Loading plan…</p>;

  if (stored.isError) {
    const notFound = stored.error instanceof ApiError && stored.error.status === 404;
    return (
      <div role="alert" className="space-y-3">
        <h1 className="text-xl font-semibold">
          {notFound ? 'Plan not found' : 'Could not load this plan'}
        </h1>
        <p className="text-slate-600 dark:text-slate-400">{stored.error.message}</p>
        <Link to="/history" className="text-sm underline">
          Back to history
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/history" className="text-sm text-slate-600 underline dark:text-slate-400">
          ← History
        </Link>
        <DeletePlan key={planId} planId={planId} />
      </div>

      {imported && (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
        >
          {imported === 'new'
            ? 'Saved to your history.'
            : 'Already in your history. SimBrief has no newer plan for you yet.'}
        </p>
      )}

      <BriefingPage
        plan={stored.data.plan}
        {...(pilot.data && { preferredUnit: pilot.data.weightUnit })}
      />
    </div>
  );
}
