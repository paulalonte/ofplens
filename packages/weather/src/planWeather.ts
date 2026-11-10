import type { WeatherClient } from './client';
import { compareStation, type FlightPlanWeatherResponse, type StationRole } from './compare';
import { decodeMetar } from './metar';

/**
 * A plan's weather, at dispatch and now: read it, or refresh the live side and read it.
 * Shared by the API's weather endpoints, the briefing agent's tools and (later) the MCP server.
 * Storage is behind PlanWeatherStore, which @ofplens/db's weather repository implements.
 */

export type ReportRole = StationRole | 'enroute';
export type ReportKind = 'metar' | 'taf';

export interface StoredReport {
  stationIcao: string;
  role: ReportRole;
  kind: ReportKind;
  rawText: string;
  flightCategory: string | null;
  parsed: unknown;
  /** METAR observation time, or TAF issue time. Null for OFP rows (decoded on read). */
  observedAt: Date | null;
  fetchedAt: Date;
}

export interface NewLiveReport {
  stationIcao: string;
  role: ReportRole;
  kind: ReportKind;
  rawText: string;
  flightCategory: string | null;
  parsed: unknown;
  observedAt: Date;
}

export interface PlanWeather {
  /** The plan's airports and when it was generated (the "dispatch" moment). */
  plan: { generatedAt: Date; origin: string; destination: string; alternate: string | null };
  /** METAR/TAF printed in the OFP. */
  ofp: StoredReport[];
  /** The latest stored live report per station, role and kind. */
  live: StoredReport[];
  liveCheckedAt: Date | null;
}

export interface PlanWeatherStore {
  /** Null when the flight plan does not exist. */
  forPlan(flightPlanId: string): Promise<PlanWeather | null>;
  /** Stores new live reports (known ones skipped) and the check time; returns how many were new. */
  saveLive(flightPlanId: string, reports: NewLiveReport[], checkedAt: Date): Promise<number>;
}

/** Dispatch vs latest stored live weather. No network. Null when the plan does not exist. */
export async function readPlanWeather(
  store: PlanWeatherStore,
  flightPlanId: string,
): Promise<FlightPlanWeatherResponse | null> {
  const stored = await store.forPlan(flightPlanId);
  return stored ? toPlanWeatherResponse(stored) : null;
}

/**
 * Fetches live METAR/TAF for the plan's airports (use a cached client), stores the new ones and
 * returns the comparison. Null when the plan does not exist; throws WeatherUnavailableError
 * when aviationweather.gov cannot be used, leaving stored reports untouched.
 */
export async function refreshPlanWeather(
  store: PlanWeatherStore,
  weather: WeatherClient,
  flightPlanId: string,
  now: Date = new Date(),
): Promise<FlightPlanWeatherResponse | null> {
  const stored = await store.forPlan(flightPlanId);
  if (!stored) return null;

  const airports = planStations(stored);
  const icaos = airports.map((a) => a.icao);
  const [metars, tafs] = await Promise.all([weather.fetchMetars(icaos), weather.fetchTafs(icaos)]);

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

  await store.saveLive(flightPlanId, reports, now);
  return readPlanWeather(store, flightPlanId);
}

/** Origin, destination and (when there is one) alternate, in that order. */
export function planStations(
  stored: Pick<PlanWeather, 'plan'>,
): { role: StationRole; icao: string }[] {
  const { origin, destination, alternate } = stored.plan;
  return [
    { role: 'origin', icao: origin },
    { role: 'destination', icao: destination },
    ...(alternate ? [{ role: 'alternate' as const, icao: alternate }] : []),
  ];
}

const toIso = (date: Date) => date.toISOString().replace('.000Z', 'Z');

/** One raw report per side, with the reference time that completes its day/time stamp. */
export function rawReport(
  rows: StoredReport[],
  role: StationRole,
  kind: ReportKind,
  fallbackReferenceIso: string,
): { raw: string; referenceIso: string } | null {
  const row = rows.find((r) => r.role === role && r.kind === kind);
  return row
    ? {
        raw: row.rawText,
        referenceIso: row.observedAt ? toIso(row.observedAt) : fallbackReferenceIso,
      }
    : null;
}

export function toPlanWeatherResponse(stored: PlanWeather): FlightPlanWeatherResponse {
  const dispatchRef = toIso(stored.plan.generatedAt);
  return {
    stations: planStations(stored).map(({ role, icao }) =>
      compareStation(
        role,
        icao,
        {
          metar: rawReport(stored.ofp, role, 'metar', dispatchRef),
          taf: rawReport(stored.ofp, role, 'taf', dispatchRef),
        },
        {
          metar: rawReport(stored.live, role, 'metar', dispatchRef),
          taf: rawReport(stored.live, role, 'taf', dispatchRef),
        },
      ),
    ),
    liveCheckedAt: stored.liveCheckedAt ? toIso(stored.liveCheckedAt) : null,
  };
}
