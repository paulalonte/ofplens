import { z } from 'zod';
import {
  durationS,
  icao,
  int,
  isoUtc,
  maybeInt,
  num,
  optInt,
  optText,
  text,
  utcOffsetMin,
} from './values';

/**
 * Zod schema for the parts of a SimBrief JSON v2 OFP that OFP Lens uses.
 * Unknown keys are ignored (the full OFP has ~40 sections we do not read).
 * Field paths are checked against fixtures/ofp/*.json; see "OFP field mapping" in docs/PLAN.md.
 */

export const WEIGHT_UNITS = ['kgs', 'lbs'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

const OfpAirport = z.object({
  icao_code: icao,
  iata_code: optText,
  name: text,
  plan_rwy: optText,
  /** Feet above mean sea level. */
  elevation: maybeInt,
  timezone: utcOffsetMin,
  metar: optText,
  taf: optText,
});

const OfpFix = z.object({
  ident: text,
  name: optText,
  type: text,
  stage: optText,
  via_airway: optText,
  pos_lat: num.pipe(z.number().min(-90).max(90)),
  pos_long: num.pipe(z.number().min(-180).max(180)),
  altitude_feet: int,
  wind_dir: int,
  wind_spd: int,
  oat: int,
  time_total: durationS,
  fuel_plan_onboard: int,
});

export const OfpSchema = z.object({
  params: z.object({
    request_id: text,
    time_generated: isoUtc,
    airac: optText,
    units: z.enum(WEIGHT_UNITS),
  }),
  general: z.object({
    icao_airline: optText,
    flight_number: optText,
    route: text,
    initial_altitude: int,
    costindex: optInt,
    route_distance: int,
    gc_distance: maybeInt,
    /** "KSFO/0350/DBQ/0370": fix / flight level pairs, the first being the initial cruise. */
    stepclimb_string: optText.optional().transform((v) => v ?? null),
    /** Route averages: ISA deviation (°C), tropopause (ft), wind component (kt, + = tailwind). */
    avg_temp_dev: maybeInt,
    avg_tropopause: maybeInt,
    avg_wind_comp: maybeInt,
  }),
  atc: z.object({ callsign: optText }),
  aircraft: z.object({
    icaocode: text,
    reg: optText,
    name: optText,
  }),
  origin: OfpAirport,
  destination: OfpAirport,
  /** Takeoff and landing data; read leniently by parsePerformance. */
  tlr: z.unknown().optional(),
  alternate: z.array(OfpAirport),
  times: z.object({
    est_out: isoUtc,
    est_off: isoUtc,
    est_on: isoUtc,
    est_in: isoUtc,
    est_block: durationS,
    est_time_enroute: durationS,
  }),
  fuel: z.object({
    plan_ramp: int,
    taxi: int,
    enroute_burn: int,
    contingency: int,
    alternate_burn: int,
    reserve: int,
    extra: int,
    plan_landing: int,
  }),
  weights: z.object({
    pax_count: int,
    cargo: int,
    payload: int,
    est_zfw: int,
    est_tow: int,
    est_ldw: int,
  }),
  navlog: z.array(OfpFix).min(1),
});

export type Ofp = z.output<typeof OfpSchema>;
