import { z } from 'zod';

/**
 * Field-level schemas for SimBrief JSON v2, where every value arrives as a string.
 * Each one validates the raw string and transforms it into the type we store.
 */

const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const DURATION_RE = /^(\d+):([0-5]\d):([0-5]\d)$/;

/** "2432" -> 2432 (also decimals like "52.362247"). */
export const num = z
  .string()
  .trim()
  .regex(NUMBER_RE, 'Expected a numeric string')
  .transform(Number);

/** Integer-valued numeric string, e.g. fuel, weights, altitudes. */
export const int = num.pipe(z.number().int());

/** A numeric string that may be empty: "" -> null. */
export const optInt = z.union([z.literal('').transform(() => null), int]);

/** A numeric string that may be empty or missing: "" or absent -> null. */
export const maybeInt = optInt.optional().transform((v) => v ?? null);

/** Non-empty text, trimmed. */
export const text = z.string().trim().min(1);

/** Text that may be empty: "" -> null. */
export const optText = z
  .string()
  .trim()
  .transform((s) => (s === '' ? null : s));

/** ISO 8601 UTC timestamp, kept as a string so summaries stay JSON-safe. */
export const isoUtc = z.iso.datetime();

/** "01:07:31" -> 4051 seconds. Hours may exceed 23. */
export const durationS = z
  .string()
  .regex(DURATION_RE, 'Expected HH:MM:SS')
  .transform((s) => {
    const [, h, m, sec] = DURATION_RE.exec(s) ?? [];
    return Number(h) * 3600 + Number(m) * 60 + Number(sec);
  });

/** Airport UTC offset in hours ("1", "-5", "5.5") -> minutes. */
export const utcOffsetMin = num.transform((hours) => Math.round(hours * 60));

/** Four-letter ICAO airport code. */
export const icao = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]{4}$/, 'Expected a 4-character ICAO code');
