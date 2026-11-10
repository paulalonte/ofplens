import { z } from 'zod';

/**
 * aviationweather.gov Data API JSON (format=json), only the fields OFP Lens uses.
 * Field notes are in docs/PLAN.md, "Weather source". Unknown keys are ignored.
 */

export const FLIGHT_CATEGORIES = ['VFR', 'MVFR', 'IFR', 'LIFR'] as const;
export type FlightCategory = (typeof FLIGHT_CATEGORIES)[number];

const icao = z.string().regex(/^[A-Z0-9]{4}$/);
/** Missing and null are the same to us. */
const maybe = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);

export const AwcMetar = z.object({
  icaoId: icao,
  /** Unix seconds. */
  obsTime: z.number().int(),
  rawOb: z.string().min(1),
  fltCat: maybe(z.enum(FLIGHT_CATEGORIES)),
  /** Degrees, or "VRB". */
  wdir: maybe(z.union([z.number(), z.literal('VRB')])),
  wspd: maybe(z.number()),
  wgst: maybe(z.number()),
  /** Statute miles, or a string such as "10+" / "6+" meaning "at least". */
  visib: maybe(z.union([z.number(), z.string().regex(/^\d+(\.\d+)?\+$/)])),
  clouds: maybe(z.array(z.object({ cover: z.string(), base: maybe(z.number()) }))),
  temp: maybe(z.number()),
  dewp: maybe(z.number()),
  /** hPa. */
  altim: maybe(z.number()),
});
export type AwcMetar = z.output<typeof AwcMetar>;

export const AwcTaf = z.object({
  icaoId: icao,
  issueTime: z.iso.datetime({ offset: true }),
  /** Unix seconds. */
  validTimeFrom: z.number().int(),
  validTimeTo: z.number().int(),
  rawTAF: z.string().min(1),
});
export type AwcTaf = z.output<typeof AwcTaf>;
