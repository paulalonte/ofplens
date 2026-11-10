import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFlightPlanRepository, InvalidCursorError, PilotNotFoundError } from './flightPlans';
import { MIGRATIONS_FOLDER } from './migrate';
import { createPilotRepository } from './pilots';
import { flightPlans, pilots, weatherReports } from './schema';
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

describe('reading a stored plan back (Postgres)', () => {
  it.each(['eddb-eddm-c750-kgs', 'ksfo-kjfk-b739-lbs', 'eddf-lepa-a339-noalt'])(
    '%s comes back exactly as parseOfp produced it',
    async (fixture) => {
      const repo = createFlightPlanRepository(testDb.db);
      const { id } = await repo.import(input(fixture));

      const stored = await repo.get(id);

      expect(stored).toEqual({
        id,
        importedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$/),
        plan: parseOfp(loadFixture(fixture)),
      });
    },
  );

  it.each(['eddb-eddm-c750-kgs', 'ksfo-kjfk-b739-lbs', 'eddf-lepa-a339-noalt'])(
    '%s: migration 0004 fills the flight data of a plan saved before it, like parseOfp',
    async (fixture) => {
      const repo = createFlightPlanRepository(testDb.db);
      const { id } = await repo.import(input(fixture));
      // As a plan saved before migration 0004 looked: the new columns empty.
      await testDb.db
        .update(flightPlans)
        .set({
          originElevationFt: null,
          destinationElevationFt: null,
          alternateElevationFt: null,
          gcDistanceNm: null,
          stepClimbs: [],
          avgIsaDevC: null,
          avgTropopauseFt: null,
          avgWindComponentKt: null,
        })
        .where(eq(flightPlans.id, id));

      const migration = readFileSync(resolve(MIGRATIONS_FOLDER, '0004_flight_data.sql'), 'utf8');
      const backfill = migration.slice(migration.indexOf('-- Backfill'));
      await testDb.db.transaction(async (tx) => {
        for (const statement of backfill.split('--> statement-breakpoint')) {
          await tx.execute(sql.raw(statement));
        }
      });

      expect((await repo.get(id))?.plan).toEqual(parseOfp(loadFixture(fixture)));
    },
  );

  it('returns null for an id that does not exist', async () => {
    await expect(
      createFlightPlanRepository(testDb.db).get('00000000-0000-4000-8000-000000000000'),
    ).resolves.toBeNull();
  });
});

describe('listing plans (Postgres)', () => {
  /** A stored copy of a fixture with its own request id and generation time. */
  async function importAt(generatedAt: string, requestId: string, fixture = 'eddb-eddm-c750-kgs') {
    const base = input(fixture);
    const plan = { ...base.plan, simbriefRequestId: requestId, generatedAt };
    return createFlightPlanRepository(testDb.db).import({ ...base, plan });
  }

  it('is empty before anything is imported', async () => {
    await expect(
      createFlightPlanRepository(testDb.db).list({ simbriefUsername: 'jetpilot', limit: 10 }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('lists newest first with what the history page shows', async () => {
    const repo = createFlightPlanRepository(testDb.db);
    await repo.import(input('eddb-eddm-c750-kgs')); // generated 13:28:39Z
    const { id } = await repo.import(input('ksfo-kjfk-b739-lbs')); // generated later

    const { items } = await repo.list({ simbriefUsername: 'jetpilot', limit: 10 });

    expect(items.map((i) => i.callsign)).toEqual(['UAL1234', 'N70P']);
    expect(items[0]).toEqual({
      id,
      simbriefRequestId: '193019508',
      generatedAt: expect.any(String),
      importedAt: expect.any(String),
      callsign: 'UAL1234',
      aircraftIcao: 'B739',
      originIcao: 'KSFO',
      destinationIcao: 'KJFK',
      alternateIcao: 'KEWR',
      out: '2026-11-10T01:00:00Z',
      blockTimeS: 19078,
      units: 'lbs',
    });
  });

  it('pages through every plan exactly once, even when two share a timestamp', async () => {
    const repo = createFlightPlanRepository(testDb.db);
    await importAt('2026-11-01T10:00:00Z', 'r1');
    await importAt('2026-11-02T10:00:00Z', 'r2');
    await importAt('2026-11-03T10:00:00Z', 'r3a');
    await importAt('2026-11-03T10:00:00Z', 'r3b'); // same second as r3a: id breaks the tie
    await importAt('2026-11-04T10:00:00Z', 'r4');

    const seen: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await repo.list({ simbriefUsername: 'jetpilot', limit: 2, cursor });
      seen.push(...page.items.map((i) => i.simbriefRequestId));
      pageSizes.push(page.items.length);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(pageSizes).toEqual([2, 2, 1]);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen[0]).toBe('r4');
    expect(seen.slice(1, 3).sort()).toEqual(['r3a', 'r3b']);
    expect(seen.slice(3)).toEqual(['r2', 'r1']);
  });

  it('has no next page when the last page is exactly full', async () => {
    await importAt('2026-11-01T10:00:00Z', 'r1');
    await importAt('2026-11-02T10:00:00Z', 'r2');

    const page = await createFlightPlanRepository(testDb.db).list({
      simbriefUsername: 'jetpilot',
      limit: 2,
    });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('only lists the given pilot’s plans', async () => {
    await importAt('2026-11-01T10:00:00Z', 'mine');
    await testDb.db.insert(pilots).values({ simbriefUsername: 'someoneelse' });
    const repo = createFlightPlanRepository(testDb.db);
    const theirs = input('ksfo-kjfk-b739-lbs');
    await repo.import({ ...theirs, simbriefUsername: 'someoneelse' });

    const { items } = await repo.list({ simbriefUsername: 'jetpilot', limit: 10 });

    expect(items.map((i) => i.simbriefRequestId)).toEqual(['mine']);
  });

  it.each(['nonsense', Buffer.from('2026-11-01T10:00:00Z|not-a-uuid').toString('base64url'), ''])(
    'rejects an invalid cursor %#',
    async (cursor) => {
      await expect(
        createFlightPlanRepository(testDb.db).list({
          simbriefUsername: 'jetpilot',
          limit: 2,
          cursor,
        }),
      ).rejects.toBeInstanceOf(InvalidCursorError);
    },
  );
});

describe('deleting a plan (Postgres)', () => {
  it('removes the plan and everything under it, once', async () => {
    const repo = createFlightPlanRepository(testDb.db);
    const { id } = await repo.import(input('eddb-eddm-c750-kgs'));
    await repo.import(input('ksfo-kjfk-b739-lbs'));

    await expect(repo.delete(id)).resolves.toBe(true);

    await expect(repo.get(id)).resolves.toBeNull();
    expect(await counts()).toEqual({ plans: 1, fuel: 1, weights: 1, waypoints: 30, weather: 6 });
    await expect(repo.delete(id)).resolves.toBe(false);
  });

  it('lets a deleted plan be imported again', async () => {
    const repo = createFlightPlanRepository(testDb.db);
    const first = await repo.import(input('eddb-eddm-c750-kgs'));
    await repo.delete(first.id);

    const again = await repo.import(input('eddb-eddm-c750-kgs'));

    expect(again.created).toBe(true);
    expect(again.id).not.toBe(first.id);
  });
});
