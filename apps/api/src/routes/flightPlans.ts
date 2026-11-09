import type { FlightPlanRepository, PilotRepository } from '@ofplens/db';
import { ImportFlightPlanResponse } from '@ofplens/ofp';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { fetchLatestPlan, usernameRequired, type SimbriefClient } from '../simbrief';

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

  done();
};
