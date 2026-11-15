import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBriefingRepository, INTERRUPTED_ERROR, type StartBriefingResult } from './briefings';
import { createFlightPlanRepository } from './flightPlans';
import { createPilotRepository } from './pilots';
import { flightPlans } from './schema';
import { countRows, createTestDatabase, truncateAll, type TestDatabase } from './testing';

let testDb: TestDatabase;
let planId: string;
let pilotId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await testDb.destroy();
});
beforeEach(async () => {
  await truncateAll(testDb.db);
  pilotId = (await createPilotRepository(testDb.db).create()).id;
  planId = await importPlan(pilotId);
});

async function importPlan(owner: string, fixture = 'eddb-eddm-c750-kgs') {
  const rawOfp = loadFixture(fixture);
  return (
    await createFlightPlanRepository(testDb.db).import({
      pilotId: owner,
      plan: parseOfp(rawOfp),
      rawOfp,
    })
  ).id;
}

const run = {
  flightPlanId: '',
  pilotId: '',
  model: 'claude-haiku-5-5',
  promptVersion: 'briefing-v1',
};
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

    const started = await repo.start({ ...run, pilotId, flightPlanId: planId });
    expect(started).toEqual({ status: 'started', id: expect.any(String) });
    if (started.status !== 'started') throw new Error('not started');
    expect(await repo.latest(planId)).toMatchObject({
      status: 'pending',
      model: 'claude-haiku-5-5',
    });

    await repo.finish(started.id, result);

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

    const first = await repo.start({ ...run, pilotId, flightPlanId: planId });
    const second = await repo.start({ ...run, pilotId, flightPlanId: planId });
    expect(first.status).toBe('started');
    expect(second).toEqual({ status: 'in-progress' });

    await repo.finish(idOf(first), result);
    expect((await repo.start({ ...run, pilotId, flightPlanId: planId })).status).toBe('started');
  });

  it('fails a run left pending by a stopped server, so the plan is not blocked', async () => {
    const repo = createBriefingRepository(testDb.db);
    const t0 = new Date('2026-11-10T10:00:00Z');
    const stuck = await repo.start({ ...run, pilotId, flightPlanId: planId }, { now: t0 });

    // Four minutes later it may still be running; six minutes later it is considered stale.
    expect(
      await repo.start(
        { ...run, pilotId, flightPlanId: planId },
        { now: new Date(t0.getTime() + 4 * 60_000) },
      ),
    ).toEqual({ status: 'in-progress' });
    const fresh = await repo.start(
      { ...run, pilotId, flightPlanId: planId },
      { now: new Date(t0.getTime() + 6 * 60_000) },
    );
    expect(fresh.status).toBe('started');

    const rows = await testDb.db.query.briefings.findMany();
    expect(rows.find((r) => r.id === idOf(stuck))).toMatchObject({
      status: 'failed',
      error: INTERRUPTED_ERROR,
    });
  });

  it('counts briefings created since a time, across plans and statuses', async () => {
    const repo = createBriefingRepository(testDb.db);
    const day = new Date('2026-11-10T00:00:00Z');
    await repo.start(
      { ...run, pilotId, flightPlanId: planId },
      { now: new Date('2026-11-09T23:00:00Z') },
    );
    const a = await repo.start(
      { ...run, pilotId, flightPlanId: planId },
      { now: new Date('2026-11-10T08:00:00Z') },
    );
    await repo.finish(idOf(a), { ...result, status: 'failed', output: null, error: 'x' });

    expect(await repo.countSince(day)).toBe(1);
    expect(await repo.countSince(new Date('2026-11-09T00:00:00Z'))).toBe(2);
  });

  it('returns null without briefings, and deletes them with their plan, not their usage', async () => {
    const repo = createBriefingRepository(testDb.db);
    expect(await repo.latest(planId)).toBeNull();

    await repo.start({ ...run, pilotId, flightPlanId: planId });
    await testDb.db.delete(flightPlans).where(eq(flightPlans.id, planId));
    expect(await countRows(testDb.db, 'briefings')).toBe(0);
    // Deleting the plan does not hand the quota back.
    expect(await repo.countSince(new Date(0), pilotId)).toBe(1);
  });

  describe('limits', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const limits = { perPilot: 2, global: 3, windowMs: 24 * 3600_000 };

    async function runAndFinish(owner: string, flightPlanId: string, at = now) {
      const repo = createBriefingRepository(testDb.db);
      const started = await repo.start(
        { ...run, pilotId: owner, flightPlanId },
        { now: at, limits },
      );
      if (started.status === 'started') await repo.finish(started.id, result, at);
      return started.status;
    }

    it('stops a pilot at their limit, counting only the last 24 hours', async () => {
      const yesterday = new Date(now.getTime() - 25 * 3600_000);
      expect(await runAndFinish(pilotId, planId, yesterday)).toBe('started');
      expect(await runAndFinish(pilotId, planId)).toBe('started');
      expect(await runAndFinish(pilotId, planId)).toBe('started');
      expect(await runAndFinish(pilotId, planId)).toBe('pilot-limit');
      expect(await countRows(testDb.db, 'briefings')).toBe(3);
    });

    it('stops everyone at the global limit, while other pilots keep their own count', async () => {
      const other = (await createPilotRepository(testDb.db).create()).id;
      const otherPlan = await importPlan(other);
      expect(await runAndFinish(pilotId, planId)).toBe('started');
      expect(await runAndFinish(pilotId, planId)).toBe('started');
      expect(await runAndFinish(pilotId, planId)).toBe('pilot-limit');
      expect(await runAndFinish(other, otherPlan)).toBe('started');
      expect(await runAndFinish(other, otherPlan)).toBe('global-limit');
    });

    it('lets only one of many simultaneous starts through at the last free slot', async () => {
      const repo = createBriefingRepository(testDb.db);
      const plans = await Promise.all(
        ['ksfo-kjfk-b739-lbs', 'eddb-eddm-c750-kgs'].map(async (f, i) =>
          i === 1 ? planId : importPlan(pilotId, f),
        ),
      );
      const tight = { ...limits, perPilot: 1 };
      const results = await Promise.all(
        [...plans, ...plans].map((flightPlanId) =>
          repo.start({ ...run, pilotId, flightPlanId }, { now, limits: tight }),
        ),
      );
      expect(results.filter((r) => r.status === 'started')).toHaveLength(1);
    });
  });
});

function idOf(result: StartBriefingResult): string {
  if (result.status !== 'started')
    throw new Error(`Expected a started briefing, got ${result.status}`);
  return result.id;
}
