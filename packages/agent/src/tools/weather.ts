import {
  readPlanWeather,
  refreshPlanWeather,
  WeatherUnavailableError,
  type FlightPlanWeatherResponse,
} from '@ofplens/weather';
import { z } from 'zod';
import { MetarReport, STATION_ROLE, TafReport, toMetarReport, toTafReport } from '../reports';
import { defineTool, ToolError } from './tool';

const PlanInput = z.object({ flightPlanId: z.uuid() });

const notFound = (id: string) => new ToolError(`No flight plan with id ${id}`);

/** METAR and TAF printed in the OFP when the plan was generated. */
export const getPlannedWeather = defineTool({
  name: 'get_planned_weather',
  description:
    'Weather at dispatch: the METAR and TAF printed in the flight plan for each airport, ' +
    'decoded (flight category, ceiling, visibility, wind). Each report has a reportId to cite.',
  input: PlanInput,
  output: z.object({
    stations: z.array(
      z.object({
        role: STATION_ROLE,
        icao: z.string(),
        metar: MetarReport.nullable(),
        taf: TafReport.nullable(),
      }),
    ),
  }),
  async run({ flightPlanId }, { weatherReports }) {
    const weather = await readPlanWeather(weatherReports, flightPlanId);
    if (!weather) throw notFound(flightPlanId);
    return {
      stations: weather.stations.map((s) => ({
        role: s.role,
        icao: s.icao,
        metar: toMetarReport(s.dispatch.metar, 'dispatch', s.icao),
        taf: toTafReport(s.dispatch.taf, 'dispatch', s.icao),
      })),
    };
  },
});

/**
 * The latest METAR and TAF from aviationweather.gov (cached 5 minutes per airport), stored
 * and compared with dispatch. When the service is down, says so and returns what was stored.
 */
export const getWeather = defineTool({
  name: 'get_weather',
  description:
    'Current weather: the latest METAR and TAF for each airport from aviationweather.gov, ' +
    'decoded, with changedSinceDispatch when the flight category differs from the planned ' +
    'weather. If live weather is unavailable, liveAvailable is false and the last stored ' +
    'reports (if any) are returned. Each report has a reportId to cite.',
  input: PlanInput,
  output: z.object({
    liveAvailable: z.boolean(),
    note: z.string().nullable(),
    checkedAt: z.string().nullable(),
    stations: z.array(
      z.object({
        role: STATION_ROLE,
        icao: z.string(),
        metar: MetarReport.nullable(),
        taf: TafReport.nullable(),
        changedSinceDispatch: z.boolean(),
        newerTafThanDispatch: z.boolean(),
      }),
    ),
  }),
  async run({ flightPlanId }, { weatherReports, weather }) {
    let result: FlightPlanWeatherResponse | null;
    let note: string | null = null;
    try {
      result = await refreshPlanWeather(weatherReports, weather, flightPlanId);
    } catch (err) {
      if (!(err instanceof WeatherUnavailableError)) throw err;
      note = 'Live weather is unavailable right now; showing the last stored reports, if any.';
      result = await readPlanWeather(weatherReports, flightPlanId);
    }
    if (!result) throw notFound(flightPlanId);

    return {
      liveAvailable: note === null,
      note,
      checkedAt: result.liveCheckedAt,
      stations: result.stations.map((s) => ({
        role: s.role,
        icao: s.icao,
        metar: toMetarReport(s.live.metar, 'live', s.icao),
        taf: toTafReport(s.live.taf, 'live', s.icao),
        changedSinceDispatch: s.changedSinceDispatch,
        newerTafThanDispatch: s.newerTaf,
      })),
    };
  },
});
