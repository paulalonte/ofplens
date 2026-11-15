import type { HazardRepository } from '@ofplens/db';
import {
  FlightPlanHazardsResponse,
  readPlanHazards,
  refreshPlanHazards,
  WeatherUnavailableError,
  type HazardClient,
} from '@ofplens/weather';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { planNotFound } from '../auth/sessions';
import { AppError } from '../errors';
import { perMinute } from '../rateLimits';

export interface HazardRouteOptions {
  hazards: HazardRepository;
  /** Usually the cached aviationweather.gov hazard client (5 minutes, shared by all plans). */
  hazardFeeds: HazardClient;
  now?: () => Date;
  /** Refreshes per minute per pilot. */
  rateLimit?: number | undefined;
}

const PlanParams = z.object({ id: z.uuid('Not a flight plan id') });

export const hazardRoutes: FastifyPluginCallbackZod<HazardRouteOptions> = (
  app,
  { hazards, hazardFeeds, now = () => new Date(), rateLimit },
  done,
) => {
  /** SIGMETs and G-AIRMETs on the route, as found by the last check. No network. */
  app.get(
    '/api/flight-plans/:id/hazards',
    { schema: { params: PlanParams, response: { 200: FlightPlanHazardsResponse } } },
    async (request) => (await readPlanHazards(hazards, request.params.id)) ?? throwNotFound(),
  );

  /**
   * Reads the hazard feeds (cached), matches them to the route by area, level and time, and
   * stores the result in place of the last one; answers like GET. 502 HAZARDS_UNAVAILABLE when
   * no feed can be read; the stored hazards are untouched.
   */
  app.post(
    '/api/flight-plans/:id/hazards/refresh',
    {
      schema: { params: PlanParams, response: { 200: FlightPlanHazardsResponse } },
      config: perMinute(rateLimit),
    },
    async (request) => {
      try {
        return (
          (await refreshPlanHazards(hazards, hazardFeeds, request.params.id, now())) ??
          throwNotFound()
        );
      } catch (err) {
        if (!(err instanceof WeatherUnavailableError)) throw err;
        request.log.warn({ err }, 'Hazard feeds unavailable');
        throw new AppError(
          502,
          'HAZARDS_UNAVAILABLE',
          `Hazard advisories are unavailable right now: ${err.message}`,
          { cause: err },
        );
      }
    },
  );

  done();
};

function throwNotFound(): never {
  throw planNotFound();
}
