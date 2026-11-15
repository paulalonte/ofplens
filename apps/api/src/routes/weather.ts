import type { WeatherRepository } from '@ofplens/db';
import {
  FlightPlanWeatherResponse,
  readPlanWeather,
  refreshPlanWeather,
  WeatherUnavailableError,
  type WeatherClient,
} from '@ofplens/weather';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { planNotFound } from '../auth/sessions';
import { AppError } from '../errors';
import { perMinute } from '../rateLimits';

export interface WeatherRouteOptions {
  weatherReports: WeatherRepository;
  /** Usually the cached aviationweather.gov client (5 minutes per station). */
  weather: WeatherClient;
  /** Refreshes per minute per pilot. */
  rateLimit?: number | undefined;
}

const PlanParams = z.object({ id: z.uuid('Not a flight plan id') });

export const weatherRoutes: FastifyPluginCallbackZod<WeatherRouteOptions> = (
  app,
  { weatherReports, weather, rateLimit },
  done,
) => {
  /** At dispatch (OFP) vs now (latest stored live report), per airport. No network. */
  app.get(
    '/api/flight-plans/:id/weather',
    { schema: { params: PlanParams, response: { 200: FlightPlanWeatherResponse } } },
    async (request) =>
      (await readPlanWeather(weatherReports, request.params.id)) ?? throwNotFound(),
  );

  /**
   * Fetches live METAR and TAF for the plan's airports (cached per station), stores the new
   * ones, and answers like GET. 502 WEATHER_UNAVAILABLE when aviationweather.gov is down; the
   * reports stored before are untouched.
   */
  app.post(
    '/api/flight-plans/:id/weather/refresh',
    {
      schema: { params: PlanParams, response: { 200: FlightPlanWeatherResponse } },
      config: perMinute(rateLimit),
    },
    async (request) => {
      try {
        return (
          (await refreshPlanWeather(weatherReports, weather, request.params.id)) ?? throwNotFound()
        );
      } catch (err) {
        if (!(err instanceof WeatherUnavailableError)) throw err;
        request.log.warn({ err }, 'Live weather unavailable');
        throw new AppError(
          502,
          'WEATHER_UNAVAILABLE',
          `Live weather is unavailable right now: ${err.message}`,
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
