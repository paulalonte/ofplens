import {
  HAZARD_KINDS,
  HAZARD_SOURCES,
  readPlanHazards,
  refreshPlanHazards,
  WeatherUnavailableError,
  type FlightPlanHazardsResponse,
} from '@ofplens/weather';
import { z } from 'zod';
import { defineTool, ToolError } from './tool';

/** More than this many hazards on one route are summarised as a count. */
export const MAX_ROUTE_HAZARDS = 10;

const RouteHazard = z.object({
  advisoryId: z.string(),
  type: z.enum(HAZARD_KINDS),
  /** The feed's own code, e.g. TS, TURB-HI. */
  code: z.string(),
  severity: z.enum(['moderate', 'severe']).nullable(),
  /** EMBD, FRQ, a volcano or storm name, a G-AIRMET "due to"... */
  detail: z.string().nullable(),
  baseFt: z.number().nullable(),
  topFt: z.number().nullable(),
  validFrom: z.string(),
  validUntil: z.string(),
  /** Each stretch of the route inside the advisory, in route order. */
  segments: z.array(z.object({ fromWaypoint: z.string(), toWaypoint: z.string() })),
  /** e.g. "SIGMET, EDUU RHEIN UIR". */
  issuedBy: z.string(),
  rawText: z.string().nullable(),
});

/**
 * SIGMETs and G-AIRMETs that touch the planned route, matched in code by area, level and time
 * (OFP-30): checked again now (feeds cached 5 minutes), or the last stored check when the feeds
 * are down.
 */
export const getRouteHazards = defineTool({
  name: 'get_route_hazards',
  description:
    'Hazards along the route: SIGMETs (worldwide) and US G-AIRMETs whose area the planned ' +
    'route crosses, at the planned levels, while they are valid. Each has an advisoryId to ' +
    'cite, its type, severity, levels in feet, validity and the route segments (from/to ' +
    'waypoint) it covers. An empty list means none was found. If the feeds are unavailable, ' +
    'available is false and the last stored check (if any) is returned.',
  input: z.object({ flightPlanId: z.uuid() }),
  output: z.object({
    available: z.boolean(),
    note: z.string().nullable(),
    checkedAt: z.string().nullable(),
    /** The takeoff time the ETAs were worked out from. */
    takeoffAt: z.string().nullable(),
    unavailableFeeds: z.array(z.enum(HAZARD_SOURCES)),
    advisoriesChecked: z.number(),
    hazards: z.array(RouteHazard),
    /** Hazards beyond MAX_ROUTE_HAZARDS, left out. */
    moreNotShown: z.number(),
  }),
  async run({ flightPlanId }, { hazards, hazardFeeds }) {
    let result: FlightPlanHazardsResponse | null;
    let note: string | null = null;
    try {
      result = await refreshPlanHazards(hazards, hazardFeeds, flightPlanId);
    } catch (err) {
      if (!(err instanceof WeatherUnavailableError)) throw err;
      note = 'Hazard advisories are unavailable right now; showing the last stored check, if any.';
      result = await readPlanHazards(hazards, flightPlanId);
    }
    if (!result) throw new ToolError(`No flight plan with id ${flightPlanId}`);
    if (!note && result.unavailable.length > 0) {
      note = `These feeds could not be read, so their hazards may be missing: ${result.unavailable.join(', ')}.`;
    }

    return {
      available: result.checkedAt !== null,
      note,
      checkedAt: result.checkedAt,
      takeoffAt: result.takeoffAt,
      unavailableFeeds: result.unavailable,
      advisoriesChecked: result.advisoriesChecked,
      hazards: result.hazards.slice(0, MAX_ROUTE_HAZARDS).map((h) => ({
        advisoryId: h.id,
        type: h.hazard,
        code: h.code,
        severity: h.severity,
        detail: h.detail,
        baseFt: h.baseFt,
        topFt: h.topFt,
        validFrom: h.validFrom,
        validUntil: h.validTo,
        segments: h.segments.map((s) => ({ fromWaypoint: s.fromIdent, toWaypoint: s.toIdent })),
        issuedBy: issuedBy(h),
        rawText: h.rawText,
      })),
      moreNotShown: Math.max(0, result.hazards.length - MAX_ROUTE_HAZARDS),
    };
  },
});

function issuedBy(h: FlightPlanHazardsResponse['hazards'][number]): string {
  switch (h.source) {
    case 'isigmet':
      return ['SIGMET', h.firName ?? h.fir].filter(Boolean).join(', ');
    case 'airsigmet':
      return h.code === 'CONVECTIVE' ? 'US convective SIGMET' : 'US SIGMET';
    case 'gairmet':
      return 'US G-AIRMET';
  }
}
