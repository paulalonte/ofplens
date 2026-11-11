import { createTestDatabase, type TestDatabase } from '@ofplens/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVAL_CASES } from './cases';
import { prepareCase, runAllTools } from './setup';

/**
 * The frozen cases, through the real tools on a real Postgres database. No Claude call: this
 * checks what the agent will be given, not what it answers.
 */
let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await testDb.destroy();
});

/** Tool results with the plan's own id taken out, to compare two imports of the same case. */
async function toolResults(evalCase: (typeof EVAL_CASES)[number]) {
  const prepared = await prepareCase(testDb.db, evalCase);
  const results = await runAllTools(prepared);
  return {
    prepared,
    results: JSON.parse(JSON.stringify(results).replaceAll(prepared.flightPlanId, '<plan>')) as {
      get_weather: {
        liveAvailable: boolean;
        stations: { role: string; metar: { raw: string; observedAt: string | null } | null }[];
      };
      get_planned_weather: {
        stations: { role: string; metar: { observedAt: string | null } | null }[];
      };
      get_route_hazards: {
        available: boolean;
        unavailableFeeds: string[];
        advisoriesChecked: number;
        hazards: { advisoryId: string; segments: unknown[] }[];
      };
    },
  };
}

describe('eval cases', () => {
  it('has 18 to 24 cases with unique ids, a scenario tag and a plain-words expectation', () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(18);
    expect(EVAL_CASES.length).toBeLessThanOrEqual(24);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
    for (const c of EVAL_CASES) {
      expect(c.tags[0], c.id).toBeTruthy();
      expect(c.expect.length, c.id).toBeGreaterThan(20);
    }
  });

  describe.each(EVAL_CASES.map((c) => [c.id, c] as const))('%s', (_id, evalCase) => {
    it('gives the agent the same tool results every time', async () => {
      const first = await toolResults(evalCase);
      const second = await toolResults(evalCase);
      expect(second.results).toEqual(first.results);
    });

    it('serves the weather and hazards the case sets', async () => {
      const { results } = await toolResults(evalCase);
      const weather = results.get_weather;
      const hazards = results.get_route_hazards;

      if (evalCase.weather === 'unavailable') {
        expect(weather.liveAvailable).toBe(false);
      } else {
        expect(weather.liveAvailable).toBe(true);
        // Live METARs are newer than the OFP's, so a different category counts as a change.
        for (const station of weather.stations) {
          const planned = results.get_planned_weather.stations.find((s) => s.role === station.role);
          if (station.metar && planned?.metar) {
            expect(Date.parse(station.metar.observedAt!), station.role).toBeGreaterThan(
              Date.parse(planned.metar.observedAt!),
            );
          }
        }
        for (const [role, live] of Object.entries(evalCase.weather)) {
          if (live.metar === undefined) continue;
          const station = weather.stations.find((s) => s.role === role);
          if (live.metar === null) expect(station?.metar, role).toBeNull();
          else expect(station?.metar?.raw, role).toContain(live.metar);
        }
      }

      if (evalCase.hazards === 'unavailable') {
        expect(hazards.available).toBe(false);
        expect(hazards.hazards).toEqual([]);
      } else {
        expect(hazards.available).toBe(true);
        expect(hazards.unavailableFeeds).toEqual(evalCase.hazards.unavailableFeeds ?? []);
        // The captured SIGMETs are checked but none is valid; each made-up one touches the route.
        expect(hazards.advisoriesChecked).toBeGreaterThan(evalCase.hazards.advisories.length);
        expect(hazards.hazards).toHaveLength(evalCase.hazards.advisories.length);
        for (const hazard of hazards.hazards) expect(hazard.segments.length).toBeGreaterThan(0);
      }
    });
  });
});
