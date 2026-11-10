import {
  parsePerformance,
  type Airport,
  type FlightPlanListItem,
  type FlightPlanSummary,
} from '@ofplens/ofp';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Database } from './client';
import {
  flightPlanFuel,
  flightPlans,
  flightPlanWeights,
  pilots,
  waypoints,
  weatherReports,
  type FlightPlanRow,
  type NewFlightPlanRow,
} from './schema';

export interface ImportFlightPlanInput {
  /** The pilot the plan belongs to; must already exist (saved in Settings). */
  simbriefUsername: string;
  plan: FlightPlanSummary;
  /** The full OFP as fetched, kept in raw_ofp so plans can be re-parsed later. */
  rawOfp: unknown;
}

export interface ImportFlightPlanResult {
  id: string;
  /** false when this SimBrief request was already imported; nothing was written. */
  created: boolean;
}

export class PilotNotFoundError extends Error {
  constructor(username: string) {
    super(`No pilot with SimBrief username "${username}"`);
    this.name = 'PilotNotFoundError';
  }
}

export class InvalidCursorError extends Error {
  constructor() {
    super('That page cursor is not valid. Start again from the first page.');
    this.name = 'InvalidCursorError';
  }
}

export interface ListFlightPlansInput {
  /** Whose history; an unknown username simply has no plans. */
  simbriefUsername: string;
  limit: number;
  /** `nextCursor` from the previous page; omit for the first page. */
  cursor?: string | undefined;
}

