import type { FlightPlanSummary } from '@ofplens/ofp';
import {
  greatCirclePath,
  unwrap,
  type HazardKind,
  type OutsideLevelsHazardView,
  type Position,
  type RouteHazardView,
} from '@ofplens/weather';
import { HAZARD_COLOR, HAZARD_LABEL } from '../hazardStyle';

/** Minimal GeoJSON, as MapLibre takes it. */
interface Feature<G, P> {
  type: 'Feature';
  geometry: G;
  properties: P;
}
export interface FeatureCollection<G, P> {
  type: 'FeatureCollection';
  features: Feature<G, P>[];
}
type LineString = { type: 'LineString'; coordinates: Position[] };
type Point = { type: 'Point'; coordinates: Position };
type Polygon = { type: 'Polygon'; coordinates: Position[][] };

export interface HazardProps {
  id: string;
  kind: HazardKind;
  color: string;
  /** "Turbulence · severe", for the popup. */
  title: string;
  /** "FL300–FL400 · until 17:00Z · LCU → KATES". */
  detail: string;
  /** Crossed only above or below its levels: drawn dashed and faint. */
  outside: boolean;
}

export interface RouteMapData {
  /** The whole route along great circles. */
  route: FeatureCollection<LineString, Record<string, never>>;
  fixes: FeatureCollection<Point, { ident: string; airport: boolean }>;
  /** The stretches of the route inside a hazard, in its colour. */
  affected: FeatureCollection<LineString, { color: string }>;
  /** Hazards on the route, then those crossed outside their levels. */
  hazards: FeatureCollection<Polygon, HazardProps>;
  /** Whether any area is outside the route's levels (the legend explains the dashes). */
  hasOutside: boolean;
  /** [[west, south], [east, north]] of the route, longitudes unwrapped. */
  bounds: [Position, Position];
  /** The hazard types shown, in a stable order, for the legend. */
  kinds: HazardKind[];
}

/**
 * Everything the route map draws, from the plan and its hazards (and those it crosses outside
 * their levels, which get no route stretch of their own). Longitudes are unwrapped
 * along the route (continuing past ±180), and each hazard area is moved by whole turns to sit
 * next to it, so transpacific routes and their hazards draw without jumping across the map.
 */
export function buildRouteMapData(
  plan: FlightPlanSummary,
  hazards: readonly RouteHazardView[],
  describe: (hazard: RouteHazardView) => Pick<HazardProps, 'title' | 'detail'>,
  outsideLevels: readonly OutsideLevelsHazardView[] = [],
): RouteMapData | null {
  const waypoints = plan.waypoints;
  if (waypoints.length < 2) return null;

  // Each fix's longitude, continuing from the one before.
  const positions: Position[] = [];
  let previousLon = waypoints[0]!.lon;
  for (const w of waypoints) {
    previousLon = unwrap(w.lon, previousLon);
    positions.push([previousLon, w.lat]);
  }
  const bySeq = new Map(waypoints.map((w, i) => [w.seq, i]));
  const path = greatCirclePath(positions);
  const routeLons = path.map(([lon]) => lon);
  const routeLats = path.map(([, lat]) => lat);
  const middleLon = (Math.min(...routeLons) + Math.max(...routeLons)) / 2;

  const affected: RouteMapData['affected']['features'] = [];
  for (const hazard of hazards) {
    for (const segment of hazard.segments) {
      const from = bySeq.get(segment.fromSeq);
      const to = bySeq.get(segment.toSeq);
      if (from === undefined || to === undefined || to <= from) continue;
      affected.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: greatCirclePath(positions.slice(from, to + 1)),
        },
        properties: { color: HAZARD_COLOR[hazard.hazard] },
      });
    }
  }

  return {
    route: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: path }, properties: {} },
      ],
    },
    fixes: {
      type: 'FeatureCollection',
      features: waypoints.map((w, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: positions[i]! },
        properties: { ident: w.ident, airport: w.type === 'apt' },
      })),
    },
    affected: { type: 'FeatureCollection', features: affected },
    hazards: {
      type: 'FeatureCollection',
      features: [
        ...hazards.map((hazard) => ({ hazard, outside: false })),
        ...outsideLevels.map((hazard) => ({ hazard, outside: true })),
      ].flatMap(({ hazard, outside }) =>
        hazard.polygons.map((ring) => ({
          type: 'Feature' as const,
          geometry: { type: 'Polygon' as const, coordinates: [nextTo(ring, middleLon)] },
          properties: {
            id: hazard.id,
            kind: hazard.hazard,
            color: HAZARD_COLOR[hazard.hazard],
            ...describe(hazard),
            outside,
          },
        })),
      ),
    },
    hasOutside: outsideLevels.some((h) => h.polygons.length > 0),
    bounds: [
      [Math.min(...routeLons), Math.min(...routeLats)],
      [Math.max(...routeLons), Math.max(...routeLats)],
    ],
    kinds: (Object.keys(HAZARD_LABEL) as HazardKind[]).filter((kind) =>
      [...hazards, ...outsideLevels].some((h) => h.hazard === kind),
    ),
  };
}

/** The ring moved by whole turns (±360°) so its middle is closest to `lon`. */
function nextTo(ring: Position[], lon: number): Position[] {
  const lons = ring.map(([x]) => x);
  const middle = (Math.min(...lons) + Math.max(...lons)) / 2;
  const shift = Math.round((lon - middle) / 360) * 360;
  return shift === 0 ? ring : ring.map(([x, y]): Position => [x + shift, y]);
}
