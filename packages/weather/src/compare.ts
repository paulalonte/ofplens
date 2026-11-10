import { z } from 'zod';
import { decodeMetar } from './metar';
import { FLIGHT_CATEGORIES } from './schema';
import { tafIssuedAt } from './taf';

/**
 * "At dispatch" (the OFP) versus "now" (the latest live report) for each airport of a plan,
 * as GET/POST /api/flight-plans/:id/weather return it. Both sides are decoded by the same code.
 */

const iso = z.iso.datetime();

export const MetarView = z.object({
  raw: z.string(),
  observedAt: iso.nullable(),
  category: z.enum(FLIGHT_CATEGORIES).nullable(),
  ceilingFt: z.number().int().nullable(),
  visibilitySm: z.number().nullable(),
  visibilityOrMore: z.boolean(),
});
export type MetarView = z.infer<typeof MetarView>;

export const TafView = z.object({ raw: z.string(), issuedAt: iso.nullable() });
export type TafView = z.infer<typeof TafView>;

const Reports = z.object({ metar: MetarView.nullable(), taf: TafView.nullable() });

export const STATION_ROLES = ['origin', 'destination', 'alternate'] as const;
export type StationRole = (typeof STATION_ROLES)[number];

export const StationWeather = z.object({
  role: z.enum(STATION_ROLES),
  icao: z.string(),
  dispatch: Reports,
  live: Reports,
  /** The latest METAR is newer than the OFP's and its flight category differs. */
  changedSinceDispatch: z.boolean(),
  /** A TAF issued after the OFP's one (TAFs are reissued routinely, so shown, not flagged). */
  newerTaf: z.boolean(),
});
export type StationWeather = z.infer<typeof StationWeather>;

export const FlightPlanWeatherResponse = z.object({
  stations: z.array(StationWeather),
  /** Last successful live refresh; null when live weather was never fetched. */
  liveCheckedAt: iso.nullable(),
});
export type FlightPlanWeatherResponse = z.infer<typeof FlightPlanWeatherResponse>;

export interface RawReports {
  metar: { raw: string; referenceIso: string } | null;
  taf: { raw: string; referenceIso: string } | null;
}

/** Decodes both sides and compares them. `referenceIso` completes day/time-only stamps. */
export function compareStation(
  role: StationRole,
  icao: string,
  dispatch: RawReports,
  live: RawReports,
): StationWeather {
  const d = view(dispatch);
  const l = view(live);

  const changedSinceDispatch =
    !!d.metar?.observedAt &&
    !!l.metar?.observedAt &&
    l.metar.observedAt > d.metar.observedAt &&
    d.metar.category !== null &&
    l.metar.category !== null &&
    l.metar.category !== d.metar.category;

  const newerTaf = !!d.taf?.issuedAt && !!l.taf?.issuedAt && l.taf.issuedAt > d.taf.issuedAt;

  return { role, icao, dispatch: d, live: l, changedSinceDispatch, newerTaf };
}

function view(reports: RawReports): z.infer<typeof Reports> {
  return {
    metar: reports.metar ? metarView(reports.metar.raw, reports.metar.referenceIso) : null,
    taf: reports.taf
      ? { raw: reports.taf.raw, issuedAt: tafIssuedAt(reports.taf.raw, reports.taf.referenceIso) }
      : null,
  };
}

function metarView(raw: string, referenceIso: string): MetarView {
  const decoded = decodeMetar(raw, referenceIso);
  return {
    raw,
    observedAt: decoded.observedAt,
    category: decoded.category,
    ceilingFt: decoded.ceilingFt,
    visibilitySm: decoded.visibility ? Math.round(decoded.visibility.sm * 100) / 100 : null,
    visibilityOrMore: decoded.visibility?.orMore ?? false,
  };
}
