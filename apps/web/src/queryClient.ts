import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/client';

/**
 * One factory for the app and the tests, so both share the same caching rules.
 *
 * - staleTime 30 s: data a route loader just fetched is not refetched again the moment the
 *   page mounts. Our own changes (save settings, import, delete) update or invalidate the cache.
 * - retry once: a failing page shows its error after about a second, not after three retries.
 *   Never for 401: signing in again is the only cure.
 * - any 401 (the session expired or was signed out elsewhere) calls `onUnauthenticated`,
 *   which sends the pilot to the sign-in page.
 */
export function createQueryClient(
  overrides: { retry?: boolean | number; onUnauthenticated?: () => void } = {},
) {
  const onError = (error: Error) => {
    if (isUnauthenticated(error)) overrides.onUnauthenticated?.();
  };
  const retries = overrides.retry ?? 1;
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) =>
          !isUnauthenticated(error) &&
          (typeof retries === 'number' ? failureCount < retries : retries),
      },
    },
  });
}

const isUnauthenticated = (error: unknown) => error instanceof ApiError && error.status === 401;
