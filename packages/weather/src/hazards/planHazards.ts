import { z } from 'zod';
import { HAZARD_KINDS, HAZARD_SOURCES, type HazardSource } from './advisory';
import type { HazardClient } from './client';
import { matchRouteHazards, type RouteHazard, type RoutePoint } from './route';

const iso = z.iso.datetime({ offset: true });

export const RouteSegmentView = z.object({
  fromSeq: z.number().int(),
  toSeq: z.number().int(),
  fromIdent: z.string(),
  toIdent: z.string(),
});

/** An advisory that touches the route, with where it does. */
export const RouteHazardView = z.object({
  id: z.string(),
  source: z.enum(HAZARD_SOURCES),
  hazard: z.enum(HAZARD_KINDS),
  code: z.string(),
  severity: z.enum(['moderate', 'severe']).nullable(),
  detail: z.string().nullable(),
  validFrom: iso,
  validTo: iso,
  baseFt: z.number().nullable(),
  topFt: z.number().nullable(),
  /** [lon, lat] rings, for a map. */
  polygons: z.array(z.array(z.tuple([z.number(), z.number()]))),
  fir: z.string().nullable(),
  firName: z.string().nullable(),
  rawText: z.string().nullable(),
  segments: z.array(RouteSegmentView).min(1),
});
export type RouteHazardView = z.infer<typeof RouteHazardView>;

/** GET /api/flight-plans/:id/hazards and POST …/hazards/refresh. */
export const FlightPlanHazardsResponse = z.object({
  /** When the feeds were last checked for this plan; null before the first check. */
  checkedAt: iso.nullable(),
  /** The takeoff time the ETAs were worked out from: as planned, or the check time if later. */
  takeoffAt: iso.nullable(),
  /** Feeds that could not be read at that check, so their hazards may be missing. */
  unavailable: z.array(z.enum(HAZARD_SOURCES)),
  hazards: z.array(RouteHazardView),
});
export type FlightPlanHazardsResponse = z.infer<typeof FlightPlanHazardsResponse>;

/** The outcome of one check, as stored. */
export interface PlanHazards {
  checkedAt: string;
  takeoffAt: string;
  unavailable: HazardSource[];
  hazards: RouteHazard[];
}

/** Storage for a plan's route hazards; implemented in @ofplens/db. */
export interface PlanHazardStore {
  /** The navlog and planned takeoff time; null when the plan does not exist. */
  route(
    flightPlanId: string,
  ): Promise<{ waypoints: RoutePoint[]; plannedTakeoffAt: string } | null>;
  /** Null when the plan does not exist; `checked` null when it was never checked. */
  read(flightPlanId: string): Promise<{ checked: PlanHazards | null } | null>;
  /** Replaces the plan's hazards with this check's. */
  replace(flightPlanId: string, hazards: PlanHazards): Promise<void>;
}

export function toPlanHazardsResponse(checked: PlanHazards | null): FlightPlanHazardsResponse {
  if (!checked) return { checkedAt: null, takeoffAt: null, unavailable: [], hazards: [] };
  return {
    checkedAt: checked.checkedAt,
    takeoffAt: checked.takeoffAt,
    unavailable: checked.unavailable,
    hazards: checked.hazards.map(({ advisory, segments }) => ({ ...advisory, segments })),
  };
}

/** The stored hazards; null when the plan does not exist. No network. */
export async function readPlanHazards(
  store: PlanHazardStore,
  flightPlanId: string,
): Promise<FlightPlanHazardsResponse | null> {
  const stored = await store.read(flightPlanId);
  return stored && toPlanHazardsResponse(stored.checked);
}

/**
 * Fetches the current advisories, matches them to the plan's route and stores the result in
 * place of the previous one. ETAs count from the planned takeoff, or from now when that has
 * passed (a plan flown later than planned). Null when the plan does not exist; throws
 * WeatherUnavailableError when no feed can be read (the stored hazards are untouched).
 */
export async function refreshPlanHazards(
  store: PlanHazardStore,
  client: HazardClient,
  flightPlanId: string,
  now: Date = new Date(),
): Promise<FlightPlanHazardsResponse | null> {
  const route = await store.route(flightPlanId);
  if (!route) return null;

  const { advisories, unavailable } = await client.fetchAdvisories();
  const planned = new Date(route.plannedTakeoffAt);
  const takeoffAt = planned.getTime() < now.getTime() ? now : planned;
  const checked: PlanHazards = {
    checkedAt: now.toISOString(),
    takeoffAt: takeoffAt.toISOString(),
    unavailable,
    hazards: matchRouteHazards(route.waypoints, advisories, { takeoffAt }),
  };
  await store.replace(flightPlanId, checked);
  return toPlanHazardsResponse(checked);
}
