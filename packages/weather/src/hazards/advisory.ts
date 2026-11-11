import type { z } from 'zod';
import { AwcAirSigmet, AwcGairmet, AwcIsigmet, type AwcPoint } from './schema';

/** Where an advisory came from: the three aviationweather.gov feeds. */
export const HAZARD_SOURCES = ['isigmet', 'airsigmet', 'gairmet'] as const;
export type HazardSource = (typeof HAZARD_SOURCES)[number];

export const HAZARD_KINDS = [
  'thunderstorm',
  'turbulence',
  'icing',
  'volcanic_ash',
  'tropical_cyclone',
  'mountain_wave',
  'low_visibility',
  'other',
] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

export type Severity = 'moderate' | 'severe';

/**
 * [longitude, latitude] in degrees, GeoJSON order. Longitude is -180 to 180, except in an area
 * that crosses the antimeridian, which continues past ±180 to stay continuous (190.5 = 169.5W).
 */
export type Position = [lon: number, lat: number];
/** A closed ring: the first position is repeated at the end. */
export type Ring = Position[];

/** One SIGMET, AIRMET or G-AIRMET area, the same shape whichever feed it came from. */
export interface Advisory {
  /** Stable across refreshes for the same advisory. */
  id: string;
  source: HazardSource;
  hazard: HazardKind;
  /** The feed's own code: "TS", "CONVECTIVE", "TURB-HI"… */
  code: string;
  severity: Severity | null;
  /** "EMBD", "FRQ", the volcano or storm name, "CIG BLW 010 VIS BLW 3SM BR"… */
  detail: string | null;
  /** ISO 8601, UTC. */
  validFrom: string;
  validTo: string;
  /** Feet; null when the advisory gives none (a missing base usually means the surface). */
  baseFt: number | null;
  topFt: number | null;
  /**
   * The areas it covers, usually one. Empty when the feed has no shape (given only as text):
   * such advisories are listed, never matched to a route.
   */
  polygons: Ring[];
  /** Flight information region, e.g. "RPHI"; null for US advisories. */
  fir: string | null;
  firName: string | null;
  /** The bulletin as issued; G-AIRMETs have none. */
  rawText: string | null;
}

/** Each feed code we know, by hazard; anything else becomes "other". */
const KINDS: Record<string, HazardKind> = {
  TS: 'thunderstorm',
  TSGR: 'thunderstorm',
  CONVECTIVE: 'thunderstorm',
  TURB: 'turbulence',
  'TURB-HI': 'turbulence',
  'TURB-LO': 'turbulence',
  ICE: 'icing',
  VA: 'volcanic_ash',
  ASH: 'volcanic_ash',
  TC: 'tropical_cyclone',
  MTW: 'mountain_wave',
  IFR: 'low_visibility',
  MT_OBSC: 'low_visibility',
  'MTN OBSCN': 'low_visibility',
  DS: 'low_visibility',
  SS: 'low_visibility',
};

export const hazardKind = (code: string): HazardKind => KINDS[code.trim().toUpperCase()] ?? 'other';

function severity(code: string | null): Severity | null {
  switch (code?.trim().toUpperCase()) {
    case 'SEV':
      return 'severe';
    case 'MOD':
      return 'moderate';
    default:
      return null;
  }
}

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();
const text = (value: string | null) => (value?.trim() ? value.trim() : null);

/** Closed rings with at least three distinct corners; slivers and single points are dropped. */
function rings(shapes: AwcPoint[][]): Ring[] {
  const result: Ring[] = [];
  for (const shape of shapes) {
    const ring: Ring = shape.map((p) => [p.lon, p.lat]);
    const distinct = new Set(ring.map(([lon, lat]) => `${lon},${lat}`));
    if (distinct.size < 3) continue;
    const [first, last] = [ring[0]!, ring.at(-1)!];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
    result.push(ring);
  }
  return result;
}

