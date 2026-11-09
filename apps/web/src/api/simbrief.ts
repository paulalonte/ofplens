import { FlightPlanSummary } from '@ofplens/ofp';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

/**
 * The pilot's latest SimBrief plan. Never fetched automatically: the "Load latest plan" button
 * calls refetch(). Kept for the session so it survives navigating to Settings and back.
 */
export const latestPlanQuery = queryOptions({
  queryKey: ['simbrief', 'latest'],
  queryFn: () => apiFetch('/api/simbrief/latest', FlightPlanSummary),
  enabled: false,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
});

export function useLatestPlan() {
  return useQuery(latestPlanQuery);
}
