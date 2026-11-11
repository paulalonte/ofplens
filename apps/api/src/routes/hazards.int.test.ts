import { countRows, createTestDatabase, truncateAll, type TestDatabase } from '@ofplens/db/testing';
import {
  createBriefingRepository,
  createDb,
  createFlightPlanRepository,
  createHazardRepository,
  createPilotRepository,
  createWeatherRepository,
  pingDb,
  type DbConnection,
} from '@ofplens/db';
import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import {
  createCachedHazardClient,
  createHazardClient,
  type FlightPlanHazardsResponse,
} from '@ofplens/weather';
import { loadHazardFixture } from '@ofplens/weather/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../app';
import { createFakeWeatherClient } from '../testing/fakes';

/**
 * Route hazards end to end through the API and Postgres. aviationweather.gov is replaced only
 * at the HTTP level: the real client, cache and matching run on the captured feeds, plus
 * made-up SIGMETs over the EDDB → EDDM route (takeoff 9 Nov 14:10Z, FL280).
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

const unix = (iso: string) => Date.parse(iso) / 1000;

/** An international SIGMET over a box, as the isigmet feed sends it. */
const sigmet = (
  seriesId: string,
  [south, west, north, east]: [number, number, number, number],
  overrides: Record<string, unknown> = {},
) => ({
  icaoId: 'EDZZ',
  firId: 'EDUU',
  firName: 'EDUU RHEIN UIR',
  receiptTime: '2026-11-09T12:00:00.000Z',
  validTimeFrom: unix('2026-11-09T12:00:00Z'),
  validTimeTo: unix('2026-11-09T16:00:00Z'),
  seriesId,
  hazard: 'TS',
  qualifier: 'EMBD',
  base: null,
  top: 38000,
  geom: 'AREA',
  coords: [
    { lon: west, lat: south },
    { lon: east, lat: south },
    { lon: east, lat: north },
    { lon: west, lat: north },
  ],
  rawSigmet: `EDUU SIGMET ${seriesId} VALID 091200/091600 EDZZ- EDUU RHEIN UIR EMBD TS FCST`,
  ...overrides,
});

// Around PIKIB (between BEBKU and MAREM), and the same place above the flight.
const OVER_PIKIB = sigmet('A1', [50.8, 13.5, 51.0, 13.8]);
const ABOVE_PIKIB = sigmet('A2', [50.8, 13.5, 51.0, 13.8], {
  hazard: 'TURB',
  qualifier: 'SEV',
  base: 32000,
  top: 40000,
});

const urlOf = (input: string | URL | Request) =>
  input instanceof Request ? input.url : input.toString();

/** A fake aviationweather.gov: the captured feeds, with extra international SIGMETs. */
function fakeFeeds(extraSigmets: unknown[] = [OVER_PIKIB, ABOVE_PIKIB]) {
  const fake = {
    down: new Set<string>(),
    extraSigmets,
    fetch: vi.fn((input: string | URL | Request) => {
      const feed = new URL(urlOf(input)).pathname.split('/').at(-1)!;
      if (fake.down.has(feed)) return Promise.resolve(new Response('', { status: 503 }));
      const body =
        feed === 'isigmet'
          ? [...loadHazardFixture('isigmet'), ...fake.extraSigmets]
          : loadHazardFixture(feed as 'airsigmet' | 'gairmet');
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
      );
    }),
  };
  return fake;
}

async function start(
  fake: ReturnType<typeof fakeFeeds>,
  { now = () => new Date('2026-11-09T12:30:00Z'), clock = () => Date.now() } = {},
) {
  app = await buildApp({
    pingDb: () => pingDb(conn.db),
    pilots: createPilotRepository(conn.db),
    flightPlans: createFlightPlanRepository(conn.db),
    weatherReports: createWeatherRepository(conn.db),
    briefings: createBriefingRepository(conn.db),
    hazards: createHazardRepository(conn.db),
    weather: createFakeWeatherClient(),
    hazardFeeds: createCachedHazardClient(
      createHazardClient({ fetch: fake.fetch, retryDelayMs: 0 }),
      { now: clock },
    ),
    now,
  });
  return app;
}

async function importPlan(fixture = 'eddb-eddm-c750-kgs'): Promise<string> {
  const rawOfp = loadFixture(fixture);
  const { id } = await createFlightPlanRepository(conn.db).import({
    simbriefUsername: 'jetpilot',
    plan: parseOfp(rawOfp),
    rawOfp,
  });
  return id;
}

const refresh = (a: App, id: string) =>
  a.inject({ method: 'POST', url: `/api/flight-plans/${id}/hazards/refresh` });
const read = (a: App, id: string) =>
  a.inject({ method: 'GET', url: `/api/flight-plans/${id}/hazards` });

