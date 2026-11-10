import { QueryClient } from '@tanstack/react-query';

/**
 * One factory for the app and the tests, so both share the same caching rules.
 *
 * - staleTime 30 s: data a route loader just fetched is not refetched again the moment the
 *   page mounts. Our own changes (save settings, import, delete) update or invalidate the cache.
 * - retry once: a failing page shows its error after about a second, not after three retries.
 */
export function createQueryClient(overrides: { retry?: boolean | number } = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: overrides.retry ?? 1 },
    },
  });
}
