import type { PilotRepository } from '@ofplens/db';
import { FlightPlanSummary, SimbriefUsername } from '@ofplens/ofp';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { signedIn } from '../auth/sessions';
import { perMinute } from '../rateLimits';
import { fetchLatestPlan, usernameRequired, type SimbriefClient } from '../simbrief';

export interface SimbriefRouteOptions {
  pilots: PilotRepository;
  simbrief: SimbriefClient;
  /** Requests per minute per pilot. */
  rateLimit?: number | undefined;
}

/**
 * GET /api/simbrief/latest — the pilot's latest SimBrief plan as a FlightPlanSummary. Nothing is saved.
 *
 * Errors: 400 USERNAME_REQUIRED (no saved username and none given), 404 SIMBRIEF_NOT_FOUND,
 * 502 SIMBRIEF_UNAVAILABLE, 422 OFP_INVALID (SimBrief answered but we cannot read the plan).
 */
export const simbriefRoutes: FastifyPluginCallbackZod<SimbriefRouteOptions> = (
  app,
  { pilots, simbrief, rateLimit },
  done,
) => {
  app.get(
    '/api/simbrief/latest',
    {
      schema: {
        querystring: z.object({ username: SimbriefUsername.optional() }),
        response: { 200: FlightPlanSummary },
      },
      config: perMinute(rateLimit),
    },
    async (request) => {
      const username =
        request.query.username ?? (await pilots.get(signedIn(request).id))?.simbriefUsername;
      if (!username) throw usernameRequired();

      const { plan } = await fetchLatestPlan(simbrief, username, request.log);
      return plan;
    },
  );

  done();
};
