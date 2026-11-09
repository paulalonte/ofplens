import type { Airport, FlightPlanSummary } from '@ofplens/ofp';
import { eq } from 'drizzle-orm';
import type { Database } from './client';
import {
  flightPlanFuel,
  flightPlans,
  flightPlanWeights,
  pilots,
  waypoints,
  weatherReports,
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

export interface FlightPlanRepository {
  /**
   * Stores a parsed plan with its fuel, weights, waypoints and OFP weather in one transaction.
   * Idempotent on the SimBrief request id: importing the same plan again changes nothing and
   * returns the existing id, even when two imports race.
   */
  import(input: ImportFlightPlanInput): Promise<ImportFlightPlanResult>;
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
    originUtcOffsetMin: origin.utcOffsetMin,
    destinationIcao: destination.icao,
    destinationIata: destination.iata,
    destinationName: destination.name,
    destinationRunway: destination.runway,
    destinationUtcOffsetMin: destination.utcOffsetMin,
    alternateIcao: alternate?.icao ?? null,
    alternateIata: alternate?.iata ?? null,
    alternateName: alternate?.name ?? null,
    alternateRunway: alternate?.runway ?? null,
    alternateUtcOffsetMin: alternate?.utcOffsetMin ?? null,
    route: route.text,
    cruiseAltitudeFt: route.cruiseAltitudeFt,
    costIndex: route.costIndex,
    routeDistanceNm: route.distanceNm,
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
