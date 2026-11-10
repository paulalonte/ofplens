import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { flightPlanKeys, useDeleteFlightPlan } from '../../../api/flightPlans';

/** "Delete plan" with an inline confirmation; goes back to History once deleted. */
export function DeletePlan({ planId }: { planId: string }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteFlightPlan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function onDeleted() {
    await navigate({ to: '/history' });
    queryClient.removeQueries({ queryKey: flightPlanKeys.detail(planId) });
  }

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
        onClick={() => remove.mutate(planId, { onSuccess: () => void onDeleted() })}
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
