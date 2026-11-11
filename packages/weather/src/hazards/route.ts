import booleanIntersects from '@turf/boolean-intersects';
import { lineString, polygon as turfPolygon } from '@turf/helpers';
import type { Advisory, Position, Ring } from './advisory';
import { greatCircle, unwrap } from './geo';

/** One navlog fix, as much of it as matching needs. */
export interface RoutePoint {
  seq: number;
  ident: string;
  lat: number;
  lon: number;
  altitudeFt: number;
  /** From takeoff. */
  elapsedS: number;
}

/** A stretch of the route inside one advisory: from one fix to a later one. */
export interface RouteSegment {
  fromSeq: number;
  toSeq: number;
  fromIdent: string;
  toIdent: string;
}

export interface RouteHazard {
  advisory: Advisory;
  /** In route order; more than one when the route leaves the area and enters it again. */
  segments: RouteSegment[];
}

export interface MatchOptions {
  /** When the flight takes off; each fix's ETA is this plus its elapsed time. */
  takeoffAt: Date;
  /** Slack on both ends of an advisory's validity (a flight seldom runs exactly to plan). */
  marginMs?: number;
}

export const DEFAULT_MARGIN_MS = 30 * 60_000;

/**
 * Low visibility advisories (IFR, mountains obscured) give no levels: they describe ceilings
 * and visibility near the ground, so they count only below this altitude.
 */
export const LOW_VISIBILITY_TOP_FT = 10_000;

/**
 * Which advisories touch the route, and between which fixes. A leg (one fix to the next)
 * counts when it crosses or lies in one of the advisory's areas, its planned altitudes overlap
 * the advisory's base to top, and the time it is flown overlaps the validity (± the margin).
 * Advisories without a shape never match. Routes across the antimeridian are handled by
 * unwrapping longitudes, so both sides compare continuously.
 */
export function matchRouteHazards(
  route: readonly RoutePoint[],
  advisories: readonly Advisory[],
  { takeoffAt, marginMs = DEFAULT_MARGIN_MS }: MatchOptions,
): RouteHazard[] {
  if (route.length < 2) return [];
  const legs = buildLegs(route, takeoffAt.getTime());
  const result: RouteHazard[] = [];

  for (const advisory of advisories) {
    if (advisory.polygons.length === 0) continue;
    const areas = advisory.polygons.map(toArea);
    const validFrom = Date.parse(advisory.validFrom) - marginMs;
    const validTo = Date.parse(advisory.validTo) + marginMs;
    const base = advisory.baseFt ?? 0;
    const top =
      advisory.topFt ??
      (advisory.hazard === 'low_visibility' ? LOW_VISIBILITY_TOP_FT : Number.POSITIVE_INFINITY);

    const hits = legs.map(
      (leg) =>
        leg.lowFt <= top &&
        leg.highFt >= base &&
        leg.startMs <= validTo &&
        leg.endMs >= validFrom &&
        areas.some((area) => legCrosses(leg, area)),
    );
    const segments = toSegments(legs, hits);
    if (segments.length > 0) result.push({ advisory, segments });
  }

  return result.sort(
    (a, b) =>
      a.segments[0]!.fromSeq - b.segments[0]!.fromSeq || a.advisory.id.localeCompare(b.advisory.id),
  );
}

interface Leg {
  from: RoutePoint;
  to: RoutePoint;
  /** Along the great circle, longitudes unwrapped (may run past ±180). */
  path: Position[];
  west: number;
  east: number;
  south: number;
  north: number;
  lowFt: number;
  highFt: number;
  startMs: number;
  endMs: number;
}

function buildLegs(route: readonly RoutePoint[], takeoffMs: number): Leg[] {
  const legs: Leg[] = [];
  let previousLon = route[0]!.lon;
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1]!;
    const to = route[i]!;
    const path: Position[] = [];
    for (const [lon, lat] of greatCircle([from.lon, from.lat], [to.lon, to.lat])) {
      previousLon = unwrap(lon, previousLon);
      path.push([previousLon, lat]);
    }
    const lons = path.map(([lon]) => lon);
    const lats = path.map(([, lat]) => lat);
    legs.push({
      from,
      to,
      path,
      west: Math.min(...lons),
      east: Math.max(...lons),
      south: Math.min(...lats),
      north: Math.max(...lats),
      lowFt: Math.min(from.altitudeFt, to.altitudeFt),
      highFt: Math.max(from.altitudeFt, to.altitudeFt),
      startMs: takeoffMs + from.elapsedS * 1000,
      endMs: takeoffMs + to.elapsedS * 1000,
    });
    // The next leg starts where this one ended (already unwrapped).
    previousLon = path.at(-1)![0];
  }
  return legs;
}

interface Area {
  ring: Ring;
  west: number;
  east: number;
  south: number;
  north: number;
}

function toArea(ring: Ring): Area {
  const lons = ring.map(([lon]) => lon);
  const lats = ring.map(([, lat]) => lat);
  return {
    ring,
    west: Math.min(...lons),
    east: Math.max(...lons),
    south: Math.min(...lats),
    north: Math.max(...lats),
  };
}

/**
 * Whether the leg crosses or lies in the area. Both use unwrapped longitudes, so the area is
 * also tried one turn east and west of where it was given.
 */
function legCrosses(leg: Leg, area: Area): boolean {
  if (leg.north < area.south || leg.south > area.north) return false;
  for (const shift of [0, -360, 360]) {
    if (leg.east < area.west + shift || leg.west > area.east + shift) continue;
    const ring =
      shift === 0 ? area.ring : area.ring.map(([lon, lat]): Position => [lon + shift, lat]);
    if (booleanIntersects(lineString(leg.path), turfPolygon([ring]))) return true;
  }
  return false;
}

/** Consecutive matching legs become one segment, from the first leg's start to the last's end. */
function toSegments(legs: readonly Leg[], hits: readonly boolean[]): RouteSegment[] {
  const segments: RouteSegment[] = [];
  let open: RouteSegment | null = null;
  legs.forEach((leg, i) => {
    if (!hits[i]) {
      open = null;
      return;
    }
    if (open) {
      open.toSeq = leg.to.seq;
      open.toIdent = leg.to.ident;
    } else {
      open = {
        fromSeq: leg.from.seq,
        toSeq: leg.to.seq,
        fromIdent: leg.from.ident,
        toIdent: leg.to.ident,
      };
      segments.push(open);
    }
  });
  return segments;
}
