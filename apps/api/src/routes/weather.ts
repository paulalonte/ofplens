import type { NewLiveReport, PlanWeather, WeatherRepository } from '@ofplens/db';
import {
  compareStation,
  decodeMetar,
  FlightPlanWeatherResponse,
  WeatherUnavailableError,
  type StationRole,
  type WeatherClient,
} from '@ofplens/weather';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors';

export interface WeatherRouteOptions {
  weatherReports: WeatherRepository;
  /** Usually the cached aviationweather.gov client (5 minutes per station). */
  weather: WeatherClient;
}

const PlanParams = z.object({ id: z.uuid('Not a flight plan id') });

const planNotFound = () =>
  new AppError(
    404,
    'FLIGHT_PLAN_NOT_FOUND',
    'That flight plan does not exist (it may have been deleted).',
  );

export const weatherRoutes: FastifyPluginCallbackZod<WeatherRouteOptions> = (
  app,
  { weatherReports, weather },
  done,
) => {
  /** At dispatch (OFP) vs now (latest stored live report), per airport. No network. */
  app.get(
    '/api/flight-plans/:id/weather',
    { schema: { params: PlanParams, response: { 200: FlightPlanWeatherResponse } } },
    async (request) => {
      const stored = await weatherReports.forPlan(request.params.id);
      if (!stored) throw planNotFound();
      return toResponse(stored);
    },
  );

  /**
   * Fetches live METAR and TAF for the plan's airports (cached per station), stores the new
   * ones, and answers like GET. 502 WEATHER_UNAVAILABLE when aviationweather.gov is down; the
   * reports stored before are untouched.
   */
  app.post(
    '/api/flight-plans/:id/weather/refresh',
    { schema: { params: PlanParams, response: { 200: FlightPlanWeatherResponse } } },
    async (request) => {
      const stored = await weatherReports.forPlan(request.params.id);
      if (!stored) throw planNotFound();

      const airports = stations(stored);
      const icaos = airports.map((a) => a.icao);
      let metars: Awaited<ReturnType<WeatherClient['fetchMetars']>>;
      let tafs: Awaited<ReturnType<WeatherClient['fetchTafs']>>;
      try {
        [metars, tafs] = await Promise.all([weather.fetchMetars(icaos), weather.fetchTafs(icaos)]);
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

      const reports: NewLiveReport[] = airports.flatMap(({ role, icao }) => {
        const out: NewLiveReport[] = [];
        const metar = metars.get(icao);
        if (metar) {
          const decoded = decodeMetar(metar.raw, metar.observedAt);
          out.push({
            stationIcao: icao,
            role,
            kind: 'metar',
            rawText: metar.raw,
            flightCategory: decoded.category,
            parsed: {
              wind: decoded.wind,
              visibility: decoded.visibility,
              clouds: decoded.clouds,
              ceilingFt: decoded.ceilingFt,
              reportedCategory: metar.reportedCategory,
            },
            observedAt: new Date(metar.observedAt),
          });
        }
        const taf = tafs.get(icao);
        if (taf) {
          out.push({
            stationIcao: icao,
            role,
            kind: 'taf',
            rawText: taf.raw,
            flightCategory: null,
            parsed: { validFrom: taf.validFrom, validTo: taf.validTo },
            observedAt: new Date(taf.issuedAt),
          });
        }
        return out;
      });

      const added = await weatherReports.saveLive(request.params.id, reports, new Date());
      request.log.info({ flightPlanId: request.params.id, added }, 'Live weather refreshed');

      const after = await weatherReports.forPlan(request.params.id);
      if (!after) throw planNotFound();
      return toResponse(after);
    },
  );

  done();
};

function stations(stored: PlanWeather): { role: StationRole; icao: string }[] {
  const { origin, destination, alternate } = stored.plan;
  return [
    { role: 'origin' as const, icao: origin },
    { role: 'destination' as const, icao: destination },
    ...(alternate ? [{ role: 'alternate' as const, icao: alternate }] : []),
  ];
}

const toIso = (date: Date) => date.toISOString().replace('.000Z', 'Z');

function toResponse(stored: PlanWeather): FlightPlanWeatherResponse {
  const dispatchRef = toIso(stored.plan.generatedAt);
  const find = (rows: PlanWeather['ofp'], role: StationRole, kind: 'metar' | 'taf') =>
    rows.find((r) => r.role === role && r.kind === kind);

  return {
    stations: stations(stored).map(({ role, icao }) => {
      const raw = (rows: PlanWeather['ofp'], kind: 'metar' | 'taf', fallbackRef: string) => {
        const row = find(rows, role, kind);
        return row
          ? { raw: row.rawText, referenceIso: row.observedAt ? toIso(row.observedAt) : fallbackRef }
          : null;
      };
      return compareStation(
        role,
        icao,
        { metar: raw(stored.ofp, 'metar', dispatchRef), taf: raw(stored.ofp, 'taf', dispatchRef) },
        {
          metar: raw(stored.live, 'metar', dispatchRef),
          taf: raw(stored.live, 'taf', dispatchRef),
        },
      );
    }),
    liveCheckedAt: stored.liveCheckedAt ? toIso(stored.liveCheckedAt) : null,
  };
}
