import { countRows, createTestDatabase, truncateAll, type TestDatabase } from '@ofplens/db/testing';
import {
  createBriefingRepository,
  createDb,
  createFlightPlanRepository,
  createPilotRepository,
  createHazardRepository,
  createWeatherRepository,
  pingDb,
  type DbConnection,
} from '@ofplens/db';
import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { createCachedWeatherClient, createWeatherClient } from '@ofplens/weather';
import { loadWeatherFixture } from '@ofplens/weather/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../app';

/**
 * Live weather end to end through the API and Postgres. aviationweather.gov is replaced only at
 * the HTTP level: the real client and the real 5-minute cache run, answering from the captured
 * responses in fixtures/weather.
 */
let testDb: TestDatabase;
let conn: DbConnection;
let app: App | undefined;

beforeAll(async () => {
  testDb = await createTestDatabase();
  conn = createDb(testDb.url);
});
beforeEach(async () => {
  await truncateAll(conn.db);
  await createPilotRepository(conn.db).save({ simbriefUsername: 'jetpilot', weightUnit: 'kgs' });
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(async () => {
  await conn.close();
  await testDb.destroy();
});

type Entry = Record<string, unknown> & { icaoId: string };

/** The URL a fetch call was made with, as text. */
const urlOf = (input: string | URL | Request) =>
  input instanceof Request ? input.url : input.toString();

/** A fake aviationweather.gov: answers each request from the given reports, by `ids`. */
function fakeAviationWeather(
  metars: Entry[] = loadWeatherFixture('metar') as Entry[],
  tafs: Entry[] = loadWeatherFixture('taf') as Entry[],
) {
  const fake = {
    status: 200,
    metars,
    tafs,
    fetch: vi.fn((input: string | URL | Request) => {
      if (fake.status !== 200) return Promise.resolve(new Response('', { status: fake.status }));
      const url = new URL(urlOf(input));
      const ids = (url.searchParams.get('ids') ?? '').split(',');
      const all = url.pathname.endsWith('/metar') ? fake.metars : fake.tafs;
      const body = all.filter((r) => ids.includes(r.icaoId));
      return Promise.resolve(
        body.length === 0
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
      );
    }),
  };
  return fake;
}

async function start(fake: ReturnType<typeof fakeAviationWeather>, now = () => Date.now()) {
  app = await buildApp({
    pingDb: () => pingDb(conn.db),
    pilots: createPilotRepository(conn.db),
    flightPlans: createFlightPlanRepository(conn.db),
    weatherReports: createWeatherRepository(conn.db),
    hazards: createHazardRepository(conn.db),
    briefings: createBriefingRepository(conn.db),
    weather: createCachedWeatherClient(
      createWeatherClient({ fetch: fake.fetch, retryDelayMs: 0 }),
      { now },
    ),
  });
  return app;
}

async function importPlan(fixture: string): Promise<string> {
  const rawOfp = loadFixture(fixture);
  const { id } = await createFlightPlanRepository(conn.db).import({
    simbriefUsername: 'jetpilot',
    plan: parseOfp(rawOfp),
    rawOfp,
  });
  return id;
}

type Station = {
  role: string;
  icao: string;
  dispatch: { metar: { category: string | null; observedAt: string } | null; taf: unknown };
  live: {
    metar: { category: string | null; observedAt: string } | null;
    taf: { issuedAt: string } | null;
  };
  changedSinceDispatch: boolean;
  newerTaf: boolean;
};
type WeatherBody = { stations: Station[]; liveCheckedAt: string | null };

describe('GET /api/flight-plans/:id/weather', () => {
  it('shows the OFP weather decoded, and no live weather before a refresh', async () => {
    const id = await importPlan('eddb-eddm-c750-kgs');
    const a = await start(fakeAviationWeather());

    const res = await a.inject({ method: 'GET', url: `/api/flight-plans/${id}/weather` });

    expect(res.statusCode).toBe(200);
    const body = res.json<WeatherBody>();
    expect(body.liveCheckedAt).toBeNull();
    expect(body.stations.map((s) => [s.role, s.icao, s.dispatch.metar?.category])).toEqual([
      ['origin', 'EDDB', 'IFR'], // BKN009
      ['destination', 'EDDM', 'IFR'], // BKN007
      ['alternate', 'EDDF', 'MVFR'], // OVC014
    ]);
    expect(body.stations.every((s) => s.live.metar === null && !s.changedSinceDispatch)).toBe(true);
  });

  it('answers 404 for an unknown plan and 400 for a bad id', async () => {
    const a = await start(fakeAviationWeather());
    expect(
      (
        await a.inject({
          method: 'GET',
          url: '/api/flight-plans/00000000-0000-4000-8000-000000000000/weather',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await a.inject({ method: 'GET', url: '/api/flight-plans/nope/weather' })).statusCode,
    ).toBe(400);
  });
});

describe('POST /api/flight-plans/:id/weather/refresh', () => {
  it('stores live METAR and TAF per airport and compares them with dispatch', async () => {
    const id = await importPlan('eddb-eddm-c750-kgs');
    const fake = fakeAviationWeather();
    const a = await start(fake);

    const res = await a.inject({ method: 'POST', url: `/api/flight-plans/${id}/weather/refresh` });

    expect(res.statusCode).toBe(200);
    const body = res.json<WeatherBody>();
    expect(body.liveCheckedAt).not.toBeNull();
    const byIcao = Object.fromEntries(body.stations.map((s) => [s.icao, s]));
    // EDDB: IFR at dispatch (BKN009) → LIFR now (BKN004): changed.
    expect(byIcao.EDDB).toMatchObject({
      live: { metar: { category: 'LIFR', observedAt: '2026-11-10T08:50:00Z' } },
      changedSinceDispatch: true,
      newerTaf: true,
    });
    // EDDM: IFR at dispatch (BKN007) and IFR now (BKN005): newer, but not changed.
    expect(byIcao.EDDM).toMatchObject({
      live: { metar: { category: 'IFR' } },
      changedSinceDispatch: false,
    });
    // EDDF: MVFR at dispatch (OVC014) → VFR now (FEW011): changed.
    expect(byIcao.EDDF).toMatchObject({
      live: { metar: { category: 'VFR' } },
      changedSinceDispatch: true,
    });

    // One request per kind, for exactly the plan's three airports.
    expect(fake.fetch.mock.calls.map(([url]) => urlOf(url))).toEqual([
      'https://aviationweather.gov/api/data/metar?ids=EDDB,EDDM,EDDF&format=json',
      'https://aviationweather.gov/api/data/taf?ids=EDDB,EDDM,EDDF&format=json',
    ]);
    expect(await countRows(conn.db, 'weather_reports')).toBe(6 + 6); // OFP + live
  });

  it('serves a second refresh from the cache and never stores a report twice', async () => {
    let time = Date.parse('2026-11-10T09:00:00Z');
    const id = await importPlan('eddb-eddm-c750-kgs');
    const fake = fakeAviationWeather();
    const a = await start(fake, () => time);

    await a.inject({ method: 'POST', url: `/api/flight-plans/${id}/weather/refresh` });
    const first = await a.inject({ method: 'GET', url: `/api/flight-plans/${id}/weather` });
    await a.inject({ method: 'POST', url: `/api/flight-plans/${id}/weather/refresh` });

    expect(fake.fetch).toHaveBeenCalledTimes(2); // METAR + TAF, once
    expect(await countRows(conn.db, 'weather_reports')).toBe(12);

    // Six minutes later the cache has expired: asked again, same reports, still not duplicated.
    time += 6 * 60_000;
    const later = await a.inject({
      method: 'POST',
      url: `/api/flight-plans/${id}/weather/refresh`,
    });
    expect(fake.fetch).toHaveBeenCalledTimes(4);
    expect(await countRows(conn.db, 'weather_reports')).toBe(12);
    expect(
      later.json<WeatherBody>().liveCheckedAt! > first.json<WeatherBody>().liveCheckedAt!,
    ).toBe(true);
  });

  it('adds a newer report and shows it as the latest', async () => {
    let time = Date.parse('2026-11-10T09:00:00Z');
    const id = await importPlan('eddb-eddm-c750-kgs');
    const fake = fakeAviationWeather();
    const a = await start(fake, () => time);
    await a.inject({ method: 'POST', url: `/api/flight-plans/${id}/weather/refresh` });

    const eddb = fake.metars.find((m) => m.icaoId === 'EDDB')!;
    fake.metars = [
      ...fake.metars.filter((m) => m.icaoId !== 'EDDB'),
      {
        ...eddb,
        obsTime: (eddb.obsTime as number) + 1800,
        rawOb: 'METAR EDDB 100920Z AUTO 34004KT 9999 FEW030 05/02 Q1014',
      },
    ];
    time += 6 * 60_000;
    const res = await a.inject({ method: 'POST', url: `/api/flight-plans/${id}/weather/refresh` });

    const eddbNow = res.json<WeatherBody>().stations.find((s) => s.icao === 'EDDB')!;
    expect(eddbNow.live.metar).toMatchObject({
      category: 'VFR',
      observedAt: '2026-11-10T09:20:00Z',
    });
    expect(eddbNow.changedSinceDispatch).toBe(true); // IFR → VFR
    expect(await countRows(conn.db, 'weather_reports')).toBe(13);
  });

  it('asks only for origin and destination when there is no alternate', async () => {
    const id = await importPlan('eddf-lepa-a339-noalt');
    const fake = fakeAviationWeather();
    const a = await start(fake);

    const res = await a.inject({ method: 'POST', url: `/api/flight-plans/${id}/weather/refresh` });

    expect(res.json<WeatherBody>().stations.map((s) => s.role)).toEqual(['origin', 'destination']);
    expect(urlOf(fake.fetch.mock.calls[0]![0])).toContain('ids=EDDF,LEPA&');
  });

  it('keeps going when an airport has no live report', async () => {
    const id = await importPlan('eddb-eddm-c750-kgs');
    const fake = fakeAviationWeather();
    fake.metars = fake.metars.filter((m) => m.icaoId !== 'EDDF');
    const a = await start(fake);

    const res = await a.inject({ method: 'POST', url: `/api/flight-plans/${id}/weather/refresh` });

    const eddf = res.json<WeatherBody>().stations.find((s) => s.icao === 'EDDF')!;
    expect(eddf.live.metar).toBeNull();
    expect(eddf.live.taf).not.toBeNull();
    expect(eddf.changedSinceDispatch).toBe(false);
  });

  it('answers 502 when aviationweather.gov is down, and keeps what was stored', async () => {
    let time = Date.parse('2026-11-10T09:00:00Z');
    const id = await importPlan('eddb-eddm-c750-kgs');
    const fake = fakeAviationWeather();
    const a = await start(fake, () => time);
    await a.inject({ method: 'POST', url: `/api/flight-plans/${id}/weather/refresh` });

    fake.status = 503;
    time += 6 * 60_000;
    const res = await a.inject({ method: 'POST', url: `/api/flight-plans/${id}/weather/refresh` });

    expect(res.statusCode).toBe(502);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('WEATHER_UNAVAILABLE');
    const stored = await a.inject({ method: 'GET', url: `/api/flight-plans/${id}/weather` });
    expect(
      stored.json<WeatherBody>().stations.find((s) => s.icao === 'EDDB')!.live.metar,
    ).not.toBeNull();
  });

  it('answers 404 for an unknown plan without calling aviationweather.gov', async () => {
    const fake = fakeAviationWeather();
    const a = await start(fake);

    const res = await a.inject({
      method: 'POST',
      url: '/api/flight-plans/00000000-0000-4000-8000-000000000000/weather/refresh',
    });

    expect(res.statusCode).toBe(404);
    expect(fake.fetch).not.toHaveBeenCalled();
  });
});
