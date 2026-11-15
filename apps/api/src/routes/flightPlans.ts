import { InvalidCursorError, type FlightPlanRepository, type PilotRepository } from '@ofplens/db';
import {
  FlightPlanDetailResponse,
  FlightPlanListResponse,
  ImportFlightPlanResponse,
} from '@ofplens/ofp';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { planNotFound, signedIn } from '../auth/sessions';
import { AppError } from '../errors';
import { perMinute } from '../rateLimits';
import { fetchLatestPlan, usernameRequired, type SimbriefClient } from '../simbrief';

const PlanParams = z.object({ id: z.uuid('Not a flight plan id') });

export interface FlightPlanRouteOptions {
  pilots: PilotRepository;
  flightPlans: FlightPlanRepository;
  simbrief: SimbriefClient;
  /** Imports per minute per pilot (each one calls SimBrief). */
  rateLimit?: number | undefined;
}

export const flightPlanRoutes: FastifyPluginCallbackZod<FlightPlanRouteOptions> = (
  app,
  { pilots, flightPlans, simbrief, rateLimit },
  done,
) => {
  /**
   * Fetches the signed-in pilot's latest SimBrief plan and stores it with all its details.
   * 201 when stored, 200 when that plan was already imported (nothing written).
   * Errors as for GET /api/simbrief/latest.
   */
  app.post(
    '/api/flight-plans/import',
    {
      schema: { response: { 200: ImportFlightPlanResponse, 201: ImportFlightPlanResponse } },
      config: perMinute(rateLimit),
    },
    async (request, reply) => {
      const pilotId = signedIn(request).id;
      const settings = await pilots.get(pilotId);
      if (!settings) throw usernameRequired();

      const { raw, plan } = await fetchLatestPlan(simbrief, settings.simbriefUsername, request.log);
      const { id, created } = await flightPlans.import({
        pilotId,
        plan,
        rawOfp: raw,
      });

      request.log.info(
        { flightPlanId: id, created, request: plan.simbriefRequestId },
        'Imported plan',
      );
      return reply.status(created ? 201 : 200).send({ id, created, plan });
    },
  );

  /** The signed-in pilot's history, newest first. */
  app.get(
    '/api/flight-plans',
    {
      schema: {
        querystring: z.object({
          cursor: z.string().min(1).max(200).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        response: { 200: FlightPlanListResponse },
      },
    },
    async (request) => {
      try {
        return await flightPlans.list({
          pilotId: signedIn(request).id,
          limit: request.query.limit,
          cursor: request.query.cursor,
        });
      } catch (err) {
        if (err instanceof InvalidCursorError)
          throw new AppError(400, 'INVALID_CURSOR', err.message);
        throw err;
      }
    },
  );

  /**
   * One stored plan, in the same FlightPlanSummary shape as the live briefing. This and every
   * other /api/flight-plans/:id route only run for the plan's own pilot (registerSessions).
   */
  app.get(
    '/api/flight-plans/:id',
    { schema: { params: PlanParams, response: { 200: FlightPlanDetailResponse } } },
    async (request) => {
      const stored = await flightPlans.get(request.params.id);
      if (!stored) throw planNotFound();
      return stored;
    },
  );

  /** Deletes a plan with its fuel, weights, waypoints and weather. 204, or 404 if already gone. */
  app.delete(
    '/api/flight-plans/:id',
    { schema: { params: PlanParams } },
    async (request, reply) => {
      if (!(await flightPlans.delete(request.params.id))) throw planNotFound();
      return reply.status(204).send();
    },
  );

  done();
};
