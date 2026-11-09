import { z } from 'zod';
import { OfpSchema, type Ofp } from './schema';
import type { Airport, FlightPlanSummary } from './summary';

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

function toAirport(a: Ofp['origin']): Airport {
  return {
    icao: a.icao_code,
    iata: a.iata_code,
    name: a.name,
    runway: a.plan_rwy,
    utcOffsetMin: a.timezone,
    metar: a.metar,
    taf: a.taf,
  };
}
