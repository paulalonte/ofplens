import { InvalidCursorError, type FlightPlanRepository, type PilotRepository } from '@ofplens/db';
import {
  FlightPlanDetailResponse,
  FlightPlanListResponse,
  ImportFlightPlanResponse,
} from '@ofplens/ofp';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors';
import { fetchLatestPlan, usernameRequired, type SimbriefClient } from '../simbrief';

const PlanParams = z.object({ id: z.uuid('Not a flight plan id') });

const planNotFound = () =>
  new AppError(
    404,
    'FLIGHT_PLAN_NOT_FOUND',
    'That flight plan does not exist (it may have been deleted).',
  );

export interface FlightPlanRouteOptions {
  pilots: PilotRepository;
  flightPlans: FlightPlanRepository;
  simbrief: SimbriefClient;
}

export const flightPlanRoutes: FastifyPluginCallbackZod<FlightPlanRouteOptions> = (
  app,
  { pilots, flightPlans, simbrief },
  done,
) => {
  /**
   * Fetches the saved pilot's latest SimBrief plan and stores it with all its details.
   * 201 when stored, 200 when that plan was already imported (nothing written).
   * Errors as for GET /api/simbrief/latest.
   */
  app.post(
    '/api/flight-plans/import',
    { schema: { response: { 200: ImportFlightPlanResponse, 201: ImportFlightPlanResponse } } },
    async (request, reply) => {
      const pilot = await pilots.get();
      if (!pilot) throw usernameRequired();

      const { raw, plan } = await fetchLatestPlan(simbrief, pilot.simbriefUsername, request.log);
      const { id, created } = await flightPlans.import({
        simbriefUsername: pilot.simbriefUsername,
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

  /** History, newest first. Without saved settings there is simply no history yet. */
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
      const pilot = await pilots.get();
      if (!pilot) return { items: [], nextCursor: null };
      try {
        return await flightPlans.list({
          simbriefUsername: pilot.simbriefUsername,
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

  /** One stored plan, in the same FlightPlanSummary shape as the live briefing. */
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
