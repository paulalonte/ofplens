import type { HazardClient, HazardFeeds } from './client';

/**
 * Keeps the last successful read of the feeds for a while (5 minutes by default): they cover
 * the whole world, so every plan shares one copy. A read with a feed missing is kept for a
 * shorter time, so the missing feed is tried again soon. In memory, per API process.
 */
export function createCachedHazardClient(
  client: HazardClient,
  {
    ttlMs = 5 * 60_000,
    partialTtlMs = 60_000,
    now = () => Date.now(),
  }: { ttlMs?: number; partialTtlMs?: number; now?: () => number } = {},
): HazardClient {
  let cached: { feeds: HazardFeeds; at: number } | null = null;
  let inFlight: Promise<HazardFeeds> | null = null;

  return {
    async fetchAdvisories() {
      if (cached) {
        const ttl = cached.feeds.unavailable.length > 0 ? partialTtlMs : ttlMs;
        if (now() - cached.at < ttl) return cached.feeds;
      }
      // Plans refreshed at the same moment share one request.
      inFlight ??= client
        .fetchAdvisories()
        .then((feeds) => {
          cached = { feeds, at: now() };
          return feeds;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}
