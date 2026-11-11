import { describe, expect, it, vi } from 'vitest';
import { USER_AGENT, WeatherUnavailableError } from '../http';
import { loadHazardFixture } from '../testing/fixtures';
import { createHazardClient } from './client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers each feed by the last path segment of the URL. */
function fakeFetch(answers: Record<string, () => Response>) {
  return vi.fn((url: string | URL | Request) => {
    const feed = new URL(url).pathname.split('/').at(-1)!;
    const answer = answers[feed];
    return answer ? Promise.resolve(answer()) : Promise.reject(new TypeError('fetch failed'));
  });
}

const client = (fetch: ReturnType<typeof fakeFetch>) =>
  createHazardClient({ fetch, retryDelayMs: 0, timeoutMs: 1000 });

describe('hazard client', () => {
  it('asks each feed once, identifying itself, and returns them together', async () => {
    const fetch = fakeFetch({
      isigmet: () => json(loadHazardFixture('isigmet')),
      airsigmet: () => json(loadHazardFixture('airsigmet')),
      gairmet: () => json(loadHazardFixture('gairmet')),
    });

    const { advisories, unavailable } = await client(fetch).fetchAdvisories();

    expect(fetch.mock.calls.map(([url]) => url as string).sort()).toEqual([
      'https://aviationweather.gov/api/data/airsigmet?format=json',
      'https://aviationweather.gov/api/data/gairmet?format=json',
      'https://aviationweather.gov/api/data/isigmet?format=json',
    ]);
    const init = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init[1].headers).get('user-agent')).toBe(USER_AGENT);
    expect(advisories).toHaveLength(125 + 4 + 31);
    expect(unavailable).toEqual([]);
  });

  it('treats "nothing valid" (204) as an empty feed', async () => {
    const empty = () => new Response(null, { status: 204 });
    const result = await client(
      fakeFetch({ isigmet: empty, airsigmet: empty, gairmet: empty }),
    ).fetchAdvisories();
    expect(result).toEqual({ advisories: [], unavailable: [] });
  });

  it('leaves out a feed that fails and says which', async () => {
    const result = await client(
      fakeFetch({
        isigmet: () => json(loadHazardFixture('isigmet')),
        airsigmet: () => json({ error: 'nope' }, 400),
        gairmet: () => json([]),
      }),
    ).fetchAdvisories();
    expect(result.unavailable).toEqual(['airsigmet']);
    expect(result.advisories).toHaveLength(125);
  });

  it('throws when no feed can be read', async () => {
    await expect(client(fakeFetch({})).fetchAdvisories()).rejects.toBeInstanceOf(
      WeatherUnavailableError,
    );
  });
});
