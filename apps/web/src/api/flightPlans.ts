import {
  FlightPlanDetailResponse,
  FlightPlanListResponse,
  ImportFlightPlanResponse,
} from '@ofplens/ofp';
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from './client';

const PAGE_SIZE = 20;

/** Query keys for saved plans; invalidate `all` after anything that changes the history. */
export const flightPlanKeys = {
  all: ['flight-plans'] as const,
  list: () => [...flightPlanKeys.all, 'list'] as const,
  detail: (id: string) => [...flightPlanKeys.all, 'detail', id] as const,
};

/** History, newest first, one page of 20 at a time ("Load more" fetches the next). */
export const flightPlansQuery = infiniteQueryOptions({
  queryKey: flightPlanKeys.list(),
  queryFn: ({ pageParam }) =>
    apiFetch(
      `/api/flight-plans?limit=${PAGE_SIZE}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      FlightPlanListResponse,
    ),
  initialPageParam: null as string | null,
  getNextPageParam: (last) => last.nextCursor,
});

export function useFlightPlans() {
  return useInfiniteQuery(flightPlansQuery);
}

export const flightPlanQuery = (id: string) =>
  queryOptions({
    queryKey: flightPlanKeys.detail(id),
    queryFn: () =>
      apiFetch(`/api/flight-plans/${encodeURIComponent(id)}`, FlightPlanDetailResponse),
    // Stored plans never change; only deletion removes them.
    staleTime: Infinity,
  });

export function useFlightPlan(id: string) {
  return useQuery(flightPlanQuery(id));
}

/** Fetches the latest SimBrief plan and saves it (or finds it already saved). */
export function useImportLatestPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch('/api/flight-plans/import', ImportFlightPlanResponse, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: flightPlanKeys.list() }),
  });
}

export function useDeleteFlightPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    // 204 No Content: there is no body to validate.
    mutationFn: (id: string) =>
      apiFetch(`/api/flight-plans/${encodeURIComponent(id)}`, z.undefined(), { method: 'DELETE' }),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: flightPlanKeys.detail(id) });
      return queryClient.invalidateQueries({ queryKey: flightPlanKeys.list() });
    },
  });
}
