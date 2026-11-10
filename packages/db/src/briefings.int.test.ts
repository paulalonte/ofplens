import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBriefingRepository, INTERRUPTED_ERROR } from './briefings';
import { createFlightPlanRepository } from './flightPlans';
import { createPilotRepository } from './pilots';
import { flightPlans } from './schema';
import { countRows, createTestDatabase, truncateAll, type TestDatabase } from './testing';

let testDb: TestDatabase;
let planId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await testDb.destroy();
});
beforeEach(async () => {
  await truncateAll(testDb.db);
  await createPilotRepository(testDb.db).save({ simbriefUsername: 'jetpilot', weightUnit: 'kgs' });
  const rawOfp = loadFixture('eddb-eddm-c750-kgs');
  planId = (
    await createFlightPlanRepository(testDb.db).import({
      simbriefUsername: 'jetpilot',
      plan: parseOfp(rawOfp),
      rawOfp,
    })
  ).id;
});

const run = { flightPlanId: '', model: 'claude-haiku-5-5', promptVersion: 'briefing-v1' };
const result = {
  status: 'done' as const,
  output: { headline: 'ok' },
  toolCalls: [{ name: 'get_weather', ok: true, ms: 3 }],
  inputTokens: 10_000,
  outputTokens: 900,
  costUsd: 0.00145,
  latencyMs: 2400,
  error: null,
};

describe('briefing repository (Postgres)', () => {
  it('starts a pending run, then stores its outcome as the latest', async () => {
    const repo = createBriefingRepository(testDb.db);

    const started = await repo.start({ ...run, flightPlanId: planId });
    expect(started).toEqual({ id: expect.any(String) });
    expect(await repo.latest(planId)).toMatchObject({
      status: 'pending',
      model: 'claude-haiku-5-5',
    });

    await repo.finish(started!.id, result);

    expect(await repo.latest(planId)).toMatchObject({
      status: 'done',
      output: { headline: 'ok' },
      inputTokens: 10_000,
      outputTokens: 900,
      costUsd: 0.00145,
      latencyMs: 2400,
      error: null,
      finishedAt: expect.any(Date),
    });
  });

  it('allows one running briefing per plan', async () => {
    const repo = createBriefingRepository(testDb.db);

    const first = await repo.start({ ...run, flightPlanId: planId });
    const second = await repo.start({ ...run, flightPlanId: planId });
    expect(first).not.toBeNull();
    expect(second).toBeNull();

    await repo.finish(first!.id, result);
    expect(await repo.start({ ...run, flightPlanId: planId })).not.toBeNull();
  });

  it('fails a run left pending by a stopped server, so the plan is not blocked', async () => {
    const repo = createBriefingRepository(testDb.db);
    const t0 = new Date('2026-11-10T10:00:00Z');
    const stuck = await repo.start({ ...run, flightPlanId: planId }, { now: t0 });

    // Four minutes later it may still be running; six minutes later it is considered stale.
    expect(
      await repo.start(
        { ...run, flightPlanId: planId },
        { now: new Date(t0.getTime() + 4 * 60_000) },
      ),
    ).toBeNull();
    const fresh = await repo.start(
      { ...run, flightPlanId: planId },
      { now: new Date(t0.getTime() + 6 * 60_000) },
    );
    expect(fresh).not.toBeNull();

    const rows = await testDb.db.query.briefings.findMany();
    expect(rows.find((r) => r.id === stuck!.id)).toMatchObject({
      status: 'failed',
      error: INTERRUPTED_ERROR,
    });
  });

  it('counts briefings created since a time, across plans and statuses', async () => {
    const repo = createBriefingRepository(testDb.db);
    const day = new Date('2026-11-10T00:00:00Z');
    await repo.start({ ...run, flightPlanId: planId }, { now: new Date('2026-11-09T23:00:00Z') });
    const a = await repo.start(
      { ...run, flightPlanId: planId },
      { now: new Date('2026-11-10T08:00:00Z') },
    );
    await repo.finish(a!.id, { ...result, status: 'failed', output: null, error: 'x' });

    expect(await repo.countSince(day)).toBe(1);
    expect(await repo.countSince(new Date('2026-11-09T00:00:00Z'))).toBe(2);
  });

  it('returns null without briefings, and deletes them with their plan', async () => {
    const repo = createBriefingRepository(testDb.db);
    expect(await repo.latest(planId)).toBeNull();

    await repo.start({ ...run, flightPlanId: planId });
    await testDb.db.delete(flightPlans).where(eq(flightPlans.id, planId));
    expect(await countRows(testDb.db, 'briefings')).toBe(0);
  });
});
