import Anthropic from '@anthropic-ai/sdk';
import type { Briefing } from '@ofplens/agent/contract';
import { answer, callTools, fakeClaude } from '@ofplens/agent/testing';
import { PROMPT_VERSION } from '@ofplens/agent';
import {
  createBriefingRepository,
  createDb,
  createFlightPlanRepository,
  createPilotRepository,
  createHazardRepository,
  createWeatherRepository,
  pingDb,
  type DbConnection,
} from '@ofplens/db';
import { countRows, createTestDatabase, truncateAll, type TestDatabase } from '@ofplens/db/testing';
import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { createCachedWeatherClient, createWeatherClient } from '@ofplens/weather';
import { loadWeatherFixture } from '@ofplens/weather/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app';

/**
 * Briefings end to end through the API: the real app, Postgres, the agent and the captured
 * weather; only Claude's replies are scripted (through the real SDK).
 */
let testDb: TestDatabase;
let conn: DbConnection;
let app: App | undefined;
let planId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  conn = createDb(testDb.url);
});
beforeEach(async () => {
  await truncateAll(conn.db);
  await createPilotRepository(conn.db).save({ simbriefUsername: 'jetpilot', weightUnit: 'kgs' });
  const rawOfp = loadFixture('eddb-eddm-c750-kgs');
  planId = (
    await createFlightPlanRepository(conn.db).import({
      simbriefUsername: 'jetpilot',
      plan: parseOfp(rawOfp),
      rawOfp,
    })
  ).id;
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(async () => {
  await conn.close();
  await testDb.destroy();
});

const weatherFetch = (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const ids = (url.searchParams.get('ids') ?? '').split(',');
  const all = loadWeatherFixture(url.pathname.endsWith('/metar') ? 'metar' : 'taf');
  return Promise.resolve(
    new Response(JSON.stringify(all.filter((r) => ids.includes(r.icaoId as string))), {
      headers: { 'content-type': 'application/json' },
    }),
  );
};

async function start(replies: Parameters<typeof fakeClaude>[0] | null, { dailyLimit = 20 } = {}) {
  const claude = replies ? fakeClaude(replies) : null;
  app = await buildApp({
    pingDb: () => pingDb(conn.db),
    pilots: createPilotRepository(conn.db),
    flightPlans: createFlightPlanRepository(conn.db),
    weatherReports: createWeatherRepository(conn.db),
    hazards: createHazardRepository(conn.db),
    briefings: createBriefingRepository(conn.db),
    weather: createCachedWeatherClient(
      createWeatherClient({ fetch: weatherFetch, retryDelayMs: 0 }),
    ),
    anthropic: claude
      ? new Anthropic({ apiKey: 'test-key', fetch: claude.fetch, maxRetries: 0 })
      : null,
    briefingDailyLimit: dailyLimit,
  });
  return { app, claude };
}

/** Server-Sent Events as a browser would split them. */
function events(body: string): { event: string; data: Record<string, unknown> }[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const event = /^event: (.+)$/m.exec(chunk)?.[1] ?? '';
      const data = /^data: (.+)$/m.exec(chunk)?.[1] ?? '{}';
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

const goodBriefing = (): Briefing => ({
  headline: 'Berlin has dropped to LIFR since dispatch; plan for a low-visibility departure.',
  overallRisk: 'moderate',
  departure: {
    icao: 'EDDB',
    flightCategory: 'LIFR',
    summary: 'Wind 340 at 3 kt, broken cloud at 400 ft.',
    changedSinceDispatch: true,
    sourceReportId: 'live:metar:EDDB:2026-11-10T0850Z',
  },
  destination: {
    icao: 'EDDM',
    flightCategory: 'IFR',
    summary: 'Light rain, broken cloud at 500 ft.',
    changedSinceDispatch: false,
    sourceReportId: 'live:metar:EDDM:2026-11-10T0850Z',
  },
  alternate: {
    icao: 'EDDF',
    flightCategory: 'VFR',
    summary: 'Few clouds at 1,100 ft.',
    changedSinceDispatch: true,
    sourceReportId: 'live:metar:EDDF:2026-11-10T0850Z',
  },
  enrouteHazards: [],
  pilotNotes: ['Frankfurt has improved to VFR since dispatch.'],
});

const allTools = () => callTools('get_flight_plan', 'get_planned_weather', 'get_weather');
const post = (a: App, id = planId) =>
  a.inject({ method: 'POST', url: `/api/flight-plans/${id}/briefings` });
const latest = (a: App, id = planId) =>
  a.inject({ method: 'GET', url: `/api/flight-plans/${id}/briefings/latest` });

describe('POST /api/flight-plans/:id/briefings', () => {
  it('streams progress, then the stored briefing', async () => {
    const { app: a } = await start([
      allTools(),
      answer(goodBriefing(), { input_tokens: 9000, output_tokens: 800 }),
    ]);

    const res = await post(a);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const stream = events(res.body);
    expect(stream.map((e) => e.event)).toEqual(['started', 'tool', 'tool', 'tool', 'done']);
    expect(
      stream
        .filter((e) => e.event === 'tool')
        .map((e) => e.data.name)
        .sort(),
    ).toEqual(['get_flight_plan', 'get_planned_weather', 'get_weather']);
    const done = stream.at(-1)!.data;
    expect(done).toMatchObject({
      id: stream[0]!.data.id,
      flightPlanId: planId,
      status: 'done',
      model: 'claude-haiku-5-5',
      promptVersion: PROMPT_VERSION,
      briefing: goodBriefing(),
      error: null,
      inputTokens: 10_000,
      outputTokens: 900,
    });
    expect(done.costUsd).toBeCloseTo((10_000 * 0.1 + 900 * 0.5) / 1e6, 10);
    // The browser gets each tool's name and outcome, not the data it returned.
    expect(JSON.stringify(done.toolCalls)).not.toContain('reportId');

    // Stored: the latest briefing for the plan.
    expect((await latest(a)).json()).toEqual({ briefing: done });
  });

  it('stores and streams a briefing the guardrails rejected as failed', async () => {
    const wrong = goodBriefing();
    wrong.departure.flightCategory = 'VFR';
    const { app: a } = await start([allTools(), answer(wrong)]);

    const stream = events((await post(a)).body);

    expect(stream.at(-1)).toMatchObject({
      event: 'failed',
      data: {
        status: 'failed',
        briefing: null,
        error: expect.stringContaining('departure: says VFR'),
      },
    });
    expect((await latest(a)).json()).toMatchObject({ briefing: { status: 'failed' } });
  });

  it('stores a Claude API error as a failed briefing', async () => {
    const { app: a } = await start([
      { status: 529, error: { type: 'overloaded_error', message: 'Overloaded' } },
    ]);

    const stream = events((await post(a)).body);

    expect(stream.map((e) => e.event)).toEqual(['started', 'failed']);
    expect(stream[1]!.data.error).toMatch(/^Claude API error 529/);
  });

  it('answers 503 without an API key, without touching the database', async () => {
    const { app: a } = await start(null);

    const res = await post(a);

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'BRIEFINGS_NOT_CONFIGURED' } });
    expect(await countRows(conn.db, 'briefings')).toBe(0);
  });

  it('answers 404 for an unknown plan and 400 for a bad id, without calling Claude', async () => {
    const { app: a, claude } = await start([]);

    expect((await post(a, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect(
      (await a.inject({ method: 'POST', url: '/api/flight-plans/nope/briefings' })).statusCode,
    ).toBe(400);
    expect(claude!.requests).toEqual([]);
  });

  it('enforces the daily limit, counting failed briefings too', async () => {
    const { app: a, claude } = await start(
      [{ status: 529, error: { type: 'overloaded_error', message: 'Overloaded' } }],
      { dailyLimit: 1 },
    );
    await post(a);

    const second = await post(a);

    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({
      error: {
        code: 'BRIEFING_DAILY_LIMIT',
        message: 'The limit of 1 briefings per day has been reached. Try again later.',
      },
    });
    expect(claude!.requests).toHaveLength(1);
  });

  it('answers 409 while a briefing for the plan is already running', async () => {
    const { app: a, claude } = await start([]);
    await createBriefingRepository(conn.db).start({
      flightPlanId: planId,
      model: 'claude-haiku-5-5',
      promptVersion: PROMPT_VERSION,
    });

    const res = await post(a);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'BRIEFING_IN_PROGRESS' } });
    expect(claude!.requests).toEqual([]);
  });
});

describe('GET /api/flight-plans/:id/briefings/latest', () => {
  it('is null before any briefing, and 404 for an unknown plan', async () => {
    const { app: a } = await start([]);

    expect((await latest(a)).json()).toEqual({ briefing: null });
    expect((await latest(a, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });
});
