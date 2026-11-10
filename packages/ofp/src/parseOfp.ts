import { z } from 'zod';
import { OfpSchema, type Ofp } from './schema';
import type { Airport, FlightPlanSummary, StepClimb } from './summary';

/** Thrown when input is not a usable SimBrief OFP. `issues` lists every failing field. */
export class OfpParseError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(message);
    this.name = 'OfpParseError';
  }
}

const FetchStatus = z.object({ fetch: z.object({ status: z.string() }) });

/**
 * Validates a raw SimBrief OFP (JSON v2, already JSON-parsed) and maps it to a FlightPlanSummary.
 * Pure and deterministic: no I/O, no clock. Keep the raw object yourself if you need it stored.
 */
export function parseOfp(raw: unknown): FlightPlanSummary {
  // SimBrief reports fetch errors in-band, e.g. { fetch: { status: "Error: Unknown UserID" } }.
  const fetchStatus = FetchStatus.safeParse(raw);
  if (fetchStatus.success && fetchStatus.data.fetch.status !== 'Success') {
    throw new OfpParseError(`SimBrief returned an error: ${fetchStatus.data.fetch.status}`);
  }

  const result = OfpSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new OfpParseError(
      `Not a valid SimBrief OFP (${issues.length} problem${issues.length === 1 ? '' : 's'}): ` +
        issues.slice(0, 5).join('; ') +
        (issues.length > 5 ? '; …' : ''),
      issues,
    );
  }

  return toSummary(result.data);
}

function toSummary(ofp: Ofp): FlightPlanSummary {
  const { params, general, atc, aircraft, times, fuel, weights } = ofp;
  const alternate = ofp.alternate[0];

  return {
    simbriefRequestId: params.request_id,
    generatedAt: params.time_generated,
    airac: params.airac,
    units: params.units,
    flight: {
      airlineIcao: general.icao_airline,
      flightNumber: general.flight_number,
      callsign: atc.callsign,
    },
    aircraft: { icao: aircraft.icaocode, reg: aircraft.reg, name: aircraft.name },
    origin: toAirport(ofp.origin),
    destination: toAirport(ofp.destination),
    alternate: alternate ? toAirport(alternate) : null,
    route: {
      text: general.route,
      cruiseAltitudeFt: general.initial_altitude,
      costIndex: general.costindex,
      distanceNm: general.route_distance,
      gcDistanceNm: general.gc_distance,
      stepClimbs: parseStepClimbs(general.stepclimb_string),
      // `+ 0` turns SimBrief's "-0" into 0.
      avgIsaDevC: general.avg_temp_dev === null ? null : general.avg_temp_dev + 0,
      avgTropopauseFt: general.avg_tropopause,
      avgWindComponentKt: general.avg_wind_comp === null ? null : general.avg_wind_comp + 0,
    },
    times: {
      out: times.est_out,
      off: times.est_off,
      on: times.est_on,
      in: times.est_in,
      blockTimeS: times.est_block,
      airTimeS: times.est_time_enroute,
    },
    fuel: {
      ramp: fuel.plan_ramp,
      taxi: fuel.taxi,
      trip: fuel.enroute_burn,
      contingency: fuel.contingency,
      alternate: fuel.alternate_burn,
      finalReserve: fuel.reserve,
      extra: fuel.extra,
      landing: fuel.plan_landing,
    },
    weights: {
      paxCount: weights.pax_count,
      cargo: weights.cargo,
      payload: weights.payload,
      zfw: weights.est_zfw,
      tow: weights.est_tow,
      ldw: weights.est_ldw,
    },
    waypoints: ofp.navlog.map((fix, seq) => ({
      seq,
      ident: fix.ident,
      name: fix.name,
      type: fix.type,
      stage: fix.stage,
      via: fix.via_airway,
      lat: fix.pos_lat,
      lon: fix.pos_long,
      altitudeFt: fix.altitude_feet,
      windDirDeg: fix.wind_dir,
      windSpeedKt: fix.wind_spd,
      oatC: fix.oat,
      elapsedS: fix.time_total,
      fuelOnBoard: fix.fuel_plan_onboard,
    })),
  };
}

/**
 * "KSFO/0350/DBQ/0370" -> [{ at: 'DBQ', altitudeFt: 37000 }]. The first pair is the initial
 * cruise altitude at the origin, so it is left out. Malformed pairs are skipped.
 */
export function parseStepClimbs(stepClimbString: string | null): StepClimb[] {
  if (!stepClimbString) return [];
  const parts = stepClimbString.split('/');
  const steps: StepClimb[] = [];
  for (let i = 2; i + 1 < parts.length; i += 2) {
    const at = parts[i]!.trim();
    const level = parts[i + 1]!.trim();
    if (at && /^\d{3,4}$/.test(level)) steps.push({ at, altitudeFt: Number(level) * 100 });
  }
  return steps;
}

function toAirport(a: Ofp['origin']): Airport {
  return {
    icao: a.icao_code,
    iata: a.iata_code,
    name: a.name,
    runway: a.plan_rwy,
    elevationFt: a.elevation,
    utcOffsetMin: a.timezone,
    metar: a.metar,
    taf: a.taf,
  };
}
