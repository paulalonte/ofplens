import { FlightPlanHazardsResponse } from '@ofplens/weather';
import {
  queryOptions,
  useIsMutating,
  useMutation,
  useMutationState,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { apiFetch } from './client';

/** SIGMETs and G-AIRMETs on the route, as found by the last check. Reads the DB only. */
export const planHazardsQuery = (planId: string) =>
  queryOptions({
    queryKey: ['flight-plans', 'detail', planId, 'hazards'],
    queryFn: () =>
      apiFetch(
        `/api/flight-plans/${encodeURIComponent(planId)}/hazards`,
        FlightPlanHazardsResponse,
      ),
  });

export function usePlanHazards(planId: string) {
  return useSuspenseQuery(planHazardsQuery(planId)).data;
}

const refreshKey = (planId: string) => ['flight-plans', 'detail', planId, 'hazards', 'refresh'];

/**
 * Checks the hazard feeds against the route again (feeds cached 5 min by the API). Every
 * component calling this shares the refresh's state through the mutation key, so the weather
 * card's Refresh shows up in the hazards card.
 */
export function useRefreshHazards(planId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: refreshKey(planId),
    mutationFn: () =>
      apiFetch(
        `/api/flight-plans/${encodeURIComponent(planId)}/hazards/refresh`,
        FlightPlanHazardsResponse,
        { method: 'POST' },
      ),
    onSuccess: (hazards) => queryClient.setQueryData(planHazardsQuery(planId).queryKey, hazards),
  });
}

/** Whether a hazard refresh for this plan is running, and whether the latest one failed. */
export function useHazardRefreshState(planId: string) {
  const running = useIsMutating({ mutationKey: refreshKey(planId) }) > 0;
  const statuses = useMutationState({
    filters: { mutationKey: refreshKey(planId) },
    select: (mutation) => mutation.state.status,
  });
  return { running, failed: !running && statuses.at(-1) === 'error' };
}
