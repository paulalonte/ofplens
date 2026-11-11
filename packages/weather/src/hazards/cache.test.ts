import { describe, expect, it, vi } from 'vitest';
import { createCachedHazardClient } from './cache';
import type { HazardFeeds } from './client';

const feeds = (unavailable: HazardFeeds['unavailable'] = []): HazardFeeds => ({
  advisories: [],
  unavailable,
});

describe('createCachedHazardClient', () => {
  it('reuses one read for five minutes, then reads again', async () => {
    let time = 0;
    const fetchAdvisories = vi.fn(() => Promise.resolve(feeds()));
    const client = createCachedHazardClient({ fetchAdvisories }, { now: () => time });

    await client.fetchAdvisories();
    time = 4 * 60_000;
    await client.fetchAdvisories();
    expect(fetchAdvisories).toHaveBeenCalledTimes(1);
    time = 5 * 60_000;
    await client.fetchAdvisories();
    expect(fetchAdvisories).toHaveBeenCalledTimes(2);
  });

  it('tries again after a minute when a feed was missing', async () => {
    let time = 0;
    const fetchAdvisories = vi.fn(() => Promise.resolve(feeds(['gairmet'])));
    const client = createCachedHazardClient({ fetchAdvisories }, { now: () => time });

    await client.fetchAdvisories();
    time = 60_000;
    await client.fetchAdvisories();
    expect(fetchAdvisories).toHaveBeenCalledTimes(2);
  });

  it('shares one request between callers and does not keep a failure', async () => {
    const fetchAdvisories = vi
      .fn<() => Promise<HazardFeeds>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(feeds());
    const client = createCachedHazardClient({ fetchAdvisories });

    const both = await Promise.allSettled([client.fetchAdvisories(), client.fetchAdvisories()]);
    expect(both.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(fetchAdvisories).toHaveBeenCalledTimes(1);
    await expect(client.fetchAdvisories()).resolves.toEqual(feeds());
  });
});
