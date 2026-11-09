import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { useDeleteFlightPlan, useFlightPlan } from '../../api/flightPlans';
import { usePilot } from '../../api/pilot';
import { BriefingPage } from '../briefing/BriefingPage';

export type ImportOutcome = 'new' | 'existing';

interface Props {
  planId: string;
  /** Set when arriving straight from "Load latest plan". */
  imported?: ImportOutcome | undefined;
}

/** A saved plan's briefing, read from the database, with delete. */
export function PlanPage({ planId, imported }: Props) {
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
        <DeletePlan planId={planId} />
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

function DeletePlan({ planId }: { planId: string }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteFlightPlan();
  const navigate = useNavigate();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:border-red-300 hover:text-red-700 dark:border-slate-700 dark:text-slate-300 dark:hover:text-red-400"
      >
        Delete plan
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Confirm delete"
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <span>Delete this plan from your history?</span>
      <button
        type="button"
        disabled={remove.isPending}
        onClick={() =>
          remove.mutate(planId, { onSuccess: () => void navigate({ to: '/history' }) })
        }
        className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-60"
      >
        {remove.isPending ? 'Deleting…' : 'Delete'}
      </button>
      <button
        type="button"
        disabled={remove.isPending}
        onClick={() => {
          setConfirming(false);
          remove.reset();
        }}
        className="rounded-md border border-slate-300 px-3 py-1.5 dark:border-slate-700"
      >
        Cancel
      </button>
      {remove.isError && (
        <span role="alert" className="text-red-600 dark:text-red-400">
          {remove.error.message}
        </span>
      )}
    </div>
  );
}
