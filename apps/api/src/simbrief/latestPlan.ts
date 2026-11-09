import { OfpParseError, parseOfp, type FlightPlanSummary } from '@ofplens/ofp';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../errors';
import type { SimbriefClient } from './client';

export interface LatestPlan {
  /** The OFP exactly as SimBrief sent it. */
  raw: unknown;
  plan: FlightPlanSummary;
}

/**
 * Fetches and parses the pilot's latest plan. SimBrief failures surface as their own AppErrors
 * (404 / 502); a plan we cannot read becomes 422 OFP_INVALID naming the bad field.
 */
export async function fetchLatestPlan(
  simbrief: SimbriefClient,
  username: string,
  log: FastifyBaseLogger,
): Promise<LatestPlan> {
  const raw = await simbrief.fetchLatestOfp(username);
  try {
    return { raw, plan: parseOfp(raw) };
  } catch (err) {
    if (!(err instanceof OfpParseError)) throw err;
    log.error({ issues: err.issues }, 'SimBrief OFP failed validation');
    throw new AppError(
      422,
      'OFP_INVALID',
      `Your latest SimBrief plan could not be read: ${err.message}`,
      { cause: err },
    );
  }
}

export function usernameRequired(): AppError {
  return new AppError(400, 'USERNAME_REQUIRED', 'Set your SimBrief username in Settings first.');
}