/** A short, stable fingerprint of the shape, for feeds whose ids repeat across areas. */
function shapeKey(polygons: Ring[]): string {
  let hash = 0x811c9dc5; // FNV-1a, 32 bit
  for (const char of JSON.stringify(polygons)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function fromIsigmet(raw: AwcIsigmet): Advisory {
  const qualifier = text(raw.qualifier);
  const severe = severity(qualifier);
  return {
    id: `isigmet:${raw.firId ?? raw.icaoId}:${raw.seriesId ?? '-'}:${raw.validTimeFrom}`,
    source: 'isigmet',
    hazard: hazardKind(raw.hazard),
    code: raw.hazard,
    severity: severe,
    detail: severe ? null : qualifier,
    validFrom: iso(raw.validTimeFrom),
    validTo: iso(raw.validTimeTo),
    baseFt: raw.base,
    topFt: raw.top,
    polygons: rings(raw.coords),
    fir: raw.firId,
    firName: raw.firName,
    rawText: raw.rawSigmet,
  };
}

const lowest = (...values: (number | null)[]) => {
  const known = values.filter((v) => v !== null);
  return known.length > 0 ? Math.min(...known) : null;
};
const highest = (...values: (number | null)[]) => {
  const known = values.filter((v) => v !== null);
  return known.length > 0 ? Math.max(...known) : null;
};

export function fromAirSigmet(raw: AwcAirSigmet): Advisory {
  const type = raw.airSigmetType.toUpperCase();
  const convective = raw.hazard.toUpperCase() === 'CONVECTIVE';
  return {
    id: `airsigmet:${type}:${raw.seriesId ?? '-'}:${raw.validTimeFrom}`,
    source: 'airsigmet',
    hazard: hazardKind(raw.hazard),
    code: raw.hazard,
    // US SIGMETs other than convective ones are for severe conditions, AIRMETs for moderate.
    severity: type === 'AIRMET' ? 'moderate' : type === 'SIGMET' && !convective ? 'severe' : null,
    detail: null,
    validFrom: iso(raw.validTimeFrom),
    validTo: iso(raw.validTimeTo),
    baseFt: lowest(raw.altitudeLow1, raw.altitudeLow2),
    topFt: highest(raw.altitudeHi1, raw.altitudeHi2),
    polygons: rings(raw.coords),
    fir: null,
    firName: null,
    rawText: raw.rawAirSigmet,
  };
}

/**
 * A G-AIRMET snapshot shows the area at one time, every 3 hours; we treat it as valid from
 * 90 minutes before to 90 minutes after (never past the product's expiry).
 */
const SNAPSHOT_HALF_WINDOW_MS = 90 * 60_000;

/** "SFC" is 0 ft; "FZL" is the freezing level given alongside; "030" is 3,000 ft. */
function gairmetFeet(level: string | null, freezingLevel: string | null): number | null {
  if (level === null) return null;
  if (level === 'SFC') return 0;
  if (level === 'FZL') return freezingLevel === null ? null : gairmetFeet(freezingLevel, null);
  return Number(level) * 100;
}

/** Freezing-level contours are lines, not hazard areas: they are left out (null). */
export function fromGairmet(raw: AwcGairmet): Advisory | null {
  if (raw.hazard.toUpperCase() === 'FZLVL' || raw.geom?.toUpperCase() === 'LINE') return null;
  const at = Date.parse(raw.validTime);
  const polygons = rings(raw.coords);
  return {
    id: `gairmet:${raw.product}:${raw.tag}:${raw.hazard}:${raw.validTime.slice(0, 13)}Z:${shapeKey(polygons)}`,
    source: 'gairmet',
    hazard: hazardKind(raw.hazard),
    code: raw.hazard,
    severity: severity(raw.severity),
    detail: text(raw.due_to),
    validFrom: new Date(at - SNAPSHOT_HALF_WINDOW_MS).toISOString(),
    validTo: new Date(Math.min(at + SNAPSHOT_HALF_WINDOW_MS, raw.expireTime * 1000)).toISOString(),
    // The lowest freezing level for the base, the highest for the top: the whole layer at risk.
    baseFt: gairmetFeet(raw.base, raw.fzlbase),
    topFt: gairmetFeet(raw.top, raw.fzltop),
    polygons,
    fir: null,
    firName: null,
    rawText: null,
  };
}

const FEEDS: {
  [S in HazardSource]: { schema: z.ZodType; normalise: (raw: never) => Advisory | null };
} = {
  isigmet: { schema: AwcIsigmet, normalise: fromIsigmet },
  airsigmet: { schema: AwcAirSigmet, normalise: fromAirSigmet },
  gairmet: { schema: AwcGairmet, normalise: fromGairmet },
};

/**
 * One feed's response as advisories. Each entry is validated on its own, so one odd entry does
 * not hide the others; the same advisory sent twice is kept once.
 */
export function parseAdvisories(
  source: HazardSource,
  entries: readonly unknown[],
  log?: { warn: (obj: object, msg: string) => void },
): Advisory[] {
  const { schema, normalise } = FEEDS[source];
  const byId = new Map<string, Advisory>();
  for (const entry of entries) {
    const parsed = schema.safeParse(entry);
    if (!parsed.success) {
      log?.warn({ source, issues: parsed.error.issues }, 'Skipped an aviationweather.gov advisory');
      continue;
    }
    const advisory = normalise(parsed.data as never);
    if (advisory && !byId.has(advisory.id)) byId.set(advisory.id, advisory);
  }
  return [...byId.values()];
}
