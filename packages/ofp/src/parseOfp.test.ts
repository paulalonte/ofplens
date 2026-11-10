import { describe, expect, it } from 'vitest';
import { OfpParseError, parseOfp, parseStepClimbs } from './parseOfp';
import { FlightPlanSummary } from './summary';
import { FIXTURE_NAMES, loadFixture } from './testing/fixtures';

function parseFixture(name: string): FlightPlanSummary {
  return parseOfp(loadFixture(name));
}

describe('parseOfp on every captured fixture', () => {
  it('has the three fixtures this suite relies on', () => {
    expect(FIXTURE_NAMES).toEqual([
      'eddb-eddm-c750-kgs',
      'eddf-lepa-a339-noalt',
      'ksfo-kjfk-b739-lbs',
    ]);
  });

  describe.each(FIXTURE_NAMES)('%s', (name) => {
    const plan = parseFixture(name);

    it('survives a JSON round trip unchanged (no Dates, no undefined)', () => {
      expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    });

    it('matches the FlightPlanSummary schema exactly (no extra or missing keys)', () => {
      expect(FlightPlanSummary.strict().parse(plan)).toEqual(plan);
    });

    it('numbers waypoints from 0 and ends at the destination airport', () => {
      expect(plan.waypoints.map((w) => w.seq)).toEqual(plan.waypoints.map((_, i) => i));
      expect(plan.waypoints.at(-1)).toMatchObject({ ident: plan.destination.icao, type: 'apt' });
    });

    it('has elapsed time rising and fuel on board falling along the route', () => {
      for (const [prev, next] of plan.waypoints.slice(1).map((w, i) => [plan.waypoints[i]!, w])) {
        expect(next!.elapsedS).toBeGreaterThanOrEqual(prev!.elapsedS);
        expect(next!.fuelOnBoard).toBeLessThanOrEqual(prev!.fuelOnBoard);
      }
    });

    it('has consistent times and fuel', () => {
      const ms = (iso: string) => Date.parse(iso);
      expect(ms(plan.times.in) - ms(plan.times.out)).toBe(plan.times.blockTimeS * 1000);
      expect(ms(plan.times.on) - ms(plan.times.off)).toBe(plan.times.airTimeS * 1000);
      expect(plan.fuel.ramp - plan.fuel.taxi - plan.fuel.trip).toBe(plan.fuel.landing);
    });
  });
});

describe('eddb-eddm-c750-kgs (bizjet, kg, one alternate)', () => {
  const plan = parseFixture('eddb-eddm-c750-kgs');

  it('maps every top-level field', () => {
    const { waypoints, ...rest } = plan;
    expect(waypoints).toHaveLength(19);
    expect(rest).toEqual({
      simbriefRequestId: '192980256',
      generatedAt: '2026-11-09T13:28:39Z',
      airac: '2611',
      units: 'kgs',
      flight: { airlineIcao: 'N', flightNumber: '70P', callsign: 'N70P' },
      aircraft: { icao: 'C750', reg: 'N750SB', name: 'CITATION X' },
      origin: expect.objectContaining({
        icao: 'EDDB',
        name: 'BERLIN BRANDENBURG',
        runway: '06L',
        elevationFt: 156,
        utcOffsetMin: 60,
        metar: expect.stringMatching(/^EDDB 091320Z /),
      }),
      destination: expect.objectContaining({
        icao: 'EDDM',
        runway: '08R',
        elevationFt: 1487,
        utcOffsetMin: 60,
      }),
      alternate: expect.objectContaining({
        icao: 'EDDF',
        name: 'FRANKFURT/MAIN',
        runway: '07R',
        taf: expect.stringMatching(/^EDDF 091100Z /),
      }),
      route: {
        text: 'LURO4B LUROS Y211 BEBKU Z36 MAREM DCT VESUB T106 TUSTO T108 LANDU LAND2A',
        cruiseAltitudeFt: 28000,
        costIndex: 10,
        distanceNm: 333,
        gcDistanceNm: 249,
        stepClimbs: [],
        // SimBrief writes "-0".
        avgIsaDevC: 0,
        avgTropopauseFt: 39325,
        avgWindComponentKt: -6,
      },
      times: {
        out: '2026-11-09T14:00:00Z',
        off: '2026-11-09T14:10:00Z',
        on: '2026-11-09T14:59:31Z',
        in: '2026-11-09T15:07:31Z',
        blockTimeS: 4051,
        airTimeS: 2971,
      },
      fuel: {
        ramp: 2432,
        taxi: 68,
        trip: 992,
        contingency: 301,
        alternate: 767,
        finalReserve: 304,
        extra: 0,
        landing: 1372,
      },
      weights: { paxCount: 8, cargo: 200, payload: 835, zfw: 10873, tow: 13237, ldw: 12245 },
      performance: {
        takeoff: expect.objectContaining({ airportIcao: 'EDDB', runway: '06L', surface: 'dry' }),
        landing: expect.objectContaining({ airportIcao: 'EDDM', runway: '08R', flaps: 'FULL' }),
      },
    });
  });

  it('maps a navlog fix', () => {
    expect(plan.waypoints[1]).toEqual({
      seq: 1,
      ident: 'DB069',
      name: 'DB069',
      type: 'wpt',
      stage: 'CLB',
      via: 'LURO4B',
      lat: 52.497892,
      lon: 13.991903,
      altitudeFt: 13600,
      windDirDeg: 209,
      windSpeedKt: 18,
      oatC: -16,
      elapsedS: 245,
      fuelOnBoard: 2236,
    });
  });
});

