import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { describe, expect, it } from 'vitest';
import type { Advisory, Ring } from './advisory';
import { matchRouteHazards, type RoutePoint } from './route';

const plan = (name: string) => {
  const summary = parseOfp(loadFixture(name));
  return { route: summary.waypoints, takeoffAt: new Date(summary.times.off) };
};
const eddbEddm = plan('eddb-eddm-c750-kgs'); // takeoff 14:10Z, FL280
const ksfoKjfk = plan('ksfo-kjfk-b739-lbs'); // takeoff 01:20Z, FL350/370

/** A closed box from south-west to north-east corner. */
const box = (south: number, west: number, north: number, east: number): Ring => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];

const advisory = (overrides: Partial<Advisory> = {}): Advisory => ({
  id: 'isigmet:TEST:1:0',
  source: 'isigmet',
  hazard: 'thunderstorm',
  code: 'TS',
  severity: null,
  detail: 'EMBD',
  validFrom: '2026-11-01T00:00:00.000Z',
  validTo: '2026-11-30T00:00:00.000Z',
  baseFt: null,
  topFt: 45000,
  polygons: [],
  fir: 'TEST',
  firName: null,
  rawText: null,
  ...overrides,
});

const segmentsOf = (
  { route, takeoffAt }: { route: readonly RoutePoint[]; takeoffAt: Date },
  ...advisories: Advisory[]
) =>
  matchRouteHazards(route, advisories, { takeoffAt }).map((h) =>
    h.segments.map((s) => `${s.fromIdent}-${s.toIdent}`),
  );

// Around PIKIB (50.89N 13.71E), south of BEBKU and north of MAREM.
const AROUND_PIKIB = box(50.8, 13.5, 51.0, 13.8);

describe('matchRouteHazards: where', () => {
  it('finds the fixes around an area on EDDB → EDDM', () => {
    expect(segmentsOf(eddbEddm, advisory({ polygons: [AROUND_PIKIB] }))).toEqual([['BEBKU-MAREM']]);
  });

  it('finds the fixes around an area on KSFO → KJFK, along a long leg', () => {
    // Around the Rock Springs VOR (OCS, 41.59N 109.02W).
    const result = matchRouteHazards(
      ksfoKjfk.route,
      [advisory({ polygons: [box(41, -110, 42.2, -108)] })],
      { takeoffAt: ksfoKjfk.takeoffAt },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.segments).toEqual([
      { fromSeq: 9, toSeq: 11, fromIdent: 'LCU', toIdent: 'KATES' },
    ]);
  });

  it('gives one segment per crossing when an advisory covers two places', () => {
    const twoAreas = advisory({
      polygons: [box(51.8, 14.0, 52.0, 14.3), box(48.5, 12.35, 48.7, 12.5)], // LUROS, TUSTO
    });
    expect(segmentsOf(eddbEddm, twoAreas)).toEqual([['TOC-BEBKU', 'KUFAZ-LANDU']]);
  });

  it('ignores areas off the route and advisories with no shape', () => {
    expect(segmentsOf(eddbEddm, advisory({ polygons: [box(45, 2, 46, 3)] }))).toEqual([]);
    expect(segmentsOf(eddbEddm, advisory({ polygons: [] }))).toEqual([]);
  });

  it('lists matches in route order', () => {
    const later = advisory({ id: 'a', polygons: [box(48.5, 12.35, 48.7, 12.5)] });
    const earlier = advisory({ id: 'b', polygons: [AROUND_PIKIB] });
    expect(
      matchRouteHazards(eddbEddm.route, [later, earlier], eddbEddm).map((h) => h.advisory.id),
    ).toEqual(['b', 'a']);
  });
});

