import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFlightPlanRepository, PilotNotFoundError } from './flightPlans';
import { createPilotRepository } from './pilots';
import { flightPlans, weatherReports } from './schema';
import { createTestDatabase, truncateAll, type TestDatabase } from './testing';

let testDb: TestDatabase;
beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await testDb.destroy();
});
beforeEach(async () => {
  await truncateAll(testDb.db);
  await createPilotRepository(testDb.db).save({ simbriefUsername: 'jetpilot', weightUnit: 'kgs' });
});

function input(fixture: string) {
  const rawOfp = loadFixture(fixture);
  return { simbriefUsername: 'jetpilot', plan: parseOfp(rawOfp), rawOfp };
}

/** Row counts of every flight plan table. */
async function counts() {
  const [row] = await testDb.db.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from flight_plans) as plans,
      (select count(*)::int from flight_plan_fuel) as fuel,
      (select count(*)::int from flight_plan_weights) as weights,
      (select count(*)::int from waypoints) as waypoints,
      (select count(*)::int from weather_reports) as weather
  `);
  return row;
}

describe('flight plan import (Postgres)', () => {
  it('stores the plan with fuel, weights, every waypoint, OFP weather and the raw OFP', async () => {
    const repo = createFlightPlanRepository(testDb.db);
    const { plan, rawOfp, simbriefUsername } = input('eddb-eddm-c750-kgs');

    const result = await repo.import({ simbriefUsername, plan, rawOfp });

    expect(result).toEqual({ id: expect.any(String), created: true });
    expect(await counts()).toEqual({ plans: 1, fuel: 1, weights: 1, waypoints: 19, weather: 6 });

    const [row] = await testDb.db.select().from(flightPlans).where(eq(flightPlans.id, result.id));
    expect(row).toMatchObject({
      simbriefRequestId: '192980256',
      originIcao: 'EDDB',
      alternateIcao: 'EDDF',
      estIn: new Date('2026-11-09T15:07:31Z'),
      blockTimeS: 4051,
    });
    expect(row!.rawOfp).toEqual(rawOfp);

    const reports = await testDb.db
      .select({
        station: weatherReports.stationIcao,
        role: weatherReports.role,
        kind: weatherReports.kind,
      })
      .from(weatherReports)
      .orderBy(weatherReports.id);
    expect(reports).toEqual([
      { station: 'EDDB', role: 'origin', kind: 'metar' },
      { station: 'EDDB', role: 'origin', kind: 'taf' },
      { station: 'EDDM', role: 'destination', kind: 'metar' },
      { station: 'EDDM', role: 'destination', kind: 'taf' },
      { station: 'EDDF', role: 'alternate', kind: 'metar' },
      { station: 'EDDF', role: 'alternate', kind: 'taf' },
    ]);
  });

  it('stores a plan without an alternate', async () => {
    const result = await createFlightPlanRepository(testDb.db).import(
      input('eddf-lepa-a339-noalt'),
    );

    const [row] = await testDb.db.select().from(flightPlans).where(eq(flightPlans.id, result.id));
    expect(row).toMatchObject({
      alternateIcao: null,
      alternateName: null,
      alternateUtcOffsetMin: null,
    });
    expect(await counts()).toMatchObject({ waypoints: 28, weather: 4 });
  });

  it('imports the same SimBrief plan only once', async () => {
    const repo = createFlightPlanRepository(testDb.db);

    const first = await repo.import(input('ksfo-kjfk-b739-lbs'));
    const second = await repo.import(input('ksfo-kjfk-b739-lbs'));

    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect(await counts()).toEqual({ plans: 1, fuel: 1, weights: 1, waypoints: 30, weather: 6 });
  });

  it('keeps one copy when two imports of the same plan race', async () => {
    const repo = createFlightPlanRepository(testDb.db);

    const results = await Promise.all([
      repo.import(input('eddb-eddm-c750-kgs')),
      repo.import(input('eddb-eddm-c750-kgs')),
    ]);

    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    expect(results[0].id).toBe(results[1].id);
    expect(await counts()).toMatchObject({ plans: 1, waypoints: 19 });
  });

  it('stores different plans side by side', async () => {
    const repo = createFlightPlanRepository(testDb.db);
    await repo.import(input('eddb-eddm-c750-kgs'));
    await repo.import(input('ksfo-kjfk-b739-lbs'));
    await repo.import(input('eddf-lepa-a339-noalt'));

    expect(await counts()).toEqual({ plans: 3, fuel: 3, weights: 3, waypoints: 77, weather: 16 });
  });

  it('writes nothing when a later step fails (one transaction)', async () => {
    const { plan, rawOfp, simbriefUsername } = input('eddb-eddm-c750-kgs');
    // Plan, fuel and weights insert fine; the waypoint insert then fails on a non-integer.
    plan.waypoints[5] = { ...plan.waypoints[5]!, altitudeFt: 1.5 };

    await expect(
      createFlightPlanRepository(testDb.db).import({ simbriefUsername, plan, rawOfp }),
    ).rejects.toThrow();

    expect(await counts()).toEqual({ plans: 0, fuel: 0, weights: 0, waypoints: 0, weather: 0 });
  });

  it('refuses a plan for a pilot that does not exist', async () => {
    await expect(
      createFlightPlanRepository(testDb.db).import({
        ...input('eddb-eddm-c750-kgs'),
        simbriefUsername: 'nobody',
      }),
    ).rejects.toBeInstanceOf(PilotNotFoundError);
    expect(await counts()).toMatchObject({ plans: 0 });
  });
});
