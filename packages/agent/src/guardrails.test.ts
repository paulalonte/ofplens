import { describe, expect, it } from 'vitest';
import type { Briefing } from './briefing';
import { checkBriefing, collectEvidence, type ToolCallRecord } from './guardrails';

/** Tool results like a real run for the EDDB → EDDM C750 plan (see tools.int.test.ts). */
/** A turbulence G-AIRMET crossing the route twice, as get_route_hazards returns it. */
const TURBULENCE = {
  advisoryId: 'gairmet:TANGO:1C:TURB-HI:2026-11-09T15Z:0a1b2c3d',
  type: 'turbulence',
  code: 'TURB-HI',
  severity: 'moderate',
  detail: null,
  baseFt: 24000,
  topFt: 36000,
  validFrom: '2026-11-09T13:30:00.000Z',
  validUntil: '2026-11-09T16:30:00.000Z',
  segments: [
    { fromWaypoint: 'LUROS', toWaypoint: 'PIKIB' },
    { fromWaypoint: 'VESUB', toWaypoint: 'TOD' },
  ],
  issuedBy: 'US G-AIRMET',
  rawText: null,
};

const calls = ({
  alternate = true,
  weather = true,
  hazards = [] as unknown[],
} = {}): ToolCallRecord[] => [
  {
    name: 'get_flight_plan',
    ok: true,
    ms: 5,
    output: {
      airports: [
        { role: 'origin', icao: 'EDDB' },
        { role: 'destination', icao: 'EDDM' },
        ...(alternate ? [{ role: 'alternate', icao: 'EDDF' }] : []),
      ],
      waypoints: ['DB068', 'TOC', 'LUROS', 'PIKIB', 'VESUB', 'TOD', 'EDDM'].map((ident) => ({
        ident,
      })),
    },
  },
  {
    name: 'get_planned_weather',
    ok: true,
    ms: 5,
    output: {
      stations: [
        {
          icao: 'EDDB',
          metar: { reportId: 'dispatch:metar:EDDB:2026-11-09T1320Z', flightCategory: 'IFR' },
          taf: { reportId: 'dispatch:taf:EDDB:2026-11-09T1100Z' },
        },
        {
          icao: 'EDDM',
          metar: { reportId: 'dispatch:metar:EDDM:2026-11-09T1320Z', flightCategory: 'IFR' },
          taf: null,
        },
        ...(alternate
          ? [
              {
                icao: 'EDDF',
                metar: { reportId: 'dispatch:metar:EDDF:2026-11-09T1320Z', flightCategory: 'MVFR' },
                taf: null,
              },
            ]
          : []),
      ],
    },
  },
  ...(weather
    ? [
        {
          name: 'get_weather',
          ok: true,
          ms: 5,
          output: {
            stations: [
              {
                icao: 'EDDB',
                metar: { reportId: 'live:metar:EDDB:2026-11-10T0850Z', flightCategory: 'LIFR' },
                taf: null,
                changedSinceDispatch: true,
              },
              {
                icao: 'EDDM',
                metar: { reportId: 'live:metar:EDDM:2026-11-10T0850Z', flightCategory: 'IFR' },
                taf: null,
                changedSinceDispatch: false,
              },
              ...(alternate
                ? [
                    {
                      icao: 'EDDF',
                      metar: {
                        reportId: 'live:metar:EDDF:2026-11-10T0850Z',
                        flightCategory: 'VFR',
                      },
                      taf: null,
                      changedSinceDispatch: true,
                    },
                  ]
                : []),
            ],
          },
        },
      ]
    : []),
  {
    name: 'get_route_hazards',
    ok: true,
    ms: 5,
    output: { available: true, hazards, moreNotShown: 0 },
  },
];

