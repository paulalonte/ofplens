import {
  createDb,
  createFlightPlanRepository,
  createPilotRepository,
  createWeatherRepository,
  type DbConnection,
} from '@ofplens/db';
import { createTestDatabase, truncateAll, type TestDatabase } from '@ofplens/db/testing';
import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { createCachedWeatherClient, createWeatherClient } from '@ofplens/weather';
import { loadWeatherFixture } from '@ofplens/weather/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  briefingTools,
  getFlightPlan,
  getPlannedWeather,
  getWeather,
  ToolError,
  type ToolDeps,
} from './tools';

/**
 * The agent's tools on a real Postgres database, with aviationweather.gov answered from the
 * captured responses at the HTTP level (real client, real cache). No LLM involved.
 */
let testDb: TestDatabase;
let conn: DbConnection;

beforeAll(async () => {
  testDb = await createTestDatabase();
  conn = createDb(testDb.url);
});
beforeEach(async () => {
  await truncateAll(conn.db);
  await createPilotRepository(conn.db).save({ simbriefUsername: 'jetpilot', weightUnit: 'kgs' });
});
afterAll(async () => {
  await conn.close();
  await testDb.destroy();
});

const urlOf = (input: string | URL | Request) =>
  input instanceof Request ? input.url : input.toString();

function deps({ down = false } = {}): ToolDeps {
  const fetch = vi.fn((input: string | URL | Request) => {
    if (down) return Promise.resolve(new Response('', { status: 503 }));
    const url = new URL(urlOf(input));
    const ids = (url.searchParams.get('ids') ?? '').split(',');
    const all = loadWeatherFixture(url.pathname.endsWith('/metar') ? 'metar' : 'taf');
    const body = all.filter((r) => ids.includes(r.icaoId as string));
    return Promise.resolve(
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
    );
  });
  return {
    flightPlans: createFlightPlanRepository(conn.db),
    weatherReports: createWeatherRepository(conn.db),
    weather: createCachedWeatherClient(createWeatherClient({ fetch, retryDelayMs: 0 })),
  };
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

describe('get_flight_plan', () => {
  it('describes the plan with airports, times, route and waypoint ETAs', async () => {
    const id = await importPlan('eddb-eddm-c750-kgs');

    const out = getFlightPlan.output.parse(await getFlightPlan.run({ flightPlanId: id }, deps()));

    expect(out).toMatchObject({
      flightPlanId: id,
      callsign: 'N70P',
      aircraft: { icao: 'C750', name: 'CITATION X' },
      airports: [
        { role: 'origin', icao: 'EDDB', runway: '06L', utcOffsetMin: 60 },
        { role: 'destination', icao: 'EDDM', runway: '08R' },
        { role: 'alternate', icao: 'EDDF' },
      ],
      times: { out: '2026-11-09T14:00:00Z', off: '2026-11-09T14:10:00Z' },
      route: { cruiseFlightLevel: 280, distanceNm: 333 },
    });
    expect(out.waypoints).toHaveLength(19);
    // Off 14:10:00Z + 00:04:05 elapsed.
    expect(out.waypoints[1]).toEqual({
      seq: 1,
      ident: 'DB069',
      name: 'DB069',
      stage: 'CLB',
      altitudeFt: 13600,
      eta: '2026-11-09T14:14:05Z',
    });
  });

  it('never gives the model fuel, weights or block time', async () => {
    const id = await importPlan('ksfo-kjfk-b739-lbs');
    const plan = parseOfp(loadFixture('ksfo-kjfk-b739-lbs'));

    const out = await getFlightPlan.run({ flightPlanId: id }, deps());

    // No such fields at any depth (checked by key, so a waypoint like JAMESTOWN is fine)…
    const keys = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key.toLowerCase());
          collect(inner);
        }
      }
    };
    collect(out);
    for (const forbidden of [
      'fuel',
      'fuelonboard',
      'weights',
      'payload',
      'zfw',
      'tow',
      'ldw',
      'units',
      'blocktimes',
      'airtimes',
    ]) {
      expect(keys).not.toContain(forbidden);
    }

    // …and none of the plan's fuel or weight figures appear as numbers anywhere.
    const numbers = JSON.stringify(out).match(/\d+/g)?.map(Number) ?? [];
    for (const figure of [...Object.values(plan.fuel), ...Object.values(plan.weights)]) {
      if (figure > 999) expect(numbers).not.toContain(figure);
    }
  });

  it('lists only origin and destination when there is no alternate', async () => {
    const id = await importPlan('eddf-lepa-a339-noalt');
    const out = await getFlightPlan.run({ flightPlanId: id }, deps());
    expect(out.airports.map((a) => a.role)).toEqual(['origin', 'destination']);
  });
});

