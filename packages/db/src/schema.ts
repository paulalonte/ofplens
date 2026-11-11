import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle table definitions. `pnpm db:generate` turns changes here into SQL migrations in
 * packages/db/migrations; review the SQL before committing it.
 */

/** The pilot using the app. Single row until multi-user support (see PLAN.md non-goals). */
export const pilots = pgTable(
  'pilots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    simbriefUsername: text('simbrief_username').notNull().unique(),
    /** SimBrief's numeric Pilot ID, learned from the first imported OFP (params.user_id). */
    simbriefPilotId: text('simbrief_pilot_id'),
    weightUnit: text('weight_unit', { enum: ['kgs', 'lbs'] })
      .notNull()
      .default('kgs'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [check('pilots_weight_unit_check', sql`${t.weightUnit} in ('kgs', 'lbs')`)],
);

export type PilotRow = typeof pilots.$inferSelect;

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * One row per imported SimBrief OFP. Holds every field of FlightPlanSummary that is not a list,
 * so a plan read back from the DB equals the parsed one. Weights and fuel live in the plan's own
 * `units`; times are UTC. `raw_ofp` keeps the full OFP so plans can be re-parsed later.
 */
export const flightPlans = pgTable(
  'flight_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pilotId: uuid('pilot_id')
      .notNull()
      .references(() => pilots.id, { onDelete: 'cascade' }),
    /** SimBrief's params.request_id: the idempotent import key. */
    simbriefRequestId: text('simbrief_request_id').notNull().unique(),
    generatedAt: timestamptz('generated_at').notNull(),
    airac: text('airac'),
    units: text('units', { enum: ['kgs', 'lbs'] }).notNull(),

    airlineIcao: text('airline_icao'),
    flightNumber: text('flight_number'),
    callsign: text('callsign'),
    aircraftIcao: text('aircraft_icao').notNull(),
    aircraftReg: text('aircraft_reg'),
    aircraftName: text('aircraft_name'),

    originIcao: char('origin_icao', { length: 4 }).notNull(),
    originIata: text('origin_iata'),
    originName: text('origin_name').notNull(),
    originRunway: text('origin_runway'),
    originElevationFt: integer('origin_elevation_ft'),
    originUtcOffsetMin: integer('origin_utc_offset_min').notNull(),

    destinationIcao: char('destination_icao', { length: 4 }).notNull(),
    destinationIata: text('destination_iata'),
    destinationName: text('destination_name').notNull(),
    destinationRunway: text('destination_runway'),
    destinationElevationFt: integer('destination_elevation_ft'),
    destinationUtcOffsetMin: integer('destination_utc_offset_min').notNull(),

    /** All alternate_* columns are null together when the plan has no alternate. */
    alternateIcao: char('alternate_icao', { length: 4 }),
    alternateIata: text('alternate_iata'),
    alternateName: text('alternate_name'),
    alternateRunway: text('alternate_runway'),
    alternateElevationFt: integer('alternate_elevation_ft'),
    alternateUtcOffsetMin: integer('alternate_utc_offset_min'),

    route: text('route').notNull(),
    cruiseAltitudeFt: integer('cruise_altitude_ft').notNull(),
    costIndex: integer('cost_index'),
    routeDistanceNm: integer('route_distance_nm').notNull(),
    gcDistanceNm: integer('gc_distance_nm'),
    /** Step climbs after the initial cruise altitude: [{ at, altitudeFt }]. */
    stepClimbs: jsonb('step_climbs')
      .$type<{ at: string; altitudeFt: number }[]>()
      .notNull()
      .default([]),
    avgIsaDevC: integer('avg_isa_dev_c'),
    avgTropopauseFt: integer('avg_tropopause_ft'),
    /** Positive = tailwind. */
    avgWindComponentKt: integer('avg_wind_component_kt'),

    /** SimBrief's computed (est_*) gate and runway times, not the entered schedule. */
    estOut: timestamptz('est_out').notNull(),
    estOff: timestamptz('est_off').notNull(),
    estOn: timestamptz('est_on').notNull(),
    estIn: timestamptz('est_in').notNull(),
    blockTimeS: integer('block_time_s').notNull(),
    airTimeS: integer('air_time_s').notNull(),

    rawOfp: jsonb('raw_ofp').notNull(),
    importedAt: timestamptz('imported_at').notNull().defaultNow(),
    /** Last successful live weather refresh (phase 4), even when no report was new. */
    liveWeatherCheckedAt: timestamptz('live_weather_checked_at'),
    /** Last successful hazard check (phase 6); null = never checked. */
    hazardsCheckedAt: timestamptz('hazards_checked_at'),
    /** The takeoff time that check worked out ETAs from. */
    hazardsTakeoffAt: timestamptz('hazards_takeoff_at'),
    /** Feeds that could not be read at that check (isigmet, airsigmet, gairmet). */
    hazardsUnavailable: text('hazards_unavailable')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** How many advisories that check compared with the route. */
    hazardsAdvisoriesChecked: integer('hazards_advisories_checked').notNull().default(0),
  },
  (t) => [
    check('flight_plans_units_check', sql`${t.units} in ('kgs', 'lbs')`),
    check(
      'flight_plans_alternate_complete_check',
      sql`(${t.alternateIcao} is null) = (${t.alternateName} is null) and (${t.alternateIcao} is null) = (${t.alternateUtcOffsetMin} is null)`,
    ),
    // History: newest first per pilot, with id as the cursor tie-breaker.
    index('flight_plans_pilot_generated_idx').on(t.pilotId, t.generatedAt.desc(), t.id.desc()),
    index('flight_plans_route_idx').on(t.originIcao, t.destinationIcao),
  ],
);

