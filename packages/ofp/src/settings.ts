import { z } from 'zod';
import { WEIGHT_UNITS } from './schema';

/**
 * Pilot settings as they travel between the web app and the API.
 * Shared so both sides validate the same shape.
 */

/** As typed into SimBrief: trimmed, no spaces, 1-64 characters. URL-encoded when used. */
export const SimbriefUsername = z
  .string()
  .trim()
  .min(1, 'Enter your SimBrief username')
  .max(64, 'That is longer than any SimBrief username')
  .regex(/^\S+$/, 'A SimBrief username has no spaces');

export const PilotSettings = z.object({
  simbriefUsername: SimbriefUsername,
  weightUnit: z.enum(WEIGHT_UNITS),
});
export type PilotSettings = z.infer<typeof PilotSettings>;

/** GET /api/pilot and PUT /api/pilot response. `pilot` is null until settings are saved. */
export const PilotResponse = z.object({ pilot: PilotSettings.nullable() });
export type PilotResponse = z.infer<typeof PilotResponse>;
