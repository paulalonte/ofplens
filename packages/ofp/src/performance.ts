import { z } from 'zod';

/**
 * Takeoff and landing data from SimBrief's TLR section (`tlr`): the planned runway's conditions
 * and setup as SimBrief computed them when the plan was generated. Optional data: some aircraft
 * have no TLR, and SimBrief writes empty values as "" or []. Anything missing becomes null, and
 * a TLR that cannot be read at all gives null rather than failing the import.
 */

const intOrNull = (scale = 1) =>
  z
    .unknown()
    .optional()
    .transform((v) => {
      if (typeof v !== 'string' || !/^-?\d+(\.\d+)?$/.test(v.trim())) return null;
      const n = Math.round(Number(v) * scale) / scale;
      return Object.is(n, -0) ? 0 : n;
    });
const int = intOrNull();
const decimal = intOrNull(100);
const textOrNull = z
  .unknown()
  .optional()
  .transform((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null));

const OfpConditions = z.object({
  airport_icao: textOrNull,
  planned_runway: textOrNull,
  planned_weight: int,
  flap_setting: textOrNull,
  wind_direction: int,
  wind_speed: int,
  temperature: int,
  altimeter: decimal,
  surface_condition: textOrNull,
});

const OfpRunway = z.object({
  identifier: textOrNull,
  length_tora: int,
  length_lda: int,
  magnetic_course: int,
  headwind_component: int,
  crosswind_component: int,
  ils_frequency: textOrNull,
  flap_setting: textOrNull,
  thrust_setting: textOrNull,
  flex_temperature: int,
  speeds_v1: int,
  speeds_vr: int,
  speeds_v2: int,
});

const OfpLandingDistance = z.object({ speeds_vref: int, factored_distance: int });

const oneOrMany = <T extends z.ZodType>(item: T) =>
  z.union([z.array(item), item.transform((one) => [one])]);

const OfpTlr = z.object({
  takeoff: z.object({ conditions: OfpConditions, runway: oneOrMany(OfpRunway) }).optional(),
  landing: z
    .object({
      conditions: OfpConditions,
      runway: oneOrMany(OfpRunway),
      distance_dry: OfpLandingDistance.optional(),
      distance_wet: OfpLandingDistance.optional(),
    })
    .optional(),
});

const nint = z.number().int().nullable();

/** What both phases share: where, the conditions SimBrief assumed, and the runway. */
const RunwayPlan = z.object({
  airportIcao: z.string().nullable(),
  runway: z.string().nullable(),
  /** In the OFP's weight unit. */
  plannedWeight: nint,
  windDirDeg: nint,
  windSpeedKt: nint,
  temperatureC: nint,
  altimeterInHg: z.number().nullable(),
  /** "dry", "wet", ... as SimBrief writes it, lower case. */
  surface: z.string().nullable(),
  magneticCourseDeg: nint,
  /** Negative = tailwind. */
  headwindKt: nint,
  /** Always positive; the side is in `crosswindFrom`. */
  crosswindKt: nint,
  crosswindFrom: z.enum(['left', 'right']).nullable(),
  ilsFrequency: z.string().nullable(),
  flaps: z.string().nullable(),
});

export const TakeoffPlan = RunwayPlan.extend({
  /** Takeoff run available. */
  toraFt: nint,
  /** "TO", "FLEX", ... */
  thrust: z.string().nullable(),
  flexTemperatureC: nint,
  v1Kt: nint,
  vrKt: nint,
  v2Kt: nint,
});
export type TakeoffPlan = z.infer<typeof TakeoffPlan>;

export const LandingPlan = RunwayPlan.extend({
  /** Landing distance available. */
  ldaFt: nint,
  vrefKt: nint,
  /** Factored landing distance for the planned surface (wet or dry). */
  landingDistanceFt: nint,
});
export type LandingPlan = z.infer<typeof LandingPlan>;

export const Performance = z.object({
  takeoff: TakeoffPlan.nullable(),
  landing: LandingPlan.nullable(),
});
export type Performance = z.infer<typeof Performance>;

type Conditions = z.output<typeof OfpConditions>;
type Runway = z.output<typeof OfpRunway>;

/** Which side the wind comes from, relative to the runway's magnetic course. */
function crosswindSide(
  windDir: number | null,
  course: number | null,
  crosswind: number | null,
): 'left' | 'right' | null {
  if (windDir === null || course === null || !crosswind) return null;
  const relative = (((windDir - course) % 360) + 360) % 360;
  if (relative === 0 || relative === 180) return null;
  return relative < 180 ? 'right' : 'left';
}

function runwayPlan(conditions: Conditions, runway: Runway | undefined) {
  const course = runway?.magnetic_course ?? null;
  const crosswind = runway?.crosswind_component ?? null;
  return {
    airportIcao: conditions.airport_icao,
    runway: conditions.planned_runway,
    plannedWeight: conditions.planned_weight,
    windDirDeg: conditions.wind_direction,
    windSpeedKt: conditions.wind_speed,
    temperatureC: conditions.temperature,
    altimeterInHg: conditions.altimeter,
    surface: conditions.surface_condition?.toLowerCase() ?? null,
    magneticCourseDeg: course,
    headwindKt: runway?.headwind_component ?? null,
    crosswindKt: crosswind === null ? null : Math.abs(crosswind),
    crosswindFrom: crosswindSide(conditions.wind_direction, course, crosswind),
    ilsFrequency: runway?.ils_frequency ?? null,
  };
}

/** The TLR of a raw OFP (or its `tlr` section) as takeoff and landing plans. */
export function parsePerformance(tlr: unknown): Performance | null {
  const parsed = OfpTlr.safeParse(tlr);
  if (!parsed.success) return null;
  const { takeoff, landing } = parsed.data;
  const planned = (runways: Runway[], conditions: Conditions) =>
    runways.find((r) => r.identifier === conditions.planned_runway);

  const takeoffRunway = takeoff && planned(takeoff.runway, takeoff.conditions);
  const landingRunway = landing && planned(landing.runway, landing.conditions);
  const distance =
    landing?.conditions.surface_condition?.toLowerCase() === 'wet'
      ? landing.distance_wet
      : landing?.distance_dry;

  const result: Performance = {
    takeoff: takeoff
      ? {
          ...runwayPlan(takeoff.conditions, takeoffRunway),
          flaps: takeoffRunway?.flap_setting ?? null,
          toraFt: takeoffRunway?.length_tora ?? null,
          thrust: takeoffRunway?.thrust_setting ?? null,
          flexTemperatureC: takeoffRunway?.flex_temperature ?? null,
          v1Kt: takeoffRunway?.speeds_v1 ?? null,
          vrKt: takeoffRunway?.speeds_vr ?? null,
          v2Kt: takeoffRunway?.speeds_v2 ?? null,
        }
      : null,
    landing: landing
      ? {
          ...runwayPlan(landing.conditions, landingRunway),
          flaps: landing.conditions.flap_setting ?? null,
          ldaFt: landingRunway?.length_lda ?? null,
          vrefKt: distance?.speeds_vref ?? null,
          landingDistanceFt: distance?.factored_distance ?? null,
        }
      : null,
  };
  return result.takeoff || result.landing ? result : null;
}
