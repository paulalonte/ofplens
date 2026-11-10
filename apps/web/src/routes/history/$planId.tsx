import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { latestBriefingQuery } from '../../api/briefings';
import { ApiError } from '../../api/client';
import { flightPlanQuery, useFlightPlan } from '../../api/flightPlans';
import { pilotQuery, usePilot } from '../../api/pilot';
import { planWeatherQuery } from '../../api/weather';
import { BriefingPage } from '../../components/briefing/BriefingPage';
import { AiBriefingCard } from './-components/AiBriefingCard';
import { DeletePlan } from './-components/DeletePlan';
import { LiveWeatherCard } from './-components/LiveWeatherCard';

type ImportOutcome = 'new' | 'existing';

/** A deleted or unknown plan is "not found", not a broken page, whichever request notices. */
const orNotFound = <T,>(request: Promise<T>) =>
  request.catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 404) throw notFound();
    throw err;
  });

/**
 * A saved plan's briefing, read from the database, with delete.
 * `?imported=new|existing` is set when arriving straight from "Load latest plan".
 */
export const Route = createFileRoute('/history/$planId')({
  validateSearch: (search: Record<string, unknown>): { imported?: ImportOutcome } =>
    search.imported === 'new' || search.imported === 'existing'
      ? { imported: search.imported }
      : {},
  loader: async ({ context: { queryClient }, params }) => {
    await Promise.all([
      orNotFound(queryClient.ensureQueryData(flightPlanQuery(params.planId))),
      queryClient.ensureQueryData(pilotQuery),
      // Stored weather only; the card refreshes live weather itself when it is stale.
      orNotFound(queryClient.ensureQueryData(planWeatherQuery(params.planId))),
      orNotFound(queryClient.ensureQueryData(latestBriefingQuery(params.planId))),
    ]);
  },
  component: PlanPage,
  notFoundComponent: PlanNotFound,
});

function PlanPage() {
  const { planId } = Route.useParams();
  const { imported } = Route.useSearch();
  const { plan } = useFlightPlan(planId);
  const pilot = usePilot();

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
        plan={plan}
        {...(pilot && { preferredUnit: pilot.weightUnit })}
        weather={<LiveWeatherCard planId={planId} />}
        aiBriefing={<AiBriefingCard planId={planId} />}
      />
    </div>
  );
}

function PlanNotFound() {
  return (
    <div role="alert" className="space-y-3">
      <h1 className="text-xl font-semibold">Plan not found</h1>
      <p className="text-slate-600 dark:text-slate-400">
        That flight plan does not exist (it may have been deleted).
      </p>
      <Link to="/history" className="text-sm underline">
        Back to history
      </Link>
    </div>
  );
}
