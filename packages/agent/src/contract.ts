import { z } from 'zod';
import { Briefing } from './briefing';

/**
 * What the briefing endpoints send, for the API and the web app. No Anthropic SDK in here, so the
 * browser bundle can import it (`@ofplens/agent/contract`).
 */

export { Briefing, Conditions, EnrouteHazard, HAZARD_TYPES, RISK_LEVELS } from './briefing';

export const BRIEFING_STATUSES = ['pending', 'done', 'failed'] as const;

/** A tool call as the browser sees it: name and outcome, not the data it returned. */
export const BriefingToolCall = z.object({
  name: z.string(),
  ok: z.boolean(),
  ms: z.number(),
  error: z.string().nullable(),
});

export const StoredBriefing = z.object({
  id: z.uuid(),
  flightPlanId: z.uuid(),
  status: z.enum(BRIEFING_STATUSES),
  model: z.string(),
  promptVersion: z.string(),
  /** The validated briefing when done. */
  briefing: Briefing.nullable(),
  /** Why it failed. */
  error: z.string().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  latencyMs: z.number().int().nullable(),
  toolCalls: z.array(BriefingToolCall),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type StoredBriefing = z.infer<typeof StoredBriefing>;

/** GET /api/flight-plans/:id/briefings/latest */
export const LatestBriefingResponse = z.object({ briefing: StoredBriefing.nullable() });
export type LatestBriefingResponse = z.infer<typeof LatestBriefingResponse>;

/**
 * Server-Sent Events from POST /api/flight-plans/:id/briefings, in order:
 * `started` once, `tool` per tool call, then `done` or `failed` with the stored briefing.
 */
export const BriefingEvent = z.discriminatedUnion('event', [
  z.object({ event: z.literal('started'), data: z.object({ id: z.uuid() }) }),
  z.object({ event: z.literal('tool'), data: z.object({ name: z.string(), ok: z.boolean() }) }),
  z.object({ event: z.literal('done'), data: StoredBriefing }),
  z.object({ event: z.literal('failed'), data: StoredBriefing }),
]);
export type BriefingEvent = z.infer<typeof BriefingEvent>;