export interface FlightPlanPage {
  items: FlightPlanListItem[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

export interface StoredFlightPlan {
  id: string;
  importedAt: string;
  plan: FlightPlanSummary;
}

export interface FlightPlanRepository {
  /**
   * Stores a parsed plan with its fuel, weights, waypoints and OFP weather in one transaction.
   * Idempotent on the SimBrief request id: importing the same plan again changes nothing and
   * returns the existing id, even when two imports race.
   */
  import(input: ImportFlightPlanInput): Promise<ImportFlightPlanResult>;
  /** Newest SimBrief plan first (by generation time, then id), one page at a time. */
  list(input: ListFlightPlansInput): Promise<FlightPlanPage>;
  /** The stored plan rebuilt as the same FlightPlanSummary parseOfp produced, or null. */
  get(id: string): Promise<StoredFlightPlan | null>;
  /** Deletes the plan and everything under it. false when there was no such plan. */
  delete(id: string): Promise<boolean>;
}

export function createFlightPlanRepository(db: Database): FlightPlanRepository {
  return {
    import: ({ simbriefUsername, plan, rawOfp }) =>
      db.transaction(async (tx) => {
        const [pilot] = await tx
          .select({ id: pilots.id })
          .from(pilots)
          .where(eq(pilots.simbriefUsername, simbriefUsername));
        if (!pilot) throw new PilotNotFoundError(simbriefUsername);

        // ON CONFLICT DO NOTHING: a concurrent import of the same request waits for the other
        // transaction, then inserts nothing instead of failing.
        const [inserted] = await tx
          .insert(flightPlans)
          .values(toPlanRow(pilot.id, plan, rawOfp))
          .onConflictDoNothing({ target: flightPlans.simbriefRequestId })
          .returning({ id: flightPlans.id });

        if (!inserted) {
          const [existing] = await tx
            .select({ id: flightPlans.id })
            .from(flightPlans)
            .where(eq(flightPlans.simbriefRequestId, plan.simbriefRequestId));
          if (!existing) throw new Error('Import conflicted but the existing plan was not found');
          return { id: existing.id, created: false };
        }

        const flightPlanId = inserted.id;
        await tx.insert(flightPlanFuel).values({ flightPlanId, ...plan.fuel });
        await tx.insert(flightPlanWeights).values({ flightPlanId, ...plan.weights });
        await tx.insert(waypoints).values(plan.waypoints.map((w) => ({ flightPlanId, ...w })));

        const reports = ofpWeather(flightPlanId, plan);
        if (reports.length > 0) await tx.insert(weatherReports).values(reports);

        return { id: flightPlanId, created: true };
      }),

    async list({ simbriefUsername, limit, cursor }) {
      const after = cursor === undefined ? undefined : decodeCursor(cursor);
      const rows = await db
        .select({
          id: flightPlans.id,
          simbriefRequestId: flightPlans.simbriefRequestId,
          generatedAt: flightPlans.generatedAt,
          importedAt: flightPlans.importedAt,
          callsign: flightPlans.callsign,
          aircraftIcao: flightPlans.aircraftIcao,
          originIcao: flightPlans.originIcao,
          destinationIcao: flightPlans.destinationIcao,
          alternateIcao: flightPlans.alternateIcao,
          estOut: flightPlans.estOut,
          blockTimeS: flightPlans.blockTimeS,
          units: flightPlans.units,
        })
        .from(flightPlans)
        .innerJoin(pilots, eq(pilots.id, flightPlans.pilotId))
        .where(
          and(
            eq(pilots.simbriefUsername, simbriefUsername),
            // Keyset pagination: strictly after the last row of the previous page.
            after &&
              sql`(${flightPlans.generatedAt}, ${flightPlans.id}) < (${after.generatedAt}::timestamptz, ${after.id}::uuid)`,
          ),
        )
        .orderBy(desc(flightPlans.generatedAt), desc(flightPlans.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(({ estOut, generatedAt, importedAt, ...row }) => ({
          ...row,
          generatedAt: toIso(generatedAt),
          importedAt: toIso(importedAt),
          out: toIso(estOut),
        })),
        nextCursor: rows.length > limit && last ? encodeCursor(last.generatedAt, last.id) : null,
      };
    },

    async get(id) {
      const [row] = await db
        .select({ plan: flightPlans, fuel: flightPlanFuel, weights: flightPlanWeights })
        .from(flightPlans)
        .innerJoin(flightPlanFuel, eq(flightPlanFuel.flightPlanId, flightPlans.id))
        .innerJoin(flightPlanWeights, eq(flightPlanWeights.flightPlanId, flightPlans.id))
        .where(eq(flightPlans.id, id));
      if (!row) return null;

      const [fixes, reports] = await Promise.all([
        db
          .select()
          .from(waypoints)
          .where(eq(waypoints.flightPlanId, id))
          .orderBy(asc(waypoints.seq)),
        db
          .select()
          .from(weatherReports)
          .where(and(eq(weatherReports.flightPlanId, id), eq(weatherReports.source, 'ofp'))),
      ]);

      return {
        id,
        importedAt: toIso(row.plan.importedAt),
        plan: toSummary(row.plan, row.fuel, row.weights, fixes, reports),
      };
    },

    async delete(id) {
      const deleted = await db
        .delete(flightPlans)
        .where(eq(flightPlans.id, id))
        .returning({ id: flightPlans.id });
      return deleted.length > 0;
    },
  };
}

/** Timestamps leave the DB as ISO strings without milliseconds, matching parseOfp's output. */
function toIso(date: Date): string {
  return date.toISOString().replace(/\.000Z$/, 'Z');
}

/** Opaque page cursor: base64url of "<generatedAt ISO>|<id>" of the page's last row. */
function encodeCursor(generatedAt: Date, id: string): string {
  return Buffer.from(`${generatedAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { generatedAt: string; id: string } {
  const [iso, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const generatedAt = new Date(iso ?? '');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (rest.length > 0 || !id || !uuid.test(id) || Number.isNaN(generatedAt.getTime())) {
    throw new InvalidCursorError();
  }
  // As an ISO string: raw SQL parameters go to the driver unconverted.
  return { generatedAt: generatedAt.toISOString(), id };
}

type FuelRow = typeof flightPlanFuel.$inferSelect;
type WeightsRow = typeof flightPlanWeights.$inferSelect;
type WaypointRow = typeof waypoints.$inferSelect;
type WeatherRow = typeof weatherReports.$inferSelect;

/** The inverse of toPlanRow + child inserts: rebuilds exactly what parseOfp returned. */
function toSummary(
  p: FlightPlanRow,
  fuel: FuelRow,
  weights: WeightsRow,
  fixes: WaypointRow[],
  reports: WeatherRow[],
): FlightPlanSummary {
  const report = (role: WeatherRow['role'], kind: WeatherRow['kind']) =>
    reports.find((r) => r.role === role && r.kind === kind)?.rawText ?? null;

  const airport = (
    role: 'origin' | 'destination' | 'alternate',
    icao: string,
    iata: string | null,
    name: string,
    runway: string | null,
    elevationFt: number | null,
    utcOffsetMin: number,
  ): Airport => ({
    icao,
    iata,
    name,
    runway,
    elevationFt,
    utcOffsetMin,
    metar: report(role, 'metar'),
    taf: report(role, 'taf'),
  });

  const { flightPlanId: _fuelPlanId, ...fuelValues } = fuel;
  const { flightPlanId: _weightsPlanId, ...weightValues } = weights;

  return {
    simbriefRequestId: p.simbriefRequestId,
    generatedAt: toIso(p.generatedAt),
    airac: p.airac,
    units: p.units,
    flight: { airlineIcao: p.airlineIcao, flightNumber: p.flightNumber, callsign: p.callsign },
    aircraft: { icao: p.aircraftIcao, reg: p.aircraftReg, name: p.aircraftName },
    origin: airport(
      'origin',
      p.originIcao,
      p.originIata,
      p.originName,
      p.originRunway,
      p.originElevationFt,
      p.originUtcOffsetMin,
    ),
    destination: airport(
      'destination',
      p.destinationIcao,
      p.destinationIata,
      p.destinationName,
      p.destinationRunway,
      p.destinationElevationFt,
      p.destinationUtcOffsetMin,
    ),
    alternate:
      p.alternateIcao !== null && p.alternateName !== null && p.alternateUtcOffsetMin !== null
        ? airport(
            'alternate',
            p.alternateIcao,
            p.alternateIata,
            p.alternateName,
            p.alternateRunway,
            p.alternateElevationFt,
            p.alternateUtcOffsetMin,
          )
        : null,
    route: {
      text: p.route,
      cruiseAltitudeFt: p.cruiseAltitudeFt,
      costIndex: p.costIndex,
      distanceNm: p.routeDistanceNm,
      gcDistanceNm: p.gcDistanceNm,
      stepClimbs: p.stepClimbs,
      avgIsaDevC: p.avgIsaDevC,
      avgTropopauseFt: p.avgTropopauseFt,
      avgWindComponentKt: p.avgWindComponentKt,
    },
    times: {
      out: toIso(p.estOut),
      off: toIso(p.estOff),
      on: toIso(p.estOn),
      in: toIso(p.estIn),
      blockTimeS: p.blockTimeS,
      airTimeS: p.airTimeS,
    },
    fuel: fuelValues,
    weights: weightValues,
    waypoints: fixes.map(({ id: _id, flightPlanId: _plan, ...w }) => w),
    // Read from the stored raw OFP, so plans saved before this field existed have it too.
    performance: parsePerformance((p.rawOfp as { tlr?: unknown } | null)?.tlr),
  };
}

function toPlanRow(pilotId: string, plan: FlightPlanSummary, rawOfp: unknown): NewFlightPlanRow {
  const { flight, aircraft, origin, destination, alternate, route, times } = plan;
  return {
    pilotId,
    simbriefRequestId: plan.simbriefRequestId,
    generatedAt: new Date(plan.generatedAt),
    airac: plan.airac,
    units: plan.units,
    airlineIcao: flight.airlineIcao,
    flightNumber: flight.flightNumber,
    callsign: flight.callsign,
    aircraftIcao: aircraft.icao,
    aircraftReg: aircraft.reg,
    aircraftName: aircraft.name,
    originIcao: origin.icao,
    originIata: origin.iata,
    originName: origin.name,
    originRunway: origin.runway,
    originElevationFt: origin.elevationFt,
    originUtcOffsetMin: origin.utcOffsetMin,
    destinationIcao: destination.icao,
    destinationIata: destination.iata,
    destinationName: destination.name,
    destinationRunway: destination.runway,
    destinationElevationFt: destination.elevationFt,
    destinationUtcOffsetMin: destination.utcOffsetMin,
    alternateIcao: alternate?.icao ?? null,
    alternateIata: alternate?.iata ?? null,
    alternateName: alternate?.name ?? null,
    alternateRunway: alternate?.runway ?? null,
    alternateElevationFt: alternate?.elevationFt ?? null,
    alternateUtcOffsetMin: alternate?.utcOffsetMin ?? null,
    route: route.text,
    cruiseAltitudeFt: route.cruiseAltitudeFt,
    costIndex: route.costIndex,
    routeDistanceNm: route.distanceNm,
    gcDistanceNm: route.gcDistanceNm,
    stepClimbs: route.stepClimbs,
    avgIsaDevC: route.avgIsaDevC,
    avgTropopauseFt: route.avgTropopauseFt,
    avgWindComponentKt: route.avgWindComponentKt,
    estOut: new Date(times.out),
    estOff: new Date(times.off),
    estOn: new Date(times.on),
    estIn: new Date(times.in),
    blockTimeS: times.blockTimeS,
    airTimeS: times.airTimeS,
    rawOfp,
  };
}

/** One row per METAR/TAF printed in the OFP. Missing reports get no row. */
function ofpWeather(flightPlanId: string, plan: FlightPlanSummary) {
  const stations: ['origin' | 'destination' | 'alternate', Airport | null][] = [
    ['origin', plan.origin],
    ['destination', plan.destination],
    ['alternate', plan.alternate],
  ];
  return stations.flatMap(([role, airport]) =>
    airport
      ? (['metar', 'taf'] as const).flatMap((kind) => {
          const rawText = airport[kind];
          return rawText
            ? [
                {
                  flightPlanId,
                  stationIcao: airport.icao,
                  role,
                  kind,
                  source: 'ofp' as const,
                  rawText,
                },
              ]
            : [];
        })
      : [],
  );
}
