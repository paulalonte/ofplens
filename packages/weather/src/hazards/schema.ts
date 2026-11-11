import { z } from 'zod';

/**
 * aviationweather.gov hazard feeds (format=json), only the fields OFP Lens uses. Field notes
 * are in docs/PLAN.md, "Hazard source". Unknown keys are ignored.
 */

/** Missing and null are the same to us. */
const maybe = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);

/** Coordinates come as numbers (SIGMETs) or as strings such as "31.81" (G-AIRMETs). */
const degrees = (limit: number) =>
  z
    .union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)])
    .transform(Number)
    .pipe(z.number().min(-limit).max(limit));

/**
 * Longitudes stay as sent: an area across the antimeridian keeps going past 180 (190.5 is
 * 169.5W) so its edges stay continuous; route matching (OFP-30) deals with that.
 */
const Point = z.object({ lat: degrees(90), lon: degrees(360) });
export type AwcPoint = z.output<typeof Point>;

/**
 * One shape is a list of points; several ("AREAS") are a list of lists. Advisories given only
 * as text have none.
 */
const Coords = maybe(z.union([z.array(Point), z.array(z.array(Point))])).transform(
  (coords): AwcPoint[][] => {
    if (!coords || coords.length === 0) return [];
    return Array.isArray(coords[0]) ? (coords as AwcPoint[][]) : [coords as AwcPoint[]];
  },
);

/** Unix seconds. */
const unixTime = z.number().int().positive();

/** International SIGMET (`/api/data/isigmet`), worldwide. Levels are feet. */
export const AwcIsigmet = z.object({
  icaoId: z.string().min(1),
  firId: maybe(z.string().min(1)),
  firName: maybe(z.string().min(1)),
  seriesId: maybe(z.union([z.string(), z.number()]).transform(String)),
  validTimeFrom: unixTime,
  validTimeTo: unixTime,
  hazard: z.string().min(1),
  /** "SEV", "EMBD", "FRQ"…; the volcano for VA, the storm's name for TC. */
  qualifier: maybe(z.string()),
  base: maybe(z.number()),
  top: maybe(z.number()),
  coords: Coords,
  rawSigmet: z.string().min(1),
});
export type AwcIsigmet = z.output<typeof AwcIsigmet>;

/** US SIGMET, convective SIGMET or AIRMET (`/api/data/airsigmet`). Levels are feet. */
export const AwcAirSigmet = z.object({
  icaoId: maybe(z.string()),
  seriesId: maybe(z.union([z.string(), z.number()]).transform(String)),
  validTimeFrom: unixTime,
  validTimeTo: unixTime,
  airSigmetType: z.string().min(1),
  hazard: z.string().min(1),
  altitudeLow1: maybe(z.number()),
  altitudeLow2: maybe(z.number()),
  altitudeHi1: maybe(z.number()),
  altitudeHi2: maybe(z.number()),
  coords: Coords,
  rawAirSigmet: z.string().min(1),
});
export type AwcAirSigmet = z.output<typeof AwcAirSigmet>;

/** "SFC", "FZL", or hundreds of feet such as "030" / "420". */
const gairmetLevel = maybe(z.string().regex(/^(SFC|FZL|\d{1,3})$/));

/** US G-AIRMET snapshot (`/api/data/gairmet`): one hazard area at one forecast time. */
export const AwcGairmet = z.object({
  product: z.string().min(1),
  tag: z.string().min(1),
  forecastHour: z.number().int(),
  validTime: z.iso.datetime({ offset: true }),
  expireTime: unixTime,
  hazard: z.string().min(1),
  geom: maybe(z.string()),
  severity: maybe(z.string()),
  due_to: maybe(z.string()),
  base: gairmetLevel,
  top: gairmetLevel,
  /** The freezing level, when an icing area starts or ends at it ("FZL"). */
  fzlbase: gairmetLevel,
  fzltop: gairmetLevel,
  coords: Coords,
});
export type AwcGairmet = z.output<typeof AwcGairmet>;
