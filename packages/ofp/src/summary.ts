import type { WeightUnit } from './schema';

/**
 * Everything OFP Lens shows about one flight plan, in our own shape and naming.
 *
 * - Weights and fuel are integers in the OFP's own unit (`units`); convert only for display.
 * - Timestamps are ISO 8601 UTC strings, so the summary survives JSON and DB round trips unchanged.
 * - Durations and elapsed times are in seconds.
 */
export interface FlightPlanSummary {
  simbriefRequestId: string;
  generatedAt: string;
  airac: string | null;
  units: WeightUnit;
  flight: {
    airlineIcao: string | null;
    flightNumber: string | null;
    callsign: string | null;
  };
  aircraft: {
    icao: string;
    reg: string | null;
    name: string | null;
  };
  origin: Airport;
  destination: Airport;
  alternate: Airport | null;
  route: {
    text: string;
    cruiseAltitudeFt: number;
    costIndex: number | null;
    distanceNm: number;
  };
  /** Planned (SimBrief-computed) gate and runway times. */
  times: {
    out: string;
    off: string;
    on: string;
    in: string;
    blockTimeS: number;
    airTimeS: number;
  };
  fuel: {
    ramp: number;
    taxi: number;
    trip: number;
    contingency: number;
    alternate: number;
    finalReserve: number;
    extra: number;
    landing: number;
  };
  weights: {
    paxCount: number;
    cargo: number;
    payload: number;
    zfw: number;
    tow: number;
    ldw: number;
  };
  waypoints: Waypoint[];
}

export interface Airport {
  icao: string;
  iata: string | null;
  name: string;
  runway: string | null;
  /** The airport's UTC offset in minutes at the time of the flight, from the OFP. */
  utcOffsetMin: number;
  /** METAR and TAF as printed in the OFP at dispatch. */
  metar: string | null;
  taf: string | null;
}

export interface Waypoint {
  /** 0-based position in the navlog. */
  seq: number;
  ident: string;
  name: string | null;
  /** SimBrief fix type: apt, wpt, vor, ndb, ltlg (TOC/TOD are ltlg with ident TOC/TOD), ... */
  type: string;
  /** CLB, CRZ or DSC. */
  stage: string | null;
  /** Airway, procedure or DCT used to reach this fix. */
  via: string | null;
  lat: number;
  lon: number;
  altitudeFt: number;
  windDirDeg: number;
  windSpeedKt: number;
  oatC: number;
  /** Cumulative time from takeoff. */
  elapsedS: number;
  fuelOnBoard: number;
}
