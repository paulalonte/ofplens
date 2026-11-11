import type {
  getFlightPlan,
  getPlannedWeather,
  getRouteHazards,
  getWeather,
  ToolCallRecord,
} from '@ofplens/agent';
import type { z } from 'zod';

/**
 * What the tools give the agent for a case (runAllTools), which the graders judge a briefing
 * against. Frozen per case, so it is the same data the agent saw in any run.
 */
export interface Reference {
  get_flight_plan: z.output<typeof getFlightPlan.output>;
  get_planned_weather: z.output<typeof getPlannedWeather.output>;
  get_weather: z.output<typeof getWeather.output>;
  get_route_hazards: z.output<typeof getRouteHazards.output>;
}

export type Role = 'origin' | 'destination' | 'alternate';
export type MetarReport = NonNullable<Reference['get_weather']['stations'][number]['metar']>;

export interface AirportWeather {
  role: Role;
  icao: string;
  /** The METAR a briefing should use: the live one, else the dispatch one. */
  metar: MetarReport | null;
  dispatchMetar: MetarReport | null;
  changedSinceDispatch: boolean;
  /** Every raw report for the airport, live and dispatch, METAR and TAF. */
  raws: string[];
}

export function airports(reference: Reference): AirportWeather[] {
  return reference.get_flight_plan.airports.map(({ role, icao }) => {
    const live = reference.get_weather.stations.find((s) => s.role === role);
    const planned = reference.get_planned_weather.stations.find((s) => s.role === role);
    return {
      role,
      icao,
      metar: live?.metar ?? planned?.metar ?? null,
      dispatchMetar: planned?.metar ?? null,
      changedSinceDispatch: Boolean(live?.metar) && (live?.changedSinceDispatch ?? false),
      raws: [live?.metar, live?.taf, planned?.metar, planned?.taf]
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => r.raw),
    };
  });
}

/** Every METAR the tools returned, by reportId. */
export function metarsById(reference: Reference): Map<string, MetarReport> {
  const map = new Map<string, MetarReport>();
  for (const s of [...reference.get_weather.stations, ...reference.get_planned_weather.stations]) {
    if (s.metar) map.set(s.metar.reportId, s.metar);
  }
  return map;
}

/** The reference as the tool calls of a run, for the guardrails' evidence. */
export function referenceToolCalls(reference: Reference): ToolCallRecord[] {
  return Object.entries(reference).map(([name, output]: [string, unknown]): ToolCallRecord => ({
    name,
    ok: true,
    output,
    ms: 0,
  }));
}
