import Anthropic from '@anthropic-ai/sdk';
import {
  createDb,
  createFlightPlanRepository,
  createHazardRepository,
  createPilotRepository,
  createWeatherRepository,
  type DbConnection,
} from '@ofplens/db';
import { createTestDatabase, truncateAll, type TestDatabase } from '@ofplens/db/testing';
import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { createCachedWeatherClient, createWeatherClient, parseAdvisories } from '@ofplens/weather';
import { loadWeatherFixture } from '@ofplens/weather/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BriefingPlanNotFoundError, runBriefing } from './agent';
import type { Briefing } from './briefing';
import { PROMPT_VERSION } from './prompt';
import { answer, callTools, fakeClaude, type FakeReply } from './testing/fakeClaude';
import { fixtureHazardClient, routeSigmets } from './testing/routeHazards';
import type { ToolDeps } from './tools';

/**
 * The briefing loop end to end: the real Anthropic SDK and Tool Runner, the real tools on
 * Postgres and the captured weather; only Claude's replies are scripted.
 */
let testDb: TestDatabase;
let conn: DbConnection;
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
afterAll(async () => {
  await conn.close();
  await testDb.destroy();
});

function deps(): ToolDeps {
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
  return {
    flightPlans: createFlightPlanRepository(conn.db),
    weatherReports: createWeatherRepository(conn.db),
    hazards: createHazardRepository(conn.db),
    hazardFeeds: fixtureHazardClient(NOW),
    weather: createCachedWeatherClient(
      createWeatherClient({ fetch: weatherFetch, retryDelayMs: 0 }),
    ),
  };
}

async function run(replies: Parameters<typeof fakeClaude>[0], config = {}) {
  const claude = fakeClaude(replies);
  const client = new Anthropic({ apiKey: 'test-key', fetch: claude.fetch, maxRetries: 0 });
  const progress: string[] = [];
  const result = await runBriefing(planId, {
    client,
    deps: deps(),
    config,
    onToolCall: (call) => progress.push(call.name),
  });
  return { result, requests: claude.requests, progress };
}

/** The made-up thunderstorm SIGMET over the route (BEBKU to MAREM), valid around now. */
const NOW = Date.now();
const thunderstorm = parseAdvisories('isigmet', routeSigmets(NOW)).find((a) => a.fir === 'EDUU')!;

/**
 * What a careful model would write after reading the tools (EDDB IFR→LIFR, EDDF MVFR→VFR,
 * thunderstorms around PIKIB).
 */
const goodBriefing = (): Briefing => ({
  headline: 'Berlin has dropped to LIFR since dispatch; plan for a low-visibility departure.',
  overallRisk: 'moderate',
  departure: {
    icao: 'EDDB',
    flightCategory: 'LIFR',
    summary: 'Wind 340 at 3 kt, 7 km visibility, broken cloud at 400 ft, overcast at 1,500 ft.',
    changedSinceDispatch: true,
    sourceReportId: 'live:metar:EDDB:2026-11-10T0850Z',
  },
  destination: {
    icao: 'EDDM',
    flightCategory: 'IFR',
    summary: 'Wind 270 at 3 kt, light rain, broken cloud at 500 ft.',
    changedSinceDispatch: false,
    sourceReportId: 'live:metar:EDDM:2026-11-10T0850Z',
  },
  alternate: {
    icao: 'EDDF',
    flightCategory: 'VFR',
    summary: 'Wind 020 at 5 kt, few clouds at 1,100 ft, visibility over 10 km.',
    changedSinceDispatch: true,
    sourceReportId: 'live:metar:EDDF:2026-11-10T0850Z',
  },
  enrouteHazards: [
    {
      type: 'thunderstorm',
      fromWaypoint: 'BEBKU',
      toWaypoint: 'MAREM',
      validUntil: thunderstorm.validTo,
      severity: null,
      advisoryId: thunderstorm.id,
    },
  ],
  pilotNotes: [
    'Frankfurt has improved to VFR since dispatch.',
    'Embedded thunderstorms up to FL380 between BEBKU and MAREM.',
  ],
});

const allTools = () =>
  callTools('get_flight_plan', 'get_planned_weather', 'get_weather', 'get_route_hazards');

