import { FLIGHT_CATEGORIES, HAZARD_KINDS } from '@ofplens/weather';
import { z } from 'zod';

/**
 * What the briefing agent must return (PLAN.md, "Briefing output schema"). Words and labels
 * only: every airport block cites the report it is based on, every hazard the advisory it comes
 * from, so a post-check (OFP-25) can trace each claim back to tool data.
 */

const icao = z.string().regex(/^[A-Z0-9]{4}$/, 'Expected a 4-character ICAO code');

export const Conditions = z.object({
  icao,
  flightCategory: z.enum(FLIGHT_CATEGORIES).nullable(),
  /** e.g. "Wind 240/18G28, broken 1,200 ft, light rain". */
  summary: z.string().min(1).max(200),
  changedSinceDispatch: z.boolean(),
  /** A `reportId` returned by get_weather or get_planned_weather for this airport. */
  sourceReportId: z.string().min(1),
});
export type Conditions = z.infer<typeof Conditions>;

/** The same types get_route_hazards returns. */
export const HAZARD_TYPES = HAZARD_KINDS;
export const HAZARD_SEVERITIES = ['moderate', 'severe'] as const;

export const EnrouteHazard = z.object({
  type: z.enum(HAZARD_TYPES),
  /** One of the advisory's segments from get_route_hazards, copied exactly. */
  fromWaypoint: z.string().min(1),
  toWaypoint: z.string().min(1),
  validUntil: z.iso.datetime().nullable(),
  severity: z.enum(HAZARD_SEVERITIES).nullable(),
  /** An advisoryId returned by get_route_hazards. */
  advisoryId: z.string().min(1),
});
export type EnrouteHazard = z.infer<typeof EnrouteHazard>;

export const RISK_LEVELS = ['low', 'moderate', 'high'] as const;

export const Briefing = z.object({
  headline: z.string().min(1).max(140),
  overallRisk: z.enum(RISK_LEVELS),
  departure: Conditions,
  destination: Conditions,
  /** Null when the plan has no alternate. */
  alternate: Conditions.nullable(),
  /** One entry per segment of each advisory get_route_hazards returned. */
  enrouteHazards: z.array(EnrouteHazard).max(20),
  /** The prompt asks for 150 characters; the model cannot count exactly, so allow some slack. */
  pilotNotes: z.array(z.string().min(1).max(240)).max(5),
});
export type Briefing = z.infer<typeof Briefing>;
