import { z } from 'zod';
import { Performance } from './performance';
import { WEIGHT_UNITS } from './schema';

/**
 * Everything OFP Lens shows about one flight plan, in our own shape and naming.
 * Defined as Zod schemas so the API can validate what it sends and the web app what it receives;
 * the TypeScript types are inferred from them.
 *
 * - Weights and fuel are integers in the OFP's own unit (`units`); convert only for display.
 * - Timestamps are ISO 8601 UTC strings, so the summary survives JSON and DB round trips unchanged.
 * - Durations and elapsed times are in seconds.
 */

const int = z.number().int();
const iso = z.iso.datetime();

export const Airport = z.object({
  icao: z.string(),
  iata: z.string().nullable(),
  name: z.string(),
  runway: z.string().nullable(),
  /** Feet above mean sea level. */
  elevationFt: int.nullable(),
  /** The airport's UTC offset in minutes at the time of the flight, from the OFP. */
  utcOffsetMin: int,
  /** METAR and TAF as printed in the OFP at dispatch. */
  metar: z.string().nullable(),
  taf: z.string().nullable(),
});
export type Airport = z.infer<typeof Airport>;

export const Waypoint = z.object({
  /** 0-based position in the navlog. */
  seq: int.nonnegative(),
  ident: z.string(),
  name: z.string().nullable(),
  /** SimBrief fix type: apt, wpt, vor, ndb, ltlg (TOC/TOD are ltlg with ident TOC/TOD), ... */
  type: z.string(),
  /** CLB, CRZ or DSC. */
  stage: z.string().nullable(),
  /** Airway, procedure or DCT used to reach this fix. */
  via: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
  altitudeFt: int,
  windDirDeg: int,
  windSpeedKt: int,
  oatC: int,
  /** Cumulative time from takeoff. */
  elapsedS: int,
  fuelOnBoard: int,
});
export type Waypoint = z.infer<typeof Waypoint>;

/** A step climb: reach `altitudeFt` at the fix `at`. */
export const StepClimb = z.object({ at: z.string(), altitudeFt: int });
export type StepClimb = z.infer<typeof StepClimb>;

export const FlightPlanSummary = z.object({
  simbriefRequestId: z.string(),
  generatedAt: iso,
  airac: z.string().nullable(),
  units: z.enum(WEIGHT_UNITS),
  flight: z.object({
    airlineIcao: z.string().nullable(),
    flightNumber: z.string().nullable(),
    callsign: z.string().nullable(),
  }),
  aircraft: z.object({
    icao: z.string(),
    reg: z.string().nullable(),
    name: z.string().nullable(),
  }),
  origin: Airport,
  destination: Airport,
  alternate: Airport.nullable(),
  route: z.object({
    text: z.string(),
    cruiseAltitudeFt: int,
    costIndex: int.nullable(),
    distanceNm: int,
    /** Great-circle distance between origin and destination. */
    gcDistanceNm: int.nullable(),
    /** Planned step climbs after the initial cruise altitude, in order. */
    stepClimbs: z.array(StepClimb),
    /** Route averages from SimBrief. */
    avgIsaDevC: int.nullable(),
    avgTropopauseFt: int.nullable(),
    /** Positive = tailwind, negative = headwind. */
    avgWindComponentKt: int.nullable(),
  }),
  /** Planned (SimBrief-computed) gate and runway times. */
  times: z.object({
    out: iso,
    off: iso,
    on: iso,
    in: iso,
    blockTimeS: int,
    airTimeS: int,
  }),
  fuel: z.object({
    ramp: int,
    taxi: int,
    trip: int,
    contingency: int,
    alternate: int,
    finalReserve: int,
    extra: int,
    landing: int,
  }),
  weights: z.object({
    paxCount: int,
    cargo: int,
    payload: int,
    zfw: int,
    tow: int,
    ldw: int,
  }),
  waypoints: z.array(Waypoint),
  /** SimBrief's takeoff and landing data for the planned runways; null when the OFP has none. */
  performance: Performance.nullable(),
});
export type FlightPlanSummary = z.infer<typeof FlightPlanSummary>;
