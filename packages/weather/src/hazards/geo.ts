import type { Position } from './advisory';

/**
 * Small spherical helpers shared by route matching (API) and the route map (web). No
 * dependencies, so the web bundle can use them.
 */

/** Long legs are followed along the great circle in steps of at most this many degrees. */
const MAX_STEP_DEG = 1;

/** The longitude equal to `lon` (mod 360) that is closest to `near`. */
export function unwrap(lon: number, near: number): number {
  let value = lon;
  while (value - near > 180) value -= 360;
  while (value - near < -180) value += 360;
  return value;
}

const RAD = Math.PI / 180;

/** Points along the great circle from a to b, both ends included. */
export function greatCircle(a: Position, b: Position): Position[] {
  const [lon1, lat1] = [a[0] * RAD, a[1] * RAD];
  const [lon2, lat2] = [b[0] * RAD, b[1] * RAD];
  const p1 = [Math.cos(lat1) * Math.cos(lon1), Math.cos(lat1) * Math.sin(lon1), Math.sin(lat1)];
  const p2 = [Math.cos(lat2) * Math.cos(lon2), Math.cos(lat2) * Math.sin(lon2), Math.sin(lat2)];
  const dot = Math.min(1, Math.max(-1, p1[0]! * p2[0]! + p1[1]! * p2[1]! + p1[2]! * p2[2]!));
  const angle = Math.acos(dot);
  const steps = Math.max(1, Math.ceil(angle / RAD / MAX_STEP_DEG));
  if (angle < 1e-9) return [a, b];

  const points: Position[] = [a];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const k1 = Math.sin((1 - t) * angle) / Math.sin(angle);
    const k2 = Math.sin(t * angle) / Math.sin(angle);
    const x = k1 * p1[0]! + k2 * p2[0]!;
    const y = k1 * p1[1]! + k2 * p2[1]!;
    const z = k1 * p1[2]! + k2 * p2[2]!;
    points.push([Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD]);
  }
  points.push(b);
  return points;
}

/**
 * A route through the given [lon, lat] points along great circles, with longitudes unwrapped
 * (continuing past ±180) so it never jumps across the map.
 */
export function greatCirclePath(points: readonly Position[]): Position[] {
  const path: Position[] = [];
  let previousLon = points[0]?.[0] ?? 0;
  for (let i = 1; i < points.length; i++) {
    const leg = greatCircle(points[i - 1]!, points[i]!);
    for (const [j, [lon, lat]] of leg.entries()) {
      previousLon = unwrap(lon, previousLon);
      if (i > 1 && j === 0) continue; // the previous leg ended here
      path.push([previousLon, lat]);
    }
  }
  if (points.length === 1) path.push([points[0]![0], points[0]![1]]);
  return path;
}
