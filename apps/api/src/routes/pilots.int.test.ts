import {
  createAuthRepository,
  createBriefingRepository,
  createDb,
  createFlightPlanRepository,
  createHazardRepository,
  createPilotRepository,
  createWeatherRepository,
  pingDb,
  type DbConnection,
} from '@ofplens/db';
import { countRows, createTestDatabase, type TestDatabase } from '@ofplens/db/testing';
import { loadFixture } from '@ofplens/ofp/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app';
import { SESSION_COOKIE } from '../auth/sessions';
import { createFakeSimbrief, createFakeWeatherClient } from '../testing/fakes';

/**
 * Two pilots on one server, the real way: signed in with cookies (development sign-in), real
 * Postgres, every repository real. Only SimBrief and the weather are faked.
 */
let testDb: TestDatabase;
let conn: DbConnection;
let app: App;

beforeAll(async () => {
  testDb = await createTestDatabase();
  conn = createDb(testDb.url);
  app = await buildApp({
    pingDb: () => pingDb(conn.db),
    auth: createAuthRepository(conn.db),
    devSignIn: true,
    rateLimits: false,
    pilots: createPilotRepository(conn.db),
    flightPlans: createFlightPlanRepository(conn.db),
    weatherReports: createWeatherRepository(conn.db),
    hazards: createHazardRepository(conn.db),
    briefings: createBriefingRepository(conn.db),
    weather: createFakeWeatherClient(),
    hazardFeeds: { fetchAdvisories: () => Promise.resolve({ advisories: [], unavailable: [] }) },
    // Both pilots happen to plan with the same SimBrief account.
    simbrief: createFakeSimbrief(() => loadFixture('eddb-eddm-c750-kgs')),
  });
});
afterAll(async () => {
  await app.close();
  await conn.close();
  await testDb.destroy();
});

/** Signs in by name and returns a function that sends requests with that pilot's cookie. */
async function signIn(name: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/dev', payload: { name } });
  expect(res.statusCode).toBe(204);
  const token = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  return (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, cookies: { [SESSION_COOKIE]: token }, ...(payload && { payload }) });
}

describe('two pilots on one server', () => {
  it('each sees and changes only their own plans', async () => {
    const ana = await signIn('Ana');
    const ben = await signIn('Ben');
    for (const pilot of [ana, ben]) {
      const saved = await pilot('PUT', '/api/pilot', {
        simbriefUsername: 'sharedaccount',
        weightUnit: 'kgs',
      });
      expect(saved.statusCode).toBe(200);
    }

    // Ana imports a plan and checks its weather.
    const imported = await ana('POST', '/api/flight-plans/import');
    expect(imported.statusCode).toBe(201);
    const anasPlan = imported.json<{ id: string }>().id;
    expect((await ana('POST', `/api/flight-plans/${anasPlan}/weather/refresh`)).statusCode).toBe(
      200,
    );
    const anasRows = {
      plans: await countRows(conn.db, 'flight_plans'),
      waypoints: await countRows(conn.db, 'waypoints'),
      weather: await countRows(conn.db, 'weather_reports'),
    };

    // Ben has no history, and every route on Ana's plan answers as if it did not exist.
    expect((await ben('GET', '/api/flight-plans')).json()).toEqual({ items: [], nextCursor: null });
    for (const [method, path] of [
      ['GET', ''],
      ['DELETE', ''],
      ['GET', '/weather'],
      ['POST', '/weather/refresh'],
      ['GET', '/hazards'],
      ['POST', '/hazards/refresh'],
      ['GET', '/briefings/latest'],
      ['POST', '/briefings'],
    ] as const) {
      const res = await ben(method, `/api/flight-plans/${anasPlan}${path}`);
      expect(res.statusCode, `${method} ${path}`).toBe(404);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('FLIGHT_PLAN_NOT_FOUND');
    }
    expect({
      plans: await countRows(conn.db, 'flight_plans'),
      waypoints: await countRows(conn.db, 'waypoints'),
      weather: await countRows(conn.db, 'weather_reports'),
    }).toEqual(anasRows);

    // Ben imports the same SimBrief plan: his own copy, which he can delete without touching Ana's.
    const bensImport = await ben('POST', '/api/flight-plans/import');
    expect(bensImport.statusCode).toBe(201);
    const bensPlan = bensImport.json<{ id: string }>().id;
    expect(bensPlan).not.toBe(anasPlan);
    expect((await ben('DELETE', `/api/flight-plans/${bensPlan}`)).statusCode).toBe(204);

    const anasList = (await ana('GET', '/api/flight-plans')).json<{ items: { id: string }[] }>();
    expect(anasList.items.map((i) => i.id)).toEqual([anasPlan]);
    expect((await ana('GET', `/api/flight-plans/${anasPlan}`)).statusCode).toBe(200);
  });

  it('a pilot who signs in again is the same pilot, with the same history', async () => {
    const again = await signIn('Ana');
    const list = (await again('GET', '/api/flight-plans')).json<{ items: unknown[] }>();
    expect(list.items).toHaveLength(1);
    expect((await again('GET', '/api/pilot')).json()).toMatchObject({
      pilot: { simbriefUsername: 'sharedaccount' },
    });
  });
});
