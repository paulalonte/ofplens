import { z } from 'zod';
import { FlightPlanSummary } from './summary';

/** POST /api/flight-plans/import response (201 when stored, 200 when already imported). */
export const ImportFlightPlanResponse = z.object({
  id: z.uuid(),
  created: z.boolean(),
  plan: FlightPlanSummary,
});
export type ImportFlightPlanResponse = z.infer<typeof ImportFlightPlanResponse>;
