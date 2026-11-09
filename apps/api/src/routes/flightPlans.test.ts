import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app';
import { SimbriefNotFoundError } from '../simbrief';
import {
  createFakeSimbrief,
  createInMemoryFlightPlanRepository,
  createInMemoryPilotRepository,
  testDeps,
} from '../testing/fakes';

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const savedPilot = () =>
  createInMemoryPilotRepository({ simbriefUsername: 'jetpilot', weightUnit: 'kgs' });

const importLatest = (a: App) => a.inject({ method: 'POST', url: '/api/flight-plans/import' });

describe('POST /api/flight-plans/import', () => {
  it('stores the latest plan with its raw OFP and answers 201 with the parsed plan', async () => {
    const raw = loadFixture('eddb-eddm-c750-kgs');
    const flightPlans = createInMemoryFlightPlanRepository();
    const simbrief = createFakeSimbrief(() => raw);
    app = await buildApp(testDeps({ pilots: savedPilot(), flightPlans, simbrief }));

    const res = await importLatest(app);

    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; created: boolean; plan: unknown }>();
    expect(body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      created: true,
      plan: parseOfp(loadFixture('eddb-eddm-c750-kgs')),
    });
    expect(simbrief.requests).toEqual(['jetpilot']);
    const stored = flightPlans.imported.get('192980256');
    expect(stored).toMatchObject({ id: body.id, simbriefUsername: 'jetpilot' });
    expect(stored?.rawOfp).toBe(raw);
  });

  it('answers 200 with the same id when the plan was already imported', async () => {
    const flightPlans = createInMemoryFlightPlanRepository();
    const simbrief = createFakeSimbrief(() => loadFixture('ksfo-kjfk-b739-lbs'));
    app = await buildApp(testDeps({ pilots: savedPilot(), flightPlans, simbrief }));

    const first = await importLatest(app);
    const second = await importLatest(app);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ id: first.json<{ id: string }>().id, created: false });
    expect(flightPlans.imported.size).toBe(1);
  });

  it('needs a saved username and does not call SimBrief without one', async () => {
    const simbrief = createFakeSimbrief();
    app = await buildApp(testDeps({ simbrief }));

    const res = await importLatest(app);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: 'USERNAME_REQUIRED',
        message: 'Set your SimBrief username in Settings first.',
      },
    });
    expect(simbrief.requests).toEqual([]);
  });

  it('stores nothing when SimBrief does not know the user', async () => {
    const flightPlans = createInMemoryFlightPlanRepository();
    const simbrief = createFakeSimbrief(() => {
      throw new SimbriefNotFoundError(
        'SimBrief has no flight plan for "jetpilot" (Unknown UserID).',
      );
    });
    app = await buildApp(testDeps({ pilots: savedPilot(), flightPlans, simbrief }));

    const res = await importLatest(app);

    expect(res.statusCode).toBe(404);
    expect(flightPlans.imported.size).toBe(0);
  });

  it('stores nothing when the plan cannot be read (422)', async () => {
    const raw = loadFixture('eddb-eddm-c750-kgs');
    (raw.times as Record<string, unknown>).est_block = '1h07';
    const flightPlans = createInMemoryFlightPlanRepository();
    app = await buildApp(
      testDeps({ pilots: savedPilot(), flightPlans, simbrief: createFakeSimbrief(() => raw) }),
    );

    const res = await importLatest(app);

    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { message: string } }>().error.message).toContain('times.est_block');
    expect(flightPlans.imported.size).toBe(0);
  });
});

describe('GET /api/flight-plans', () => {
  async function appWithPlans(...fixtures: string[]) {
    const flightPlans = createInMemoryFlightPlanRepository();
    for (const name of fixtures) {
      const rawOfp = loadFixture(name);
      await flightPlans.import({ simbriefUsername: 'jetpilot', plan: parseOfp(rawOfp), rawOfp });
    }
    app = await buildApp(testDeps({ pilots: savedPilot(), flightPlans }));
    return app;
  }

  it('lists newest first with a cursor for the next page', async () => {
    const a = await appWithPlans(
      'eddb-eddm-c750-kgs',
      'ksfo-kjfk-b739-lbs',
      'eddf-lepa-a339-noalt',
    );

    const first = await a.inject({ method: 'GET', url: '/api/flight-plans?limit=2' });

    expect(first.statusCode).toBe(200);
    const body = first.json<{ items: { callsign: string }[]; nextCursor: string | null }>();
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).not.toBeNull();

    const second = await a.inject({
      method: 'GET',
      url: `/api/flight-plans?limit=2&cursor=${body.nextCursor!}`,
    });
    expect(second.json<{ items: unknown[]; nextCursor: null }>()).toMatchObject({
      nextCursor: null,
    });
    expect(second.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it('is empty, not an error, before settings are saved', async () => {
    app = await buildApp(testDeps());

    const res = await app.inject({ method: 'GET', url: '/api/flight-plans' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null });
  });

  it.each(['limit=0', 'limit=51', 'limit=abc'])('rejects %s with 400', async (query) => {
    const a = await appWithPlans();
    const res = await a.inject({ method: 'GET', url: `/api/flight-plans?${query}` });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/flight-plans/:id', () => {
  it('returns the stored plan in the briefing shape', async () => {
    const flightPlans = createInMemoryFlightPlanRepository();
    const rawOfp = loadFixture('ksfo-kjfk-b739-lbs');
    const { id } = await flightPlans.import({
      simbriefUsername: 'jetpilot',
      plan: parseOfp(rawOfp),
      rawOfp,
    });
    app = await buildApp(testDeps({ pilots: savedPilot(), flightPlans }));

    const res = await app.inject({ method: 'GET', url: `/api/flight-plans/${id}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id,
      importedAt: expect.any(String),
      plan: parseOfp(loadFixture('ksfo-kjfk-b739-lbs')),
    });
  });

  it('answers 404 for an unknown id and 400 for something that is not an id', async () => {
    app = await buildApp(testDeps());

    const missing = await app.inject({
      method: 'GET',
      url: '/api/flight-plans/00000000-0000-4000-8000-000000000000',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ error: { code: string } }>().error.code).toBe('FLIGHT_PLAN_NOT_FOUND');

    const bad = await app.inject({ method: 'GET', url: '/api/flight-plans/not-an-id' });
    expect(bad.statusCode).toBe(400);
  });
});

describe('DELETE /api/flight-plans/:id', () => {
  it('deletes with 204, then 404 when repeated', async () => {
    const flightPlans = createInMemoryFlightPlanRepository();
    const rawOfp = loadFixture('eddb-eddm-c750-kgs');
    const { id } = await flightPlans.import({
      simbriefUsername: 'jetpilot',
      plan: parseOfp(rawOfp),
      rawOfp,
    });
    app = await buildApp(testDeps({ pilots: savedPilot(), flightPlans }));

    const first = await app.inject({ method: 'DELETE', url: `/api/flight-plans/${id}` });
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe('');
    expect(flightPlans.imported.size).toBe(0);

    const again = await app.inject({ method: 'DELETE', url: `/api/flight-plans/${id}` });
    expect(again.statusCode).toBe(404);
  });
});
