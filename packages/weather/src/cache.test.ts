import { describe, expect, it, vi } from 'vitest';
import { createCachedWeatherClient } from './cache';
import type { WeatherClient } from './client';
import type { LiveMetar } from './reports';

const metar = (icao: string): LiveMetar => ({
  icao,
  observedAt: '2026-11-10T08:50:00Z',
  raw: `METAR ${icao} 100850Z 00000KT 9999 CLR`,
  reportedCategory: 'VFR',
  wind: null,
  visibility: null,
  clouds: [],
  temperatureC: null,
  dewpointC: null,
  altimeterHpa: null,
});

function fakeClient(available: string[]) {
  const fetchMetars = vi.fn((icaos: readonly string[]) =>
    Promise.resolve(new Map(icaos.filter((i) => available.includes(i)).map((i) => [i, metar(i)]))),
  );
  const fetchTafs = vi.fn(() => Promise.resolve(new Map()));
  return { fetchMetars, fetchTafs } satisfies WeatherClient;
}

describe('createCachedWeatherClient', () => {
  it('serves repeats from the cache and only asks for missing stations', async () => {
    const inner = fakeClient(['EDDB', 'EDDM', 'EDDF']);
    const cached = createCachedWeatherClient(inner, { now: () => 0 });

    await cached.fetchMetars(['EDDB', 'EDDM']);
    const second = await cached.fetchMetars(['eddb', 'EDDM', 'EDDF']);

    expect(inner.fetchMetars.mock.calls).toEqual([[['EDDB', 'EDDM']], [['EDDF']]]);
    expect([...second.keys()]).toEqual(['EDDB', 'EDDM', 'EDDF']);
  });

  it('asks again once the entry is 5 minutes old', async () => {
    let time = 0;
    const inner = fakeClient(['EDDB']);
    const cached = createCachedWeatherClient(inner, { now: () => time });

    await cached.fetchMetars(['EDDB']);
    time = 4 * 60_000;
    await cached.fetchMetars(['EDDB']);
    time = 5 * 60_000;
    await cached.fetchMetars(['EDDB']);

    expect(inner.fetchMetars).toHaveBeenCalledTimes(2);
  });

  it('remembers "no report" too', async () => {
    const inner = fakeClient([]);
    const cached = createCachedWeatherClient(inner, { now: () => 0 });

    expect((await cached.fetchMetars(['ZZZZ'])).size).toBe(0);
    expect((await cached.fetchMetars(['ZZZZ'])).size).toBe(0);
    expect(inner.fetchMetars).toHaveBeenCalledOnce();
  });

  it('does not cache failures', async () => {
    const inner = fakeClient(['EDDB']);
    inner.fetchMetars.mockRejectedValueOnce(new Error('down'));
    const cached = createCachedWeatherClient(inner, { now: () => 0 });

    await expect(cached.fetchMetars(['EDDB'])).rejects.toThrow('down');
    await expect(cached.fetchMetars(['EDDB'])).resolves.toHaveProperty('size', 1);
  });

  it('keeps METARs and TAFs apart', async () => {
    const inner = fakeClient(['EDDB']);
    const cached = createCachedWeatherClient(inner, { now: () => 0 });

    await cached.fetchMetars(['EDDB']);
    await cached.fetchTafs(['EDDB']);

    expect(inner.fetchTafs).toHaveBeenCalledOnce();
  });
});
