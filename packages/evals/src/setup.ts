import { randomUUID } from 'node:crypto';
import { briefingTools, type ToolDeps } from '@ofplens/agent';
import {
  createFlightPlanRepository,
  createHazardRepository,
  createPilotRepository,
  createWeatherRepository,
  type Database,
} from '@ofplens/db';
import { parseOfp, type FlightPlanSummary } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import {
  WeatherUnavailableError,
  type HazardClient,
  type LiveMetar,
  type LiveTaf,
  type WeatherClient,
} from '@ofplens/weather';
import { briefingTime, type EvalCase, type Role } from './case';
import { backgroundAdvisories, caseAdvisories, fixedHazardClient } from './hazards';
import { dispatchTaf, liveMetar, liveTaf, metarBody } from './reports';

export const EVAL_PILOT = 'ofplens-evals';

export interface PreparedCase {
  flightPlanId: string;
  plan: FlightPlanSummary;
  /** When the briefing is asked for; the tools' clock. */
  briefAt: Date;
  deps: ToolDeps;
}

/**
 * Imports the case's plan into `db` (a scratch database) and returns tool dependencies that
 * serve the case's frozen weather and advisories at its fixed time.
 */
export async function prepareCase(db: Database, evalCase: EvalCase): Promise<PreparedCase> {
  const raw = loadFixture(evalCase.plan);
  // A request id of its own: importing the same OFP again would return the stored plan with
  // the weather and hazards of an earlier case. Each prepared case is a separate plan.
  const plan = { ...parseOfp(raw), simbriefRequestId: `eval:${evalCase.id}:${randomUUID()}` };
  const briefAt = briefingTime(evalCase, plan.times.out);

  await ensureEvalPilot(db);
  const { id } = await createFlightPlanRepository(db).import({
    simbriefUsername: EVAL_PILOT,
    plan,
    rawOfp: raw,
  });

  return {
    flightPlanId: id,
    plan,
    briefAt,
    deps: {
      flightPlans: createFlightPlanRepository(db),
      weatherReports: createWeatherRepository(db),
      weather: caseWeatherClient(evalCase, plan, briefAt),
      hazards: createHazardRepository(db),
      hazardFeeds: caseHazardClient(evalCase, plan, briefAt),
      now: () => briefAt,
    },
  };
}

/**
 * Creates the pilot the eval plans belong to. Call it once before preparing cases in parallel:
 * on an empty database two first saves at the same time would both insert the pilot.
 */
export async function ensureEvalPilot(db: Database): Promise<void> {
  await createPilotRepository(db).save({ simbriefUsername: EVAL_PILOT, weightUnit: 'kgs' });
}

const down = () =>
  Promise.reject(new WeatherUnavailableError('aviationweather.gov is down (eval case)'));

/** The case's live METARs and TAFs: as set by the case, else the dispatch ones again. */
export function caseWeatherClient(
  evalCase: EvalCase,
  plan: FlightPlanSummary,
  briefAt: Date,
): WeatherClient {
  if (evalCase.weather === 'unavailable') return { fetchMetars: down, fetchTafs: down };
  const set = evalCase.weather;

  const metars = new Map<string, LiveMetar>();
  const tafs = new Map<string, LiveTaf>();
  const airports: [Role, FlightPlanSummary['origin'] | null][] = [
    ['origin', plan.origin],
    ['destination', plan.destination],
    ['alternate', plan.alternate],
  ];
  for (const [role, airport] of airports) {
    if (!airport) {
      if (set[role]) throw new Error(`${evalCase.id}: the plan has no ${role}`);
      continue;
    }
    const live = set[role] ?? {};
    const metar = live.metar === undefined ? airport.metar && metarBody(airport.metar) : live.metar;
    if (metar) metars.set(airport.icao, liveMetar(airport.icao, briefAt, metar));
    if (live.taf === undefined) {
      if (airport.taf) tafs.set(airport.icao, dispatchTaf(airport.taf, plan.generatedAt));
    } else if (live.taf) {
      tafs.set(airport.icao, liveTaf(airport.icao, briefAt, live.taf));
    }
  }

  const pick = <T>(reports: Map<string, T>, icaos: readonly string[]) =>
    Promise.resolve(new Map([...reports].filter(([icao]) => icaos.includes(icao))));
  return {
    fetchMetars: (icaos) => pick(metars, icaos),
    fetchTafs: (icaos) => pick(tafs, icaos),
  };
}

/** The case's made-up advisories among the (expired) captured ones, or every feed down. */
export function caseHazardClient(
  evalCase: EvalCase,
  plan: FlightPlanSummary,
  briefAt: Date,
): HazardClient {
  if (evalCase.hazards === 'unavailable') return { fetchAdvisories: down };
  const advisories = [
    ...backgroundAdvisories(briefAt),
    ...caseAdvisories(evalCase.hazards.advisories, plan.waypoints, briefAt),
  ];
  return fixedHazardClient(advisories, evalCase.hazards.unavailableFeeds);
}

/**
 * Every tool's result for a prepared case, by tool name, as the agent would see them. For tests
 * and the case list; makes no Claude call.
 */
export async function runAllTools(prepared: PreparedCase): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const tool of briefingTools) {
    results[tool.name] = await tool.run({ flightPlanId: prepared.flightPlanId }, prepared.deps);
  }
  return results;
}
