import type { PilotRepository } from '@ofplens/db';
import { FlightPlanSummary, OfpParseError, parseOfp, SimbriefUsername } from '@ofplens/ofp';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors';
import type { SimbriefClient } from '../simbrief';

export interface SimbriefRouteOptions {
  pilots: PilotRepository;
  simbrief: SimbriefClient;
}

/**
 * GET /api/simbrief/latest — the pilot's latest SimBrief plan as a FlightPlanSummary. Nothing is saved.
 *
 * Errors: 400 USERNAME_REQUIRED (no saved username and none given), 404 SIMBRIEF_NOT_FOUND,
 * 502 SIMBRIEF_UNAVAILABLE, 422 OFP_INVALID (SimBrief answered but we cannot read the plan).
 */
export const simbriefRoutes: FastifyPluginCallbackZod<SimbriefRouteOptions> = (
  app,
  { pilots, simbrief },
  done,
) => {
  app.get(
    '/api/simbrief/latest',
    {
      schema: {
        querystring: z.object({ username: SimbriefUsername.optional() }),
        response: { 200: FlightPlanSummary },
      },
    },
    async (request) => {
      const username = request.query.username ?? (await pilots.get())?.simbriefUsername;
      if (!username) {
        throw new AppError(
          400,
          'USERNAME_REQUIRED',
          'Set your SimBrief username in Settings first.',
        );
      }

      // SimbriefNotFoundError / SimbriefUpstreamError are AppErrors: they map to 404 / 502.
      const raw = await simbrief.fetchLatestOfp(username);

      try {
        return parseOfp(raw);
      } catch (err) {
        if (!(err instanceof OfpParseError)) throw err;
        request.log.error({ issues: err.issues }, 'SimBrief OFP failed validation');
        throw new AppError(
          422,
          'OFP_INVALID',
          `Your latest SimBrief plan could not be read: ${err.message}`,
          { cause: err },
        );
      }
    },
  );

  done();
};
