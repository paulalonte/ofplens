import { FlightPlanWeatherResponse } from '@ofplens/weather';
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { apiFetch } from './client';

/** Live weather older than this is refreshed automatically when the plan is opened. */
export const LIVE_WEATHER_MAX_AGE_MS = 10 * 60_000;

/** Weather at dispatch vs the latest stored live report, per airport. Reads the DB only. */
export const planWeatherQuery = (planId: string) =>
  queryOptions({
    queryKey: ['flight-plans', 'detail', planId, 'weather'],
    queryFn: () =>
      apiFetch(
        `/api/flight-plans/${encodeURIComponent(planId)}/weather`,
        FlightPlanWeatherResponse,
      ),
  });

export function usePlanWeather(planId: string) {
  return useSuspenseQuery(planWeatherQuery(planId)).data;
}

/** Fetches live METAR/TAF from aviationweather.gov through the API (cached there 5 min). */
export function useRefreshWeather(planId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/flight-plans/${encodeURIComponent(planId)}/weather/refresh`,
        FlightPlanWeatherResponse,
        { method: 'POST' },
      ),
    onSuccess: (weather) => queryClient.setQueryData(planWeatherQuery(planId).queryKey, weather),
  });
}

/** True when live weather was never fetched or is older than LIVE_WEATHER_MAX_AGE_MS. */
export function isLiveWeatherStale(liveCheckedAt: string | null, now = Date.now()): boolean {
  return liveCheckedAt === null || now - Date.parse(liveCheckedAt) > LIVE_WEATHER_MAX_AGE_MS;
}

/** Refreshes once on mount when the stored live weather is stale. */
export function useAutoRefreshWeather(
  liveCheckedAt: string | null,
  refresh: { mutate: () => void },
) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !isLiveWeatherStale(liveCheckedAt)) return;
    started.current = true;
    refresh.mutate();
  }, [liveCheckedAt, refresh]);
}
