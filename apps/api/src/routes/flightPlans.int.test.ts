import {
  createDb,
  createFlightPlanRepository,
  createPilotRepository,
  pingDb,
  type DbConnection,
} from '@ofplens/db';
import { countRows, createTestDatabase, type TestDatabase } from '@ofplens/db/testing';
import { loadFixture } from '@ofplens/ofp/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app';
import { createFakeSimbrief } from '../testing/fakes';

/**
 * The import end to end through the real app and a real Postgres. Only SimBrief is faked.
 * Each test starts a fresh app on the same database, the way a server restart would.
 */
let testDb: TestDatabase;
let conn: DbConnection;
let app: App | undefined;

beforeAll(async () => {
  testDb = await createTestDatabase();
  conn = createDb(testDb.url);
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(async () => {
  await conn.close();
  await testDb.destroy();
});

async function startApp(fixture: string) {
  app = await buildApp({
    pingDb: () => pingDb(conn.db),
    pilots: createPilotRepository(conn.db),
    flightPlans: createFlightPlanRepository(conn.db),
    simbrief: createFakeSimbrief(() => loadFixture(fixture)),
  });
  return app;
}

const planCount = () => countRows(conn.db, 'flight_plans');

describe('importing through the API into Postgres', () => {
  it('saves settings, imports a plan, and keeps one copy across repeats and restarts', async () => {
    const first = await startApp('ksfo-kjfk-b739-lbs');
    const saved = await first.inject({
      method: 'PUT',
      url: '/api/pilot',
      payload: { simbriefUsername: 'jetpilot', weightUnit: 'lbs' },
    });
    expect(saved.statusCode).toBe(200);

    const created = await first.inject({ method: 'POST', url: '/api/flight-plans/import' });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();

    const again = await first.inject({ method: 'POST', url: '/api/flight-plans/import' });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id, created: false });
    await first.close();

    // A new app instance on the same database, like restarting the server.
    const restarted = await startApp('ksfo-kjfk-b739-lbs');
    const afterRestart = await restarted.inject({
      method: 'POST',
      url: '/api/flight-plans/import',
    });
    expect(afterRestart.json()).toMatchObject({ id, created: false });
    expect(await planCount()).toBe(1);
  });

  it('adds a second row when SimBrief has a newer plan', async () => {
    const before = await planCount();
    const next = await startApp('eddf-lepa-a339-noalt');

    const res = await next.inject({ method: 'POST', url: '/api/flight-plans/import' });

    expect(res.statusCode).toBe(201);
    expect(await planCount()).toBe(before + 1);
  });
});
