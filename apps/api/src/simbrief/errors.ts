import { AppError } from '../errors';

/**
 * SimBrief failures, already shaped as API errors so a route can simply let them throw:
 * the error handler turns them into `{ error: { code, message } }` with the right status.
 */

/** Unknown username, or SimBrief has no plan for it. Something the pilot can fix. */
export class SimbriefNotFoundError extends AppError {
  constructor(message: string) {
    super(404, 'SIMBRIEF_NOT_FOUND', message);
    this.name = 'SimbriefNotFoundError';
  }
}

/** SimBrief is down, slow or answered with something unusable. Worth trying again later. */
export class SimbriefUpstreamError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(502, 'SIMBRIEF_UNAVAILABLE', message, options);
    this.name = 'SimbriefUpstreamError';
  }
}
