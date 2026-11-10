import type { AwcMetar, AwcTaf, FlightCategory } from './schema';

/**
 * Live reports in OFP Lens's own shape: ISO UTC times, explicit units, nulls for missing data.
 * Decoding the raw text and computing our own flight category is OFP-20; `reportedCategory`
 * is aviationweather.gov's own label, kept for comparison.
 */
export interface LiveMetar {
  icao: string;
  observedAt: string;
  raw: string;
  reportedCategory: FlightCategory | null;
  wind: {
    directionDeg: number | null;
    variable: boolean;
    speedKt: number;
    gustKt: number | null;
  } | null;
  /** Statute miles; `orMore` for reports like "10+". */
  visibility: { sm: number; orMore: boolean } | null;
  clouds: { cover: string; baseFt: number | null }[];
  temperatureC: number | null;
  dewpointC: number | null;
  altimeterHpa: number | null;
}

export interface LiveTaf {
  icao: string;
  issuedAt: string;
  validFrom: string;
  validTo: string;
  raw: string;
}

const isoFromUnix = (seconds: number) =>
  new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');
const isoUtc = (value: string) => new Date(value).toISOString().replace('.000Z', 'Z');

export function toLiveMetar(m: AwcMetar): LiveMetar {
  return {
    icao: m.icaoId,
    observedAt: isoFromUnix(m.obsTime),
    raw: m.rawOb,
    reportedCategory: m.fltCat,
    wind:
      m.wspd === null
        ? null
        : {
            directionDeg: typeof m.wdir === 'number' ? m.wdir : null,
            variable: m.wdir === 'VRB',
            speedKt: m.wspd,
            gustKt: m.wgst,
          },
    visibility:
      m.visib === null
        ? null
        : typeof m.visib === 'number'
          ? { sm: m.visib, orMore: false }
          : { sm: Number(m.visib.slice(0, -1)), orMore: true },
    clouds: (m.clouds ?? []).map((c) => ({ cover: c.cover, baseFt: c.base })),
    temperatureC: m.temp,
    dewpointC: m.dewp,
    altimeterHpa: m.altim,
  };
}

export function toLiveTaf(t: AwcTaf): LiveTaf {
  return {
    icao: t.icaoId,
    issuedAt: isoUtc(t.issueTime),
    validFrom: isoFromUnix(t.validTimeFrom),
    validTo: isoFromUnix(t.validTimeTo),
    raw: t.rawTAF,
  };
}