const good = (): Briefing => ({
  headline: 'Berlin has dropped to LIFR since dispatch; plan for a low-visibility departure.',
  overallRisk: 'moderate',
  departure: {
    icao: 'EDDB',
    flightCategory: 'LIFR',
    summary: 'Wind 340 at 3 kt, broken cloud at 400 ft.',
    changedSinceDispatch: true,
    sourceReportId: 'live:metar:EDDB:2026-11-10T0850Z',
  },
  destination: {
    icao: 'EDDM',
    flightCategory: 'IFR',
    summary: 'Light rain, broken cloud at 500 ft.',
    changedSinceDispatch: false,
    sourceReportId: 'live:metar:EDDM:2026-11-10T0850Z',
  },
  alternate: {
    icao: 'EDDF',
    flightCategory: 'VFR',
    summary: 'Few clouds at 1,100 ft.',
    changedSinceDispatch: true,
    sourceReportId: 'live:metar:EDDF:2026-11-10T0850Z',
  },
  enrouteHazards: [],
  pilotNotes: ['Berlin improved TAF expected after 1200Z.'],
});

const check = (b: Briefing, c = calls()) => checkBriefing(b, collectEvidence(c));

describe('checkBriefing', () => {
  it('accepts a briefing whose every label and citation matches the tools', () => {
    expect(check(good())).toEqual([]);
  });

  it('accepts a dispatch report when there is no live one, with changedSinceDispatch false', () => {
    const b = good();
    b.destination = { ...b.destination, sourceReportId: 'dispatch:metar:EDDM:2026-11-09T1320Z' };
    expect(check(b)).toEqual([]);
  });

  it('rejects a flight category that differs from the cited METAR', () => {
    const b = good();
    b.departure.flightCategory = 'VFR';
    expect(check(b)).toEqual(['departure: says VFR, but the cited METAR is LIFR.']);
  });

  it('rejects a citation no tool returned', () => {
    const b = good();
    b.departure.sourceReportId = 'live:metar:EDDB:2026-11-10T0950Z';
    expect(check(b)).toEqual([
      'departure: cites "live:metar:EDDB:2026-11-10T0950Z", which no weather tool returned.',
    ]);
  });

  it('rejects a citation from another airport', () => {
    const b = good();
    b.departure.sourceReportId = 'live:metar:EDDM:2026-11-10T0850Z';
    b.departure.flightCategory = 'IFR';
    b.departure.changedSinceDispatch = true;
    expect(check(b)).toContain('departure: cites a report for EDDM, not EDDB.');
  });

  it('rejects conditions based on a TAF', () => {
    const b = good();
    b.departure.sourceReportId = 'dispatch:taf:EDDB:2026-11-09T1100Z';
    b.departure.changedSinceDispatch = false;
    expect(check(b)).toContain('departure: cites a TAF; conditions must be based on a METAR.');
  });

  it('rejects the wrong airport and a changedSinceDispatch that contradicts the tools', () => {
    const b = good();
    b.destination.icao = 'EDDN';
    b.destination.changedSinceDispatch = true;
    expect(check(b)).toEqual([
      "destination: says EDDN, but the flight plan's destination is EDDM.",
      'destination: changedSinceDispatch is true, but the weather tools say false.',
    ]);
  });

  it('requires the alternate exactly when the plan has one', () => {
    expect(check({ ...good(), alternate: null })).toEqual([
      "alternate: the flight plan's alternate EDDF is missing from the briefing.",
    ]);
    expect(check(good(), calls({ alternate: false }))).toEqual([
      'alternate: the flight plan has no alternate, but the briefing describes one.',
    ]);
  });

  it('rejects a briefing written without reading the flight plan or the weather', () => {
    const noPlan = calls().filter((c) => c.name !== 'get_flight_plan');
    expect(check(good(), noPlan)).toEqual([
      'The briefing was written without reading the flight plan (get_flight_plan).',
    ]);
    expect(check(good(), calls({ weather: false }))).toHaveLength(3); // live citations unknown
  });

  it('rejects hazards without a returned advisory or with unknown waypoints', () => {
    const b = good();
    b.enrouteHazards = [
      {
        type: 'icing',
        fromWaypoint: 'TOC',
        toWaypoint: 'NOWHERE',
        validUntil: null,
        severity: 'moderate',
        advisoryId: 'sigmet:X',
      },
    ];
    expect(check(b)).toEqual([
      'Hazard names waypoint "NOWHERE", which is not in the flight plan.',
      'Hazard cites advisory "sigmet:X", which no tool returned.',
    ]);
  });

  describe('route hazards', () => {
    const withTurbulence = calls({ hazards: [TURBULENCE] });
    const entry = (overrides: Partial<Briefing['enrouteHazards'][number]> = {}) => ({
      type: 'turbulence' as const,
      fromWaypoint: 'LUROS',
      toWaypoint: 'PIKIB',
      validUntil: '2026-11-09T16:30:00Z',
      severity: 'moderate' as const,
      advisoryId: TURBULENCE.advisoryId,
      ...overrides,
    });

    it('accepts a hazard copied from get_route_hazards, one entry per segment or not', () => {
      const b = good();
      b.enrouteHazards = [entry(), entry({ fromWaypoint: 'VESUB', toWaypoint: 'TOD' })];
      expect(check(b, withTurbulence)).toEqual([]);
      b.enrouteHazards = [entry()];
      expect(check(b, withTurbulence)).toEqual([]);
    });

    it('rejects a briefing that leaves out a hazard the tool returned', () => {
      expect(check(good(), withTurbulence)).toEqual([
        `Hazard "${TURBULENCE.advisoryId}" (turbulence from LUROS to PIKIB) is missing from enrouteHazards.`,
      ]);
    });

    it('rejects a hazard whose type, severity, validity or segment differs from the tool', () => {
      const b = good();
      b.enrouteHazards = [
        entry({
          type: 'icing',
          severity: 'severe',
          validUntil: '2026-11-09T18:00:00Z',
          fromWaypoint: 'TOC',
          toWaypoint: 'PIKIB',
        }),
      ];
      const id = TURBULENCE.advisoryId;
      expect(check(b, withTurbulence)).toEqual([
        `Hazard "${id}": says icing, but the advisory is turbulence.`,
        `Hazard "${id}": says severity severe, but the advisory has moderate.`,
        `Hazard "${id}": says valid until 2026-11-09T18:00:00Z, but the advisory is valid until 2026-11-09T16:30:00.000Z.`,
        `Hazard "${id}": TOC to PIKIB is not one of the advisory's route segments.`,
      ]);
    });

    it('rejects a briefing written without checking route hazards', () => {
      const noHazards = calls().filter((c) => c.name !== 'get_route_hazards');
      expect(check(good(), noHazards)).toEqual([
        'The briefing was written without checking route hazards (get_route_hazards).',
      ]);
    });

    it('accepts no hazards when the tool failed (nothing to cite)', () => {
      const failed = calls().map((c) =>
        c.name === 'get_route_hazards' ? { ...c, ok: false, output: undefined, error: 'x' } : c,
      );
      expect(check(good(), failed)).toEqual([]);
    });
  });

  it.each([
    [
      'a fuel quantity',
      'Carry 2,400 kg of extra fuel for holding.',
      /weight or fuel quantity|fuel, weights/,
    ],
    ['a weight in pounds', 'Landing at 12,245 lbs is fine on 08R.', /weight or fuel quantity/],
    [
      'the block time',
      'Block time is short; arrive before the fog.',
      /fuel, weights or block\/flight time/,
    ],
    ['a duration in minutes', 'Expect a 15 min hold at EDDM.', /a duration/],
    ['a duration in hours', 'The fog should lift in 2 hours.', /a duration/],
    [
      'an H:MM time',
      'Flight takes 1:08 so the TAF covers arrival.',
      /duration or a time without Z/,
    ],
  ])('rejects a note with %s', (_, note, reason) => {
    const problems = check({ ...good(), pilotNotes: [note] });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toMatch(reason);
  });

  it('allows UTC clock times, wind in knots, cloud heights and visibility', () => {
    const b = good();
    b.pilotNotes = [
      'TEMPO 4500 BR at EDDB until 1200Z.',
      'Expect 14:00Z improvement at EDDM.',
      'Wind 240 at 18 kt gusting 28 kt, QNH 1013 hPa, visibility 3,500 m.',
    ];
    expect(check(b)).toEqual([]);
  });
});