describe('ksfo-kjfk-b739-lbs (airline, lbs, crosses midnight UTC and timezones)', () => {
  const plan = parseFixture('ksfo-kjfk-b739-lbs');

  it('keeps weights in lbs and maps the airline callsign', () => {
    expect(plan.units).toBe('lbs');
    expect(plan.flight).toEqual({ airlineIcao: 'UAL', flightNumber: '1234', callsign: 'UAL1234' });
    expect(plan.fuel.ramp).toBe(35608);
    expect(plan.weights.zfw).toBe(135001);
  });

  it('uses each airport’s own UTC offset and UTC timestamps on the next day', () => {
    expect(plan.origin.utcOffsetMin).toBe(-480);
    expect(plan.destination.utcOffsetMin).toBe(-300);
    expect(plan.alternate).toMatchObject({ icao: 'KEWR', utcOffsetMin: -300 });
    expect(plan.times.out).toBe('2026-11-10T01:00:00Z');
    expect(plan.times.in).toBe('2026-11-10T06:17:58Z');
    expect(plan.times.blockTimeS).toBe(5 * 3600 + 17 * 60 + 58);
  });

  it('maps the step climb, a tailwind and both elevations', () => {
    expect(plan.route).toMatchObject({
      cruiseAltitudeFt: 35000,
      stepClimbs: [{ at: 'DBQ', altitudeFt: 37000 }],
      gcDistanceNm: 2242,
      distanceNm: 2298,
      avgIsaDevC: 1,
      avgTropopauseFt: 41365,
      avgWindComponentKt: 61,
    });
    expect(plan.origin.elevationFt).toBe(13);
    expect(plan.destination.elevationFt).toBe(13);
  });

  it('keeps TOC and TOD as ltlg fixes', () => {
    expect(plan.waypoints).toHaveLength(30);
    expect(plan.waypoints.find((w) => w.ident === 'TOC')).toMatchObject({
      type: 'ltlg',
      name: 'TOP OF CLIMB',
      stage: 'CLB',
      altitudeFt: 35000,
      elapsedS: 24 * 60 + 18,
    });
    expect(plan.waypoints.find((w) => w.ident === 'TOD')).toMatchObject({
      type: 'ltlg',
      stage: 'CRZ',
    });
  });
});

describe('eddf-lepa-a339-noalt (no alternate)', () => {
  const plan = parseFixture('eddf-lepa-a339-noalt');

  it('returns a null alternate and zero alternate fuel', () => {
    expect(plan.alternate).toBeNull();
    expect(plan.fuel.alternate).toBe(0);
    expect(plan.flight.callsign).toBe('DLH814');
    expect(plan.aircraft.icao).toBe('A339');
    expect(plan.waypoints).toHaveLength(28);
    expect(plan.times.blockTimeS).toBe(2 * 3600 + 17 * 60 + 46);
  });
});

describe('parseOfp on bad input', () => {
  function errorOf(raw: unknown): OfpParseError {
    try {
      parseOfp(raw);
    } catch (err) {
      if (err instanceof OfpParseError) return err;
      throw err;
    }
    throw new Error('expected parseOfp to throw');
  }

  it('reports SimBrief’s own fetch error', () => {
    const err = errorOf({ fetch: { userid: '', status: 'Error: Unknown UserID' } });
    expect(err.message).toBe('SimBrief returned an error: Error: Unknown UserID');
  });

  it('lists every missing section for an empty object', () => {
    const err = errorOf({});
    expect(err.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^params: /),
        expect.stringMatching(/^navlog: /),
        expect.stringMatching(/^fuel: /),
      ]),
    );
    expect(err.message).toMatch(/^Not a valid SimBrief OFP \(\d+ problems\)/);
  });

  it('rejects non-objects', () => {
    expect(errorOf(null).issues).toEqual([expect.stringMatching(/^\(root\): /)]);
    expect(errorOf('<xml/>').issues).toHaveLength(1);
  });

  it('points at the exact field that is wrong', () => {
    const raw = loadFixture('eddb-eddm-c750-kgs');
    (raw.fuel as Record<string, unknown>).plan_ramp = 'lots';
    (raw.times as Record<string, unknown>).est_block = '1h07';
    (raw.navlog as Record<string, unknown>[])[3]!.pos_lat = '123.0';

    const err = errorOf(raw);
    expect(err.issues).toEqual([
      expect.stringMatching(/^times\.est_block: Expected HH:MM:SS/),
      expect.stringMatching(/^fuel\.plan_ramp: Expected a numeric string/),
      expect.stringMatching(/^navlog\.3\.pos_lat: /),
    ]);
  });

  it('rejects unknown weight units and an empty navlog', () => {
    const raw = loadFixture('eddb-eddm-c750-kgs');
    (raw.params as Record<string, unknown>).units = 'tons';
    raw.navlog = [];

    const err = errorOf(raw);
    expect(err.issues).toEqual([
      expect.stringMatching(/^params\.units: /),
      expect.stringMatching(/^navlog: /),
    ]);
  });
});

describe('parseStepClimbs', () => {
  it.each([
    [null, []],
    ['EDDB/0280', []],
    ['EDDF/0290/HERBI/0390', [{ at: 'HERBI', altitudeFt: 39000 }]],
    [
      'KSFO/0350/DBQ/0370/N45W080/0390',
      [
        { at: 'DBQ', altitudeFt: 37000 },
        { at: 'N45W080', altitudeFt: 39000 },
      ],
    ],
    ['KSFO/0350/DBQ/abc', []],
  ])('%s', (input, expected) => expect(parseStepClimbs(input)).toEqual(expected));
});
