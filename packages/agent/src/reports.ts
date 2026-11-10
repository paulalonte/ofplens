import {
  decodeMetar,
  FLIGHT_CATEGORIES,
  type MetarView,
  type StationRole,
  type TafView,
} from '@ofplens/weather';
import { z } from 'zod';

/**
 * Weather reports as the agent sees them. Each one has a `reportId` the briefing must cite,
 * e.g. "dispatch:metar:EDDB:2026-11-09T1320Z" or "live:taf:EDDM:2026-11-10T0500Z".
 */

export const REPORT_SOURCES = ['dispatch', 'live'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

export const MetarReport = z.object({
  reportId: z.string(),
  raw: z.string(),
  observedAt: z.string().nullable(),
  flightCategory: z.enum(FLIGHT_CATEGORIES).nullable(),
  ceilingFt: z.number().nullable(),
  visibilitySm: z.number().nullable(),
  visibilityOrMore: z.boolean(),
  wind: z
    .object({
      directionDeg: z.number().nullable(),
      variable: z.boolean(),
      speedKt: z.number(),
      gustKt: z.number().nullable(),
    })
    .nullable(),
});
export type MetarReport = z.infer<typeof MetarReport>;

export const TafReport = z.object({
  reportId: z.string(),
  raw: z.string(),
  issuedAt: z.string().nullable(),
});
export type TafReport = z.infer<typeof TafReport>;

export const STATION_ROLE = z.enum(['origin', 'destination', 'alternate']);

/** "dispatch:metar:EDDB:2026-11-09T1320Z" */
export function reportId(
  source: ReportSource,
  kind: 'metar' | 'taf',
  icao: string,
  timeIso: string | null,
): string {
  const time = timeIso ? timeIso.replace(/:\d\dZ$/, 'Z').replace(':', '') : 'untimed';
  return `${source}:${kind}:${icao}:${time}`;
}

export function toMetarReport(
  view: MetarView | null,
  source: ReportSource,
  icao: string,
): MetarReport | null {
  if (!view) return null;
  // Wind is not part of the comparison view; decode it from the same raw text.
  const decoded = view.observedAt ? decodeMetar(view.raw, view.observedAt) : null;
  return {
    reportId: reportId(source, 'metar', icao, view.observedAt),
    raw: view.raw,
    observedAt: view.observedAt,
    flightCategory: view.category,
    ceilingFt: view.ceilingFt,
    visibilitySm: view.visibilitySm,
    visibilityOrMore: view.visibilityOrMore,
    wind: decoded?.wind ?? null,
  };
}

export function toTafReport(
  view: TafView | null,
  source: ReportSource,
  icao: string,
): TafReport | null {
  return view
    ? {
        reportId: reportId(source, 'taf', icao, view.issuedAt),
        raw: view.raw,
        issuedAt: view.issuedAt,
      }
    : null;
}

export type { StationRole };
