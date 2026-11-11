import type { DecodedMetar } from './metar';

export type MetarWind = NonNullable<DecodedMetar['wind']>;

export interface RunwayWind {
  /** Negative = tailwind. Null when the wind direction is variable. */
  headwindKt: number | null;
  /** Always positive; the side is in `crosswindFrom`. Null when variable. */
  crosswindKt: number | null;
  crosswindFrom: 'left' | 'right' | null;
  /** Crosswind in the gusts, when the METAR reports gusts. */
  gustCrosswindKt: number | null;
}

/**
 * Headwind and crosswind on a runway from a METAR wind. METAR directions are true, so the
 * runway's true course must be used. Rounded to whole knots.
 */
export function runwayWind(wind: MetarWind, runwayTrueCourseDeg: number): RunwayWind {
  if (wind.directionDeg === null || wind.variable) {
    const calm = wind.speedKt === 0;
    return {
      headwindKt: calm ? 0 : null,
      crosswindKt: calm ? 0 : null,
      crosswindFrom: null,
      gustCrosswindKt: null,
    };
  }
  const angle = ((wind.directionDeg - runwayTrueCourseDeg) * Math.PI) / 180;
  const across = (speed: number) => Math.abs(Math.round(Math.sin(angle) * speed));
  const head = Math.round(Math.cos(angle) * wind.speedKt);
  const cross = across(wind.speedKt);
  const sideways = Math.sin(angle);
  return {
    headwindKt: Object.is(head, -0) ? 0 : head,
    crosswindKt: cross,
    crosswindFrom: cross === 0 ? null : sideways > 0 ? 'right' : 'left',
    gustCrosswindKt: wind.gustKt === null ? null : across(wind.gustKt),
  };
}
