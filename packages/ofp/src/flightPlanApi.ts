import { z } from 'zod';
import { WEIGHT_UNITS } from './schema';
import { FlightPlanSummary } from './summary';

/** POST /api/flight-plans/import response (201 when stored, 200 when already imported). */
export const ImportFlightPlanResponse = z.object({
  id: z.uuid(),
  created: z.boolean(),
  plan: FlightPlanSummary,
});
export type ImportFlightPlanResponse = z.infer<typeof ImportFlightPlanResponse>;

/** One row of the history list: enough for date, route, aircraft and block time. */
export const FlightPlanListItem = z.object({
  id: z.uuid(),
  simbriefRequestId: z.string(),
  generatedAt: z.iso.datetime(),
  importedAt: z.iso.datetime(),
  callsign: z.string().nullable(),
  aircraftIcao: z.string(),
  originIcao: z.string(),
  destinationIcao: z.string(),
  alternateIcao: z.string().nullable(),
  /** Planned off-block time (UTC). */
  out: z.iso.datetime(),
  blockTimeS: z.number().int(),
  units: z.enum(WEIGHT_UNITS),
});
export type FlightPlanListItem = z.infer<typeof FlightPlanListItem>;

/** GET /api/flight-plans — newest first. Pass `nextCursor` back as ?cursor= for the next page. */
export const FlightPlanListResponse = z.object({
  items: z.array(FlightPlanListItem),
  nextCursor: z.string().nullable(),
});
export type FlightPlanListResponse = z.infer<typeof FlightPlanListResponse>;

/** GET /api/flight-plans/:id — a stored plan, in the same shape the briefing page renders. */
export const FlightPlanDetailResponse = z.object({
  id: z.uuid(),
  importedAt: z.iso.datetime(),
  plan: FlightPlanSummary,
});
export type FlightPlanDetailResponse = z.infer<typeof FlightPlanDetailResponse>;