describe('get_planned_weather', () => {
  it('returns the OFP reports decoded, each with a citable reportId', async () => {
    const id = await importPlan('eddb-eddm-c750-kgs');

    const out = getPlannedWeather.output.parse(
      await getPlannedWeather.run({ flightPlanId: id }, deps()),
    );

    const eddb = out.stations.find((s) => s.icao === 'EDDB')!;
    expect(eddb.metar).toEqual({
      reportId: 'dispatch:metar:EDDB:2026-11-09T1320Z',
      raw: 'EDDB 091320Z AUTO 10005KT 9999 BKN009 03/01 Q1021 BECMG SCT008',
      observedAt: '2026-11-09T13:20:00Z',
      flightCategory: 'IFR',
      ceilingFt: 900,
      visibilitySm: 6.21,
      visibilityOrMore: true,
      wind: { directionDeg: 100, variable: false, speedKt: 5, gustKt: null },
    });
    expect(eddb.taf?.reportId).toBe('dispatch:taf:EDDB:2026-11-09T1100Z');
    expect(out.stations.map((s) => [s.icao, s.metar?.flightCategory])).toEqual([
      ['EDDB', 'IFR'],
      ['EDDM', 'IFR'],
      ['EDDF', 'MVFR'],
    ]);
  });
});

describe('get_weather', () => {
  it('fetches, stores and compares live weather', async () => {
    const id = await importPlan('eddb-eddm-c750-kgs');

    const out = getWeather.output.parse(await getWeather.run({ flightPlanId: id }, deps()));

    expect(out.liveAvailable).toBe(true);
    expect(out.note).toBeNull();
    expect(out.checkedAt).not.toBeNull();
    const byIcao = Object.fromEntries(out.stations.map((s) => [s.icao, s]));
    expect(byIcao.EDDB).toMatchObject({
      metar: {
        reportId: 'live:metar:EDDB:2026-11-10T0850Z',
        flightCategory: 'LIFR',
        ceilingFt: 400,
      },
      changedSinceDispatch: true,
      newerTafThanDispatch: true,
    });
    expect(byIcao.EDDM).toMatchObject({
      metar: { flightCategory: 'IFR' },
      changedSinceDispatch: false,
    });
    expect(byIcao.EDDF).toMatchObject({
      metar: { flightCategory: 'VFR' },
      changedSinceDispatch: true,
    });

    // Stored like a refresh from the web app: the weather endpoint now shows it too.
    const stored = await createWeatherRepository(conn.db).forPlan(id);
    expect(stored?.live).toHaveLength(6);
  });

  it('says when live weather is unavailable instead of failing', async () => {
    const id = await importPlan('eddb-eddm-c750-kgs');

    const out = await getWeather.run({ flightPlanId: id }, deps({ down: true }));

    expect(out.liveAvailable).toBe(false);
    expect(out.note).toMatch(/unavailable/);
    expect(out.stations.every((s) => s.metar === null && !s.changedSinceDispatch)).toBe(true);
  });
});

describe('all tools', () => {
  it.each(briefingTools.map((t) => [t.name, t] as const))(
    '%s reports an unknown plan as a tool error and rejects a bad id',
    async (_name, tool) => {
      await expect(
        tool.run({ flightPlanId: '00000000-0000-4000-8000-000000000000' }, deps()),
      ).rejects.toBeInstanceOf(ToolError);
      expect(tool.input.safeParse({ flightPlanId: 'nope' }).success).toBe(false);
    },
  );

  it('have unique names and descriptions for the model', () => {
    expect(new Set(briefingTools.map((t) => t.name)).size).toBe(briefingTools.length);
    for (const tool of briefingTools) expect(tool.description.length).toBeGreaterThan(40);
  });
});
