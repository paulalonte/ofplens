import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  flightPlanFuel,
  flightPlans,
  flightPlanWeights,
  pilots,
  waypoints,
  weatherReports,
  type NewFlightPlanRow,
} from './schema';
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
});

async function insertPilot() {
  const [pilot] = await testDb.db
    .insert(pilots)
    .values({ simbriefUsername: 'jetpilot' })
    .returning();
  return pilot!;
}

function planRow(pilotId: string, overrides: Partial<NewFlightPlanRow> = {}): NewFlightPlanRow {
  return {
    pilotId,
    simbriefRequestId: '192980256',
    generatedAt: new Date('2026-11-09T13:28:39Z'),
    units: 'kgs',
    aircraftIcao: 'C750',
    originIcao: 'EDDB',
    originName: 'BERLIN BRANDENBURG',
    originUtcOffsetMin: 60,
    destinationIcao: 'EDDM',
    destinationName: 'MUNICH',
    destinationUtcOffsetMin: 60,
    route: 'LURO4B LUROS Y211',
    cruiseAltitudeFt: 28000,
    routeDistanceNm: 333,
    estOut: new Date('2026-11-09T14:00:00Z'),
    estOff: new Date('2026-11-09T14:10:00Z'),
    estOn: new Date('2026-11-09T14:59:31Z'),
    estIn: new Date('2026-11-09T15:07:31Z'),
    blockTimeS: 4051,
    airTimeS: 2971,
    rawOfp: { params: { request_id: '192980256' } },
    ...overrides,
  };
}

/** Postgres error code (SQLSTATE) of a failed query, e.g. 23505 unique violation. */
async function sqlState(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
    return undefined;
  } catch (err) {
    const pgError = (err as { cause?: { code?: string } }).cause ?? (err as { code?: string });
    return pgError.code;
  }
}

describe('migrations', () => {
  it('create every table on an empty database', async () => {
    const rows = await testDb.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `);
    expect(rows.map((r) => r.table_name)).toEqual([
      'briefings',
      'flight_plan_fuel',
      'flight_plan_weights',
      'flight_plans',
      'pilots',
      'waypoints',
      'weather_reports',
    ]);
  });
});

describe('flight_plans constraints', () => {
  it('stores a plan with its children', async () => {
    const pilot = await insertPilot();
    const [plan] = await testDb.db.insert(flightPlans).values(planRow(pilot.id)).returning();

    await testDb.db.insert(flightPlanFuel).values({
      flightPlanId: plan!.id,
      ramp: 2432,
      taxi: 68,
      trip: 992,
      contingency: 301,
      alternate: 767,
      finalReserve: 304,
      extra: 0,
      landing: 1372,
    });
    await testDb.db.insert(waypoints).values({
      flightPlanId: plan!.id,
      seq: 0,
      ident: 'DB068',
      type: 'wpt',
      lat: 52.36,
      lon: 13.5,
      altitudeFt: 5000,
      windDirDeg: 200,
      windSpeedKt: 10,
      oatC: 2,
      elapsedS: 120,
      fuelOnBoard: 2300,
    });

    const [stored] = await testDb.db.select().from(flightPlans).where(eq(flightPlans.id, plan!.id));
    expect(stored).toMatchObject({
      simbriefRequestId: '192980256',
      originIcao: 'EDDB',
      estOn: new Date('2026-11-09T14:59:31Z'),
      rawOfp: { params: { request_id: '192980256' } },
    });
    expect(stored!.importedAt).toBeInstanceOf(Date);
  });

  it('allows each SimBrief request only once (the idempotent import key)', async () => {
    const pilot = await insertPilot();
    await testDb.db.insert(flightPlans).values(planRow(pilot.id));

    expect(await sqlState(testDb.db.insert(flightPlans).values(planRow(pilot.id)))).toBe('23505');
  });

  it('rejects units other than kgs and lbs', async () => {
    const pilot = await insertPilot();
    const row = { ...planRow(pilot.id), units: 'tons' } as unknown as NewFlightPlanRow;

    expect(await sqlState(testDb.db.insert(flightPlans).values(row))).toBe('23514');
  });

  it('requires alternate icao, name and offset together', async () => {
    const pilot = await insertPilot();

    expect(
      await sqlState(
        testDb.db.insert(flightPlans).values(planRow(pilot.id, { alternateIcao: 'EDDF' })),
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        testDb.db.insert(flightPlans).values(
          planRow(pilot.id, {
            alternateIcao: 'EDDF',
            alternateName: 'FRANKFURT/MAIN',
            alternateUtcOffsetMin: 60,
          }),
        ),
      ),
    ).toBeUndefined();
  });

  it('keeps waypoint order unique per plan', async () => {
    const pilot = await insertPilot();
    const [plan] = await testDb.db.insert(flightPlans).values(planRow(pilot.id)).returning();
    const fix = {
      flightPlanId: plan!.id,
      seq: 0,
      ident: 'A',
      type: 'wpt',
      lat: 0,
      lon: 0,
      altitudeFt: 0,
      windDirDeg: 0,
      windSpeedKt: 0,
      oatC: 0,
      elapsedS: 0,
      fuelOnBoard: 0,
    };
    await testDb.db.insert(waypoints).values(fix);

    expect(await sqlState(testDb.db.insert(waypoints).values({ ...fix, ident: 'B' }))).toBe(
      '23505',
    );
  });

  it('deletes a plan’s children with it, and a pilot’s plans with the pilot', async () => {
    const pilot = await insertPilot();
    const [plan] = await testDb.db.insert(flightPlans).values(planRow(pilot.id)).returning();
    await testDb.db.insert(flightPlanWeights).values({
      flightPlanId: plan!.id,
      paxCount: 8,
      cargo: 200,
      payload: 835,
      zfw: 10873,
      tow: 13237,
      ldw: 12245,
    });
    await testDb.db.insert(weatherReports).values({
      flightPlanId: plan!.id,
      stationIcao: 'EDDB',
      role: 'origin',
      kind: 'metar',
      source: 'ofp',
      rawText: 'EDDB 091320Z AUTO 10005KT 9999 BKN009 03/01 Q1021',
    });

    await testDb.db.delete(flightPlans).where(eq(flightPlans.id, plan!.id));
    expect(await testDb.db.select().from(flightPlanWeights)).toEqual([]);
    expect(await testDb.db.select().from(weatherReports)).toEqual([]);

    await testDb.db.insert(flightPlans).values(planRow(pilot.id, { simbriefRequestId: '2' }));
    await testDb.db.delete(pilots).where(eq(pilots.id, pilot.id));
    expect(await testDb.db.select().from(flightPlans)).toEqual([]);
  });
});
