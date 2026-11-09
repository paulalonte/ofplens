import { parseOfp, type FlightPlanListItem, type FlightPlanSummary } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';

/** A captured fixture, parsed exactly as the app would parse it. */
export function fixturePlan(name: string): FlightPlanSummary {
  return parseOfp(loadFixture(name));
}

/** The history-list row the API would return for a fixture stored under `id`. */
export function fixtureListItem(name: string, id: string): FlightPlanListItem {
  const plan = fixturePlan(name);
  return {
    id,
    simbriefRequestId: plan.simbriefRequestId,
    generatedAt: plan.generatedAt,
    importedAt: '2026-11-09T21:00:00Z',
    callsign: plan.flight.callsign,
    aircraftIcao: plan.aircraft.icao,
    originIcao: plan.origin.icao,
    destinationIcao: plan.destination.icao,
    alternateIcao: plan.alternate?.icao ?? null,
    out: plan.times.out,
    blockTimeS: plan.times.blockTimeS,
    units: plan.units,
  };
}

export const PLAN_IDS = {
  kgs: '11111111-1111-4111-8111-111111111111',
  lbs: '22222222-2222-4222-8222-222222222222',
  noalt: '33333333-3333-4333-8333-333333333333',
} as const;
