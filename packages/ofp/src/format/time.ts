/**
 * Time formatting for the briefing. Everything is computed from UTC instants plus the
 * airport's own UTC offset from the OFP, so the result never depends on the viewer's
 * timezone or on a timezone database.
 *
 * Clock times and durations are both rounded to the nearest minute, so they stay
 * consistent: OUT 14:00Z + block 01:08 = IN 15:08Z, even with seconds in the OFP.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const pad2 = (n: number) => String(n).padStart(2, '0');

function toMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`Not a valid timestamp: ${iso}`);
  return Math.round(ms / MINUTE_MS) * MINUTE_MS;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** The instant `seconds` after `iso`, as an ISO UTC string. Used for ETAs: takeoff + elapsed. */
export function addSeconds(iso: string, seconds: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`Not a valid timestamp: ${iso}`);
  return new Date(ms + seconds * 1000).toISOString().replace('.000Z', 'Z');
}

/** "14:00Z" */
export function formatZulu(iso: string): string {
  return `${clock(toMs(iso))}Z`;
}

/** Local clock time at an airport, e.g. "17:00" for 01:00Z at UTC−8. */
export function formatLocal(iso: string, utcOffsetMin: number): string {
  return clock(toMs(iso) + utcOffsetMin * MINUTE_MS);
}

/**
 * How many days the local date differs from the UTC date: -1, 0 or +1.
 * KSFO departing 01:00Z on 10 NOV is 17:00 local on 9 NOV, so this returns -1.
 */
export function localDayOffset(iso: string, utcOffsetMin: number): number {
  const utc = toMs(iso);
  const local = utc + utcOffsetMin * MINUTE_MS;
  return Math.floor(local / DAY_MS) - Math.floor(utc / DAY_MS);
}

/** "09 NOV 2026" (UTC date). */
export function formatZuluDate(iso: string): string {
  const d = new Date(toMs(iso));
  return `${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Duration as "HH:MM", rounded to the nearest minute; hours are not capped at 24. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`Not a valid duration: ${seconds}`);
  }
  const totalMin = Math.round(seconds / 60);
  return `${pad2(Math.floor(totalMin / 60))}:${pad2(totalMin % 60)}`;
}

/** "UTC", "UTC+1", "UTC-8", "UTC+5:30". */
export function formatUtcOffset(utcOffsetMin: number): string {
  if (utcOffsetMin === 0) return 'UTC';
  const sign = utcOffsetMin > 0 ? '+' : '-';
  const abs = Math.abs(utcOffsetMin);
  const minutes = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${minutes ? `:${pad2(minutes)}` : ''}`;
}