describe('GET /api/flight-plans/:id/hazards', () => {
  it('says the route was never checked before the first refresh', async () => {
    const id = await importPlan();
    const res = await read(await start(fakeFeeds()), id);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ checkedAt: null, takeoffAt: null, unavailable: [], hazards: [] });
  });

  it('answers 404 for an unknown plan and 400 for a bad id', async () => {
    const a = await start(fakeFeeds());
    expect((await read(a, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await refresh(a, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await read(a, 'nope')).statusCode).toBe(400);
  });
});

describe('POST /api/flight-plans/:id/hazards/refresh', () => {
  it('finds the SIGMET on the route, between the right fixes, and stores it', async () => {
    const id = await importPlan();
    const fake = fakeFeeds();
    const a = await start(fake);

    const res = await refresh(a, id);

    expect(res.statusCode).toBe(200);
    const body = res.json<FlightPlanHazardsResponse>();
    expect(body).toMatchObject({
      checkedAt: '2026-11-09T12:30:00.000Z',
      takeoffAt: '2026-11-09T14:10:00.000Z', // as planned: still ahead
      unavailable: [],
    });
    // Only the thunderstorm: the turbulence is above FL280, and nothing else of the real
    // 11 Nov feeds is valid on 9 Nov.
    expect(body.hazards).toHaveLength(1);
    expect(body.hazards[0]).toMatchObject({
      id: `isigmet:EDUU:A1:${unix('2026-11-09T12:00:00Z')}`,
      hazard: 'thunderstorm',
      detail: 'EMBD',
      topFt: 38000,
      fir: 'EDUU',
      segments: [{ fromIdent: 'BEBKU', toIdent: 'MAREM', fromSeq: 6, toSeq: 8 }],
    });
    expect(body.hazards[0]?.polygons[0]).toHaveLength(5);
    expect(fake.fetch).toHaveBeenCalledTimes(3);

    // Stored: GET answers the same without asking the feeds again.
    expect((await read(a, id)).json()).toEqual(body);
    expect(fake.fetch).toHaveBeenCalledTimes(3);
    expect(await countRows(conn.db, 'advisories')).toBe(1);
  });

  it('replaces the last check: an advisory gone from the feeds is gone from the plan', async () => {
    let time = Date.parse('2026-11-09T12:30:00Z');
    const id = await importPlan();
    const fake = fakeFeeds();
    const a = await start(fake, { clock: () => time });

    await refresh(a, id);
    fake.extraSigmets = [];
    time += 6 * 60_000; // past the 5-minute cache
    const body = (await refresh(a, id)).json<FlightPlanHazardsResponse>();

    expect(body.hazards).toEqual([]);
    expect(await countRows(conn.db, 'advisories')).toBe(0);
  });

  it('counts from now when the planned takeoff has passed', async () => {
    const id = await importPlan();
    // Taking off at 17:00Z, PIKIB is at 17:28Z: past the SIGMET (to 16:00Z) and its margin.
    const a = await start(fakeFeeds(), { now: () => new Date('2026-11-09T17:00:00Z') });

    const body = (await refresh(a, id)).json<FlightPlanHazardsResponse>();

    expect(body.takeoffAt).toBe('2026-11-09T17:00:00.000Z');
    expect(body.hazards).toEqual([]);
  });

  it('lists a feed that could not be read, and keeps the others', async () => {
    const id = await importPlan();
    const fake = fakeFeeds();
    fake.down.add('gairmet');

    const body = (await refresh(await start(fake), id)).json<FlightPlanHazardsResponse>();

    expect(body.unavailable).toEqual(['gairmet']);
    expect(body.hazards).toHaveLength(1);
  });

  it('answers 502 when no feed can be read, keeping the last check', async () => {
    let time = Date.parse('2026-11-09T12:30:00Z');
    const id = await importPlan();
    const fake = fakeFeeds();
    const a = await start(fake, { clock: () => time });
    await refresh(a, id);

    fake.down = new Set(['isigmet', 'airsigmet', 'gairmet']);
    time += 6 * 60_000;
    const res = await refresh(a, id);

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'HAZARDS_UNAVAILABLE' } });
    expect((await read(a, id)).json<FlightPlanHazardsResponse>().hazards).toHaveLength(1);
  });

  it('removes a plan’s hazards with the plan', async () => {
    const id = await importPlan();
    const a = await start(fakeFeeds());
    await refresh(a, id);

    expect((await a.inject({ method: 'DELETE', url: `/api/flight-plans/${id}` })).statusCode).toBe(
      204,
    );
    expect(await countRows(conn.db, 'advisories')).toBe(0);
  });
});
