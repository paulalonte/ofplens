/** Flight data as pilots read it. Display only; the numbers come from the OFP. */

/** 35000 -> "FL350"; 4500 -> "FL045". */
export function formatFlightLevel(altitudeFt: number): string {
  return `FL${String(Math.round(altitudeFt / 100)).padStart(3, '0')}`;
}

/** 61 -> "61 kt tailwind", -6 -> "6 kt headwind", 0 -> "No wind component". */
export function formatWindComponent(kt: number): string {
  if (kt === 0) return 'No wind component';
  return `${Math.abs(kt)} kt ${kt > 0 ? 'tailwind' : 'headwind'}`;
}

/** 30.13 inHg -> "1020 hPa · 30.13 inHg" (hPa first, as in the briefing). */
export function formatAltimeter(inHg: number): string {
  return `${Math.round(inHg * 33.8639)} hPa · ${inHg.toFixed(2)} inHg`;
}

/** 1 -> "ISA +1", -2 -> "ISA −2", 0 -> "ISA +0". */
export function formatIsaDeviation(c: number): string {
  return c < 0 ? `ISA −${Math.abs(c)}` : `ISA +${c}`;
}
