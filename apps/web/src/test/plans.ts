import {
  parseOfp,
  type Airport,
  type FlightPlanListItem,
  type FlightPlanSummary,
} from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { compareStation, type FlightPlanWeatherResponse, type StationRole } from '@ofplens/weather';
import { loadWeatherFixture } from '@ofplens/weather/testing';

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

/**
 * GET /api/flight-plans/:id/weather as the API would answer for a fixture plan: the OFP's
 * METAR/TAF at dispatch, and (unless `live` is false) the captured aviationweather.gov reports
 * as "now", compared by the real compareStation().
 */
export function fixtureWeather(
  name: string,
  {
    live = true,
    liveCheckedAt = new Date().toISOString(),
  }: { live?: boolean; liveCheckedAt?: string } = {},
): FlightPlanWeatherResponse {
  const plan = fixturePlan(name);
  const metars = loadWeatherFixture('metar') as {
    icaoId: string;
    rawOb: string;
    reportTime: string;
  }[];
  const tafs = loadWeatherFixture('taf') as { icaoId: string; rawTAF: string; issueTime: string }[];
  const airports: [StationRole, Airport | null][] = [
    ['origin', plan.origin],
    ['destination', plan.destination],
    ['alternate', plan.alternate],
  ];

  return {
    liveCheckedAt: live ? liveCheckedAt : null,
    stations: airports.flatMap(([role, airport]) => {
      if (!airport) return [];
      const metar = live ? metars.find((m) => m.icaoId === airport.icao) : undefined;
      const taf = live ? tafs.find((t) => t.icaoId === airport.icao) : undefined;
      return [
        compareStation(
          role,
          airport.icao,
          {
            metar: airport.metar ? { raw: airport.metar, referenceIso: plan.generatedAt } : null,
            taf: airport.taf ? { raw: airport.taf, referenceIso: plan.generatedAt } : null,
          },
          {
            metar: metar ? { raw: metar.rawOb, referenceIso: metar.reportTime } : null,
            taf: taf ? { raw: taf.rawTAF, referenceIso: taf.issueTime } : null,
          },
        ),
      ];
    }),
  };
}
