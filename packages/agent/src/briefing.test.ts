import { describe, expect, it } from 'vitest';
import { Briefing } from './briefing';

/** A plausible briefing for the EDDB → EDDM C750 plan, citing real report ids. */
const valid = () => ({
  headline: 'Low cloud at Berlin has dropped to LIFR since dispatch; Frankfurt has improved.',
  overallRisk: 'moderate',
  departure: {
    icao: 'EDDB',
    flightCategory: 'LIFR',
    summary: 'Wind 340/3, visibility 7 km, broken 400 ft, overcast 1,500 ft.',
    changedSinceDispatch: true,
    sourceReportId: 'live:metar:EDDB:2026-11-10T0850Z',
  },
  destination: {
    icao: 'EDDM',
    flightCategory: 'IFR',
    summary: 'Light rain, broken 500 ft.',
    changedSinceDispatch: false,
    sourceReportId: 'live:metar:EDDM:2026-11-10T0850Z',
  },
  alternate: {
    icao: 'EDDF',
    flightCategory: 'VFR',
    summary: 'Few clouds at 1,100 ft, visibility over 10 km.',
    changedSinceDispatch: true,
    sourceReportId: 'live:metar:EDDF:2026-11-10T0850Z',
  },
  enrouteHazards: [],
  pilotNotes: ['Expect a low-visibility departure from Berlin.'],
});

describe('Briefing schema', () => {
  it('accepts a well-formed briefing, with or without an alternate', () => {
    expect(Briefing.parse(valid())).toEqual(valid());
    expect(Briefing.safeParse({ ...valid(), alternate: null }).success).toBe(true);
  });

  it.each([
    ['a headline over 140 characters', { headline: 'x'.repeat(141) }],
    ['an unknown risk level', { overallRisk: 'extreme' }],
    ['more than five pilot notes', { pilotNotes: ['a', 'b', 'c', 'd', 'e', 'f'] }],
    ['a note over 240 characters', { pilotNotes: ['x'.repeat(241)] }],
    ['a missing alternate field', { alternate: undefined }],
  ])('rejects %s', (_, change) => {
    expect(Briefing.safeParse({ ...valid(), ...change }).success).toBe(false);
  });

  it.each([
    ['an unknown flight category', { flightCategory: 'MARGINAL' }],
    ['an ICAO code that is not 4 characters', { icao: 'EDB' }],
    ['no cited report', { sourceReportId: '' }],
    ['an empty summary', { summary: '' }],
  ])('rejects conditions with %s', (_, change) => {
    const b = valid();
    expect(Briefing.safeParse({ ...b, departure: { ...b.departure, ...change } }).success).toBe(
      false,
    );
  });

  it('requires hazards to cite an advisory and name both ends of the segment', () => {
    const hazard = {
      type: 'icing',
      fromWaypoint: 'TOC',
      toWaypoint: 'TOD',
      validUntil: '2026-11-10T12:00:00Z',
      severity: 'moderate',
      advisoryId: 'sigmet:EDGG:3',
    };
    expect(Briefing.safeParse({ ...valid(), enrouteHazards: [hazard] }).success).toBe(true);
    expect(
      Briefing.safeParse({ ...valid(), enrouteHazards: [{ ...hazard, advisoryId: '' }] }).success,
    ).toBe(false);
  });
});