export const flightPlanFuel = pgTable('flight_plan_fuel', {
  flightPlanId: uuid('flight_plan_id')
    .primaryKey()
    .references(() => flightPlans.id, { onDelete: 'cascade' }),
  ramp: integer('ramp').notNull(),
  taxi: integer('taxi').notNull(),
  trip: integer('trip').notNull(),
  contingency: integer('contingency').notNull(),
  alternate: integer('alternate').notNull(),
  finalReserve: integer('final_reserve').notNull(),
  extra: integer('extra').notNull(),
  /** Planned fuel at landing. */
  landing: integer('landing').notNull(),
});

export const flightPlanWeights = pgTable('flight_plan_weights', {
  flightPlanId: uuid('flight_plan_id')
    .primaryKey()
    .references(() => flightPlans.id, { onDelete: 'cascade' }),
  paxCount: integer('pax_count').notNull(),
  cargo: integer('cargo').notNull(),
  payload: integer('payload').notNull(),
  zfw: integer('zfw').notNull(),
  tow: integer('tow').notNull(),
  ldw: integer('ldw').notNull(),
});

export const waypoints = pgTable(
  'waypoints',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    flightPlanId: uuid('flight_plan_id')
      .notNull()
      .references(() => flightPlans.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    ident: text('ident').notNull(),
    name: text('name'),
    /** wpt, vor, ndb, apt, ltlg (TOC/TOD are ltlg) ... */
    type: text('type').notNull(),
    /** CLB, CRZ, DSC */
    stage: text('stage'),
    via: text('via'),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    altitudeFt: integer('altitude_ft').notNull(),
    windDirDeg: integer('wind_dir_deg').notNull(),
    windSpeedKt: integer('wind_speed_kt').notNull(),
    oatC: integer('oat_c').notNull(),
    /** Cumulative time from takeoff. */
    elapsedS: integer('elapsed_s').notNull(),
    fuelOnBoard: integer('fuel_on_board').notNull(),
  },
  (t) => [unique('waypoints_plan_seq_unique').on(t.flightPlanId, t.seq)],
);

