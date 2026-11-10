import {
  FlightPlanDetailResponse,
  FlightPlanListResponse,
  ImportFlightPlanResponse,
} from '@ofplens/ofp';
import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
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

/** Load `flightPlansQuery` in the route's loader (ensureInfiniteQueryData) first. */
export function useFlightPlans() {
  return useSuspenseInfiniteQuery(flightPlansQuery);
}

export const flightPlanQuery = (id: string) =>
  queryOptions({
    queryKey: flightPlanKeys.detail(id),
    queryFn: () =>
      apiFetch(`/api/flight-plans/${encodeURIComponent(id)}`, FlightPlanDetailResponse),
    // Stored plans never change; only deletion removes them.
    staleTime: Infinity,
  });

/** Load `flightPlanQuery(id)` in the route's loader first; the data is then always there. */
export function useFlightPlan(id: string) {
  return useSuspenseQuery(flightPlanQuery(id)).data;
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
    // The detail entry is dropped by the page after it has navigated away: removing it while
    // the page is still mounted would make its suspense query refetch the deleted plan.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: flightPlanKeys.list() }),
  });
}
