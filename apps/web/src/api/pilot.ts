import { PilotResponse, type PilotSettings } from '@ofplens/ofp';
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

export const pilotQuery = queryOptions({
  queryKey: ['pilot'],
  queryFn: () => apiFetch('/api/pilot', PilotResponse).then((r) => r.pilot),
});

/**
 * The saved pilot settings, or null when none are saved yet.
 * Load `pilotQuery` in the route's loader; this then reads it from the cache.
 */
export function usePilot() {
  return useSuspenseQuery(pilotQuery).data;
}

export function useSavePilot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: PilotSettings) =>
      apiFetch('/api/pilot', PilotResponse, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      }).then((r) => r.pilot),
    onSuccess: (pilot) => {
      queryClient.setQueryData(pilotQuery.queryKey, pilot);
      // A different username means a different "latest plan".
      queryClient.removeQueries({ queryKey: ['simbrief'] });
    },
  });
}
