import { addSeconds } from '@ofplens/ofp';
import { z } from 'zod';
import { STATION_ROLE } from '../reports';
import { defineTool, ToolError } from './tool';

const PlanInput = z.object({ flightPlanId: z.uuid() });

/**
 * The plan's shape without fuel, weights or block time: the briefing is about weather, and
 * numbers the model never sees are numbers it cannot misstate.
 */
export const getFlightPlan = defineTool({
  name: 'get_flight_plan',
  description:
    'The flight plan: callsign, aircraft, the departure, destination and alternate airports, ' +
    'planned gate and runway times (UTC), route, cruise level, and every waypoint with its ' +
    'planned altitude and ETA (UTC). Call this first.',
  input: PlanInput,
  output: z.object({
    flightPlanId: z.string(),
    callsign: z.string().nullable(),
    aircraft: z.object({ icao: z.string(), name: z.string().nullable() }),
    generatedAt: z.string(),
    airports: z.array(
      z.object({
        role: STATION_ROLE,
        icao: z.string(),
        name: z.string(),
        runway: z.string().nullable(),
        utcOffsetMin: z.number(),
      }),
    ),
    times: z.object({ out: z.string(), off: z.string(), on: z.string(), in: z.string() }),
    route: z.object({ text: z.string(), cruiseFlightLevel: z.number(), distanceNm: z.number() }),
    waypoints: z.array(
      z.object({
        seq: z.number(),
        ident: z.string(),
        name: z.string().nullable(),
        stage: z.string().nullable(),
        altitudeFt: z.number(),
        eta: z.string(),
      }),
    ),
  }),
  async run({ flightPlanId }, { flightPlans }) {
    const stored = await flightPlans.get(flightPlanId);
    if (!stored) throw new ToolError(`No flight plan with id ${flightPlanId}`);
    const { plan } = stored;

    const airport = (role: 'origin' | 'destination' | 'alternate', a: typeof plan.origin) => ({
      role,
      icao: a.icao,
      name: a.name,
      runway: a.runway,
      utcOffsetMin: a.utcOffsetMin,
    });

    return {
      flightPlanId,
      callsign: plan.flight.callsign,
      aircraft: { icao: plan.aircraft.icao, name: plan.aircraft.name },
      generatedAt: plan.generatedAt,
      airports: [
        airport('origin', plan.origin),
        airport('destination', plan.destination),
        ...(plan.alternate ? [airport('alternate', plan.alternate)] : []),
      ],
      times: { out: plan.times.out, off: plan.times.off, on: plan.times.on, in: plan.times.in },
      route: {
        text: plan.route.text,
        cruiseFlightLevel: Math.round(plan.route.cruiseAltitudeFt / 100),
        distanceNm: plan.route.distanceNm,
      },
      waypoints: plan.waypoints.map((w) => ({
        seq: w.seq,
        ident: w.ident,
        name: w.name,
        stage: w.stage,
        altitudeFt: w.altitudeFt,
        eta: addSeconds(plan.times.off, w.elapsedS),
      })),
    };
  },
});