/** METAR/TAF snapshots: from the OFP at import (source 'ofp'), later fetched live (phase 4). */
export const weatherReports = pgTable(
  'weather_reports',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    flightPlanId: uuid('flight_plan_id')
      .notNull()
      .references(() => flightPlans.id, { onDelete: 'cascade' }),
    stationIcao: char('station_icao', { length: 4 }).notNull(),
    role: text('role', { enum: ['origin', 'destination', 'alternate', 'enroute'] }).notNull(),
    kind: text('kind', { enum: ['metar', 'taf'] }).notNull(),
    source: text('source', { enum: ['ofp', 'live'] }).notNull(),
    rawText: text('raw_text').notNull(),
    /** VFR, MVFR, IFR, LIFR (phase 4). */
    flightCategory: text('flight_category'),
    /** Decoded wind, visibility, ceiling, weather (phase 4). */
    parsed: jsonb('parsed'),
    observedAt: timestamptz('observed_at'),
    fetchedAt: timestamptz('fetched_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'weather_reports_role_check',
      sql`${t.role} in ('origin', 'destination', 'alternate', 'enroute')`,
    ),
    check('weather_reports_kind_check', sql`${t.kind} in ('metar', 'taf')`),
    check('weather_reports_source_check', sql`${t.source} in ('ofp', 'live')`),
    index('weather_reports_plan_idx').on(t.flightPlanId, t.stationIcao, t.fetchedAt.desc()),
    // A live report is stored once per plan: refreshing again does not duplicate it.
    uniqueIndex('weather_reports_live_unique')
      .on(t.flightPlanId, t.stationIcao, t.role, t.kind, t.observedAt)
      .where(sql`${t.source} = 'live'`),
  ],
);

export type FlightPlanRow = typeof flightPlans.$inferSelect;
export type NewFlightPlanRow = typeof flightPlans.$inferInsert;

/**
 * AI briefings (phase 5). One row per run: `pending` while the agent works, then `done` with the
 * validated output or `failed` with the reason. Model, prompt version, tokens, cost and the tool
 * calls are kept so runs can be compared and replayed (phase 7).
 */
export const briefings = pgTable(
  'briefings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flightPlanId: uuid('flight_plan_id')
      .notNull()
      .references(() => flightPlans.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'done', 'failed'] }).notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    /** The validated Briefing (done only). */
    output: jsonb('output'),
    /** Every tool call with its output or error. */
    toolCalls: jsonb('tool_calls'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: doublePrecision('cost_usd'),
    latencyMs: integer('latency_ms'),
    error: text('error'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
  },
  (t) => [
    check('briefings_status_check', sql`${t.status} in ('pending', 'done', 'failed')`),
    index('briefings_plan_idx').on(t.flightPlanId, t.createdAt.desc()),
    // The daily limit counts briefings across all plans by creation time.
    index('briefings_created_idx').on(t.createdAt),
    // One running briefing per plan at a time.
    uniqueIndex('briefings_one_pending_per_plan')
      .on(t.flightPlanId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export type BriefingRow = typeof briefings.$inferSelect;

/**
 * SIGMETs, AIRMETs and G-AIRMETs that touch the plan's route (phase 6), as found by the last
 * hazard check; each check replaces them. One row per advisory, with the stretches of the
 * route (fix to fix) where it applies.
 */
export const advisories = pgTable(
  'advisories',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    flightPlanId: uuid('flight_plan_id')
      .notNull()
      .references(() => flightPlans.id, { onDelete: 'cascade' }),
    /** Our stable id for the advisory, e.g. "isigmet:RPHI:3:1794384000". */
    advisoryId: text('advisory_id').notNull(),
    source: text('source', { enum: ['isigmet', 'airsigmet', 'gairmet'] }).notNull(),
    /** thunderstorm, turbulence, icing, ... */
    hazard: text('hazard').notNull(),
    /** The feed's own code: TS, CONVECTIVE, TURB-HI, ... */
    code: text('code').notNull(),
    severity: text('severity', { enum: ['moderate', 'severe'] }),
    detail: text('detail'),
    validFrom: timestamptz('valid_from').notNull(),
    validTo: timestamptz('valid_to').notNull(),
    baseFt: integer('base_ft'),
    topFt: integer('top_ft'),
    /** [lon, lat] rings. */
    polygons: jsonb('polygons').$type<[number, number][][]>().notNull(),
    /** [{ fromSeq, toSeq, fromIdent, toIdent }], in route order. */
    segments: jsonb('segments')
      .$type<{ fromSeq: number; toSeq: number; fromIdent: string; toIdent: string }[]>()
      .notNull(),
    /** First affected fix, for ordering. */
    firstWaypointSeq: integer('first_waypoint_seq').notNull(),
    fir: text('fir'),
    firName: text('fir_name'),
    rawText: text('raw_text'),
  },
  (t) => [
    unique('advisories_plan_advisory_unique').on(t.flightPlanId, t.advisoryId),
    index('advisories_plan_idx').on(t.flightPlanId, t.firstWaypointSeq),
  ],
);
