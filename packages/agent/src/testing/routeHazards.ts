import { parseAdvisories, type HazardClient } from '@ofplens/weather';
import { loadHazardFixture } from '@ofplens/weather/testing';

/**
 * Test and try-out only: the captured hazard feeds plus made-up SIGMETs over the captured
 * plans' routes, valid around `now` (a captured plan is flown "now": its planned takeoff has
 * passed). EDDF → LEPA has none, so one plan is briefed without hazards.
 */
export function routeSigmets(now = Date.now()) {
  const hour = Math.floor(now / 3_600_000) * 3600;
  const sigmet = (
    fir: [string, string],
    seriesId: string,
    hazard: string,
    qualifier: string,
    [south, west, north, east]: [number, number, number, number],
    base: number | null,
    top: number,
    text: string,
  ) => ({
    icaoId: fir[0],
    firId: fir[0],
    firName: fir[1],
    validTimeFrom: hour - 3600,
    validTimeTo: hour + 5 * 3600,
    seriesId,
    hazard,
    qualifier,
    base,
    top,
    geom: 'AREA',
    coords: [
      { lon: west, lat: south },
      { lon: east, lat: south },
      { lon: east, lat: north },
      { lon: west, lat: north },
    ],
    rawSigmet: `${fir[0]} SIGMET ${seriesId} ${fir[1]} ${text} (made up for testing)`,
  });

  return [
    // EDDB → EDDM: embedded thunderstorms around PIKIB (BEBKU to MAREM).
    sigmet(
      ['EDUU', 'EDUU RHEIN UIR'],
      'T1',
      'TS',
      'EMBD',
      [50.8, 13.5, 51.0, 13.8],
      null,
      38000,
      'EMBD TS FCST TOP FL380 MOV NE 15KT NC',
    ),
    // KSFO → KJFK: severe turbulence around the Rock Springs VOR (LCU to KATES), FL300-FL400.
    sigmet(
      ['KZLC', 'KZLC SALT LAKE CITY'],
      'T2',
      'TURB',
      'SEV',
      [41, -110, 42.2, -108],
      30000,
      40000,
      'SEV TURB FCST FL300/400 STNR NC',
    ),
  ];
}

/**
 * A hazard client answering with routeSigmets(now) among the captured international SIGMETs,
 * moved two days back so they never touch a route "now" (the results stay the same whatever
 * the date). The US feeds are left out for the same reason.
 */
export function fixtureHazardClient(now = Date.now()): HazardClient {
  const twoDaysS = 2 * 86_400;
  const captured = (loadHazardFixture('isigmet') as Record<string, unknown>[]).map((a) => ({
    ...a,
    validTimeFrom: (a.validTimeFrom as number) - twoDaysS,
    validTimeTo: (a.validTimeTo as number) - twoDaysS,
  }));
  return {
    fetchAdvisories: () =>
      Promise.resolve({
        advisories: parseAdvisories('isigmet', [...captured, ...routeSigmets(now)]),
        unavailable: [],
      }),
  };
}