describe('runBriefing', () => {
  it('reads the plan and weather through the tools and returns a checked briefing', async () => {
    const { result, requests, progress } = await run([
      allTools(),
      answer(goodBriefing(), { input_tokens: 9000, output_tokens: 800 }),
    ]);

    expect(result).toMatchObject({
      status: 'done',
      briefing: goodBriefing(),
      model: 'claude-haiku-5-5',
      promptVersion: PROMPT_VERSION,
      turns: 2,
      inputTokens: 10_000,
      outputTokens: 900,
    });
    // $0.10 / $0.50 per million tokens on Haiku 5.5.
    expect(result.costUsd).toBeCloseTo((10_000 * 0.1 + 900 * 0.5) / 1e6, 10);
    // Parallel calls run concurrently, so they finish in any order.
    expect(result.toolCalls.map((c) => [c.name, c.ok]).sort()).toEqual([
      ['get_flight_plan', true],
      ['get_planned_weather', true],
      ['get_route_hazards', true],
      ['get_weather', true],
    ]);
    expect([...progress].sort()).toEqual([
      'get_flight_plan',
      'get_planned_weather',
      'get_route_hazards',
      'get_weather',
    ]);

    // What was sent to Claude.
    const first = requests[0]!;
    expect(first).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
      messages: [{ role: 'user', content: 'Write the weather briefing for this flight.' }],
    });
    expect(first.system).toEqual(expect.stringContaining('flight simulator'));
    expect((first.tools as { name: string }[]).map((t) => t.name)).toEqual([
      'get_flight_plan',
      'get_planned_weather',
      'get_weather',
      'get_route_hazards',
    ]);
    // The second turn carries the tool results; the flight plan never includes fuel.
    const results = JSON.stringify(requests[1]!.messages);
    expect(results).toContain('live:metar:EDDB:2026-11-10T0850Z');
    expect(results).not.toMatch(/"fuel|"weights/);
  });

  it('fails a briefing the guardrails reject, and says why', async () => {
    const wrong = goodBriefing();
    wrong.departure.flightCategory = 'VFR';
    wrong.pilotNotes = ['Carry 300 kg of extra fuel.'];

    const { result } = await run([allTools(), answer(wrong)]);

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.error).toMatch(/^Guardrails rejected the briefing: /);
    expect(result.error).toContain('departure: says VFR, but the cited METAR is LIFR.');
    expect(result.error).toContain('mentions a weight or fuel quantity ("300 kg")');
    expect(result.rejectedBriefing).toEqual(wrong);
  });

  it('fails a briefing that leaves out a hazard on the route', async () => {
    const quiet = goodBriefing();
    quiet.enrouteHazards = [];

    const { result } = await run([allTools(), answer(quiet)]);

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.error).toContain(
      `Hazard "${thunderstorm.id}" (thunderstorm from BEBKU to MAREM) is missing from enrouteHazards.`,
    );
  });

  it('fails a briefing written without calling the weather tools', async () => {
    const { result } = await run([callTools('get_flight_plan'), answer(goodBriefing())]);
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.error).toContain('which no weather tool returned');
  });

  it('fails an answer that is not a valid briefing', async () => {
    const { result } = await run([allTools(), answer({ headline: 'Looks fine' })]);
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.error).toMatch(/schema|JSON|parse/i);
  });

  it.each([
    ['a refusal', 'refusal', /declined/],
    ['a cut-off answer', 'max_tokens', /cut off/],
  ])('fails on %s', async (_, stopReason, message) => {
    const reply: FakeReply = { content: [{ type: 'text', text: '{' }], stop_reason: stopReason };
    const { result } = await run([allTools(), reply]);
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.error).toMatch(message);
  });

  it('stops a model that keeps calling tools', async () => {
    const { result, requests } = await run([allTools(), allTools(), allTools(), allTools()], {
      maxToolCalls: 4,
      maxTurns: 3,
    });
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.error).toMatch(/No briefing after 3 turns/);
    expect(requests).toHaveLength(3);
    // Calls past the limit were refused, not run.
    expect(result.toolCalls.filter((c) => c.ok)).toHaveLength(4);
    expect(result.toolCalls.filter((c) => c.error === 'tool call limit').length).toBeGreaterThan(0);
  });

  it('reports a Claude API error as a failed run', async () => {
    const { result } = await run([
      { status: 529, error: { type: 'overloaded_error', message: 'Overloaded' } },
    ]);
    expect(result).toMatchObject({ status: 'failed', turns: 0 });
    expect(result.status === 'failed' && result.error).toMatch(/^Claude API error 529/);
  });

  it('refuses an unknown plan before calling Claude', async () => {
    const claude = fakeClaude([]);
    const client = new Anthropic({ apiKey: 'test-key', fetch: claude.fetch, maxRetries: 0 });

    await expect(
      runBriefing('00000000-0000-4000-8000-000000000000', { client, deps: deps() }),
    ).rejects.toBeInstanceOf(BriefingPlanNotFoundError);
    expect(claude.requests).toEqual([]);
  });
});
