import type { FlightCategory } from './schema';

/**
 * Flight category from ceiling and visibility, with the FAA thresholds aviationweather.gov uses:
 *
 *   LIFR  ceiling below 500 ft            or visibility below 1 SM
 *   IFR   ceiling 500 to below 1,000 ft   or visibility 1 to below 3 SM
 *   MVFR  ceiling 1,000 to 3,000 ft       or visibility 3 to 5 SM
 *   VFR   ceiling above 3,000 ft (or none) and visibility above 5 SM
 *
 * The worse of the two decides. `null` ceiling means no ceiling (no BKN/OVC/VV layer).
 * Unknown visibility counts as "not limiting"; if visibility is unknown and there is no
 * ceiling either, the category is unknown.
 */
export function flightCategory(
  ceilingFt: number | null,
  visibilitySm: number | null,
): FlightCategory | null {
  if (visibilitySm === null && ceilingFt === null) return null;

  const byCeiling: FlightCategory =
    ceilingFt === null
      ? 'VFR'
      : ceilingFt < 500
        ? 'LIFR'
        : ceilingFt < 1000
          ? 'IFR'
          : ceilingFt <= 3000
            ? 'MVFR'
            : 'VFR';

  const byVisibility: FlightCategory =
    visibilitySm === null
      ? 'VFR'
      : visibilitySm < 1
        ? 'LIFR'
        : visibilitySm < 3
          ? 'IFR'
          : visibilitySm <= 5
            ? 'MVFR'
            : 'VFR';

  return worse(byCeiling, byVisibility);
}

const ORDER: FlightCategory[] = ['VFR', 'MVFR', 'IFR', 'LIFR'];

export function worse(a: FlightCategory, b: FlightCategory): FlightCategory {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}