describe('matchRouteHazards: altitude', () => {
  it('excludes an advisory above the cruise level', () => {
    // FL280 at PIKIB; turbulence from FL300 to FL400 is above the flight.
    const above = advisory({ hazard: 'turbulence', baseFt: 30000, topFt: 40000 });
    expect(segmentsOf(eddbEddm, { ...above, polygons: [AROUND_PIKIB] })).toEqual([]);
    expect(segmentsOf(eddbEddm, { ...above, baseFt: 25000, polygons: [AROUND_PIKIB] })).toEqual([
      ['BEBKU-MAREM'],
    ]);
  });

  it('counts a climbing leg when any of its levels is inside', () => {
    // DB070 (17,600 ft) → DB072 (23,200 ft), icing 20,000–22,000 ft over both.
    const icing = advisory({
      hazard: 'icing',
      baseFt: 20000,
      topFt: 22000,
      polygons: [box(52.3, 14.1, 52.6, 14.25)],
    });
    // The legs before (13,600–17,600 ft) and after (23,200–28,000 ft) pass the area outside the band.
    expect(segmentsOf(eddbEddm, icing)).toEqual([['DB070-DB072']]);
  });

  it('keeps low visibility to the lower levels when it gives none', () => {
    const fog = advisory({ hazard: 'low_visibility', code: 'IFR', topFt: null });
    // In cruise at PIKIB: no. Around Munich on the approach (MIQ 5,500 ft → EDDM): yes.
    expect(segmentsOf(eddbEddm, { ...fog, polygons: [AROUND_PIKIB] })).toEqual([]);
    expect(segmentsOf(eddbEddm, { ...fog, polygons: [box(48.2, 11.4, 48.7, 11.9)] })).toEqual([
      ['LANDU-EDDM'],
    ]);
  });
});

describe('matchRouteHazards: time', () => {
  // PIKIB is 18 min after takeoff: 14:28Z.
  const at = (validFrom: string, validTo: string) =>
    advisory({ validFrom, validTo, polygons: [AROUND_PIKIB] });

  it('excludes an advisory that ends well before the flight gets there', () => {
    expect(segmentsOf(eddbEddm, at('2026-11-09T08:00:00Z', '2026-11-09T12:00:00Z'))).toEqual([]);
  });

  it('excludes one that starts well after', () => {
    expect(segmentsOf(eddbEddm, at('2026-11-09T16:00:00Z', '2026-11-09T20:00:00Z'))).toEqual([]);
  });

  it('keeps one within the margin (30 min)', () => {
    expect(segmentsOf(eddbEddm, at('2026-11-09T10:00:00Z', '2026-11-09T14:00:00Z'))).toEqual([
      ['BEBKU-MAREM'],
    ]);
  });

  it('moves with the takeoff time', () => {
    const late = { ...eddbEddm, takeoffAt: new Date('2026-11-09T18:00:00Z') };
    expect(segmentsOf(late, at('2026-11-09T16:00:00Z', '2026-11-09T20:00:00Z'))).toEqual([
      ['BEBKU-MAREM'],
    ]);
  });
});

describe('matchRouteHazards: across the antimeridian', () => {
  // Tokyo → San Francisco, made up: west of 180, across it, then east.
  const pacific: RoutePoint[] = [
    { seq: 0, ident: 'WEST1', lat: 38, lon: 150, altitudeFt: 37000, elapsedS: 3600 },
    { seq: 1, ident: 'WEST2', lat: 43, lon: 172, altitudeFt: 37000, elapsedS: 3 * 3600 },
    { seq: 2, ident: 'EAST1', lat: 44, lon: -172, altitudeFt: 37000, elapsedS: 4.5 * 3600 },
    { seq: 3, ident: 'EAST2', lat: 40, lon: -140, altitudeFt: 37000, elapsedS: 7 * 3600 },
  ];
  const flight = { route: pacific, takeoffAt: new Date('2026-11-11T00:00:00Z') };

  it('matches an area that straddles 180 (given past 180, as the feed sends it)', () => {
    expect(segmentsOf(flight, advisory({ polygons: [box(42, 176, 46, 186)] }))).toEqual([
      ['WEST2-EAST1'],
    ]);
  });

  it('matches areas on either side, however their longitudes are written', () => {
    expect(segmentsOf(flight, advisory({ polygons: [box(42, -178, 46, -170)] }))).toEqual([
      ['WEST2-EAST2'],
    ]);
    expect(segmentsOf(flight, advisory({ polygons: [box(41, 160, 45, 175)] }))).toEqual([
      ['WEST1-EAST1'],
    ]);
  });

  it('does not match the same latitudes on the other side of the world', () => {
    expect(segmentsOf(flight, advisory({ polygons: [box(40, -10, 46, 10)] }))).toEqual([]);
  });
});
