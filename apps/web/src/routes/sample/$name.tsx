import { createFileRoute, Link, type ErrorComponentProps } from '@tanstack/react-router';
import { pilotQuery, usePilot } from '../../api/pilot';
import { BriefingPage } from '../../components/briefing/BriefingPage';
import { loadSamplePlan } from '../../lib/samples';

/** Development only: a briefing built from a captured OFP in fixtures/ofp. */
export const Route = createFileRoute('/sample/$name')({
  loader: async ({ context: { queryClient }, params }) => {
    const [plan] = await Promise.all([
      loadSamplePlan(params.name),
      queryClient.ensureQueryData(pilotQuery),
    ]);
    return plan;
  },
  component: SamplePage,
  pendingComponent: SamplePending,
  errorComponent: SampleError,
});

function SamplePage() {
  const plan = Route.useLoaderData();
  const pilot = usePilot();
  return <BriefingPage plan={plan} {...(pilot && { preferredUnit: pilot.weightUnit })} />;
}

function SampleError({ error }: ErrorComponentProps) {
  return (
    <div role="alert" className="space-y-3">
      <h1 className="text-xl font-semibold">Could not load this sample</h1>
      <p className="text-slate-600 dark:text-slate-400">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <Link to="/" className="text-sm underline">
        Back to start
      </Link>
    </div>
  );
}

function SamplePending() {
  return <p className="text-slate-500">Loading sample plan…</p>;
}
