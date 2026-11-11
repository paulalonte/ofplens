import type { FlightPlanSummary, Waypoint } from '@ofplens/ofp';
import type { RouteHazardView } from '@ofplens/weather';
import { describe, expect, it } from 'vitest';
import { fixturePlan } from '../../../test/plans';
import { describeHazard } from '../hazardStyle';
import { buildRouteMapData } from './mapData';

const eddbEddm = fixturePlan('eddb-eddm-c750-kgs');

const hazard = (overrides: Partial<RouteHazardView> = {}): RouteHazardView => ({
  id: 'isigmet:EDUU:T1:0',
  source: 'isigmet',
  hazard: 'thunderstorm',
  code: 'TS',
  severity: null,
  detail: 'EMBD',
  validFrom: '2026-11-11T12:00:00.000Z',
  validTo: '2026-11-11T18:00:00.000Z',
  baseFt: null,
  topFt: 38000,
  polygons: [
    [
      [13.5, 50.8],
      [13.8, 50.8],
      [13.8, 51.0],
      [13.5, 51.0],
      [13.5, 50.8],
    ],
  ],
  fir: 'EDUU',
  firName: 'EDUU RHEIN UIR',
  rawText: null,
  segments: [{ fromSeq: 6, toSeq: 8, fromIdent: 'BEBKU', toIdent: 'MAREM' }],
  ...overrides,
});

describe('buildRouteMapData', () => {
  it('draws the route through every fix, with airports marked', () => {
    const data = buildRouteMapData(eddbEddm, [], describeHazard)!;

    const fixes = data.fixes.features.map((f) => f.properties.ident);
    expect(fixes).toEqual(eddbEddm.waypoints.map((w) => w.ident));
    expect(data.fixes.features.at(-1)?.properties).toEqual({ ident: 'EDDM', airport: true });

    const line = data.route.features[0]!.geometry.coordinates;
    expect(line[0]).toEqual([eddbEddm.waypoints[0]!.lon, eddbEddm.waypoints[0]!.lat]);
    expect(line.at(-1)).toEqual([eddbEddm.waypoints.at(-1)!.lon, eddbEddm.waypoints.at(-1)!.lat]);
    // Bounds around the route (Berlin to Munich).
    const [[west, south], [east, north]] = data.bounds;
    expect(west).toBeCloseTo(11.6, 1);
    expect(east).toBeCloseTo(14.2, 1);
    expect(south).toBeCloseTo(48.35, 1);
    expect(north).toBeCloseTo(52.55, 1);
    expect(data.hazards.features).toEqual([]);
    expect(data.kinds).toEqual([]);
  });

  it('draws each hazard area with its colour and popup text, and the affected stretch', () => {
    const turbulence = hazard({
      id: 'gairmet:x',
      hazard: 'turbulence',
      code: 'TURB-HI',
      severity: 'severe',
      baseFt: 30000,
      topFt: 40000,
      segments: [{ fromSeq: 12, toSeq: 13, fromIdent: 'TOD', toIdent: 'NETES' }],
    });
    const data = buildRouteMapData(eddbEddm, [hazard(), turbulence], describeHazard)!;

    expect(data.hazards.features.map((f) => f.properties)).toEqual([
      {
        id: 'isigmet:EDUU:T1:0',
        kind: 'thunderstorm',
        color: '#dc2626',
        title: 'Thunderstorms',
        detail: 'Up to FL380 · until 18:00Z · BEBKU → MAREM',
      },
      {
        id: 'gairmet:x',
        kind: 'turbulence',
        color: '#d97706',
        title: 'Turbulence · severe',
        detail: 'FL300–FL400 · until 18:00Z · TOD → NETES',
      },
    ]);
    // BEBKU → PIKIB → MAREM, in the thunderstorm's colour.
    const stretch = data.affected.features[0]!;
    expect(stretch.properties.color).toBe('#dc2626');
    const ident = (i: number) => eddbEddm.waypoints.find((w) => w.seq === i)!;
    expect(stretch.geometry.coordinates[0]).toEqual([ident(6).lon, ident(6).lat]);
    expect(stretch.geometry.coordinates.at(-1)).toEqual([ident(8).lon, ident(8).lat]);
    expect(stretch.geometry.coordinates).toContainEqual([ident(7).lon, ident(7).lat]);
    expect(data.kinds).toEqual(['thunderstorm', 'turbulence']);
  });

  describe('across the antimeridian', () => {
    const fix = (seq: number, ident: string, lat: number, lon: number): Waypoint => ({
      ...eddbEddm.waypoints[5]!,
      seq,
      ident,
      lat,
      lon,
      type: 'wpt',
    });
    const pacific: FlightPlanSummary = {
      ...eddbEddm,
      waypoints: [
        fix(0, 'WEST1', 38, 150),
        fix(1, 'WEST2', 43, 172),
        fix(2, 'EAST1', 44, -172),
        fix(3, 'EAST2', 40, -140),
      ],
    };

    it('keeps the route continuous past 180 instead of jumping across the map', () => {
      const data = buildRouteMapData(pacific, [], describeHazard)!;
      const lons = data.route.features[0]!.geometry.coordinates.map(([lon]) => lon);
      for (let i = 1; i < lons.length; i++) {
        expect(Math.abs(lons[i]! - lons[i - 1]!)).toBeLessThan(10);
      }
      expect(data.fixes.features.map((f) => f.geometry.coordinates[0])).toEqual([
        150, 172, 188, 220,
      ]);
      expect(data.bounds[0][0]).toBe(150);
      expect(data.bounds[1][0]).toBe(220);
    });

    it('moves a hazard written on the other side next to the route', () => {
      const area = hazard({
        polygons: [
          [
            [-178, 42],
            [-170, 42],
            [-170, 46],
            [-178, 46],
            [-178, 42],
          ],
        ],
        segments: [{ fromSeq: 1, toSeq: 2, fromIdent: 'WEST2', toIdent: 'EAST1' }],
      });
      const data = buildRouteMapData(pacific, [area], describeHazard)!;
      expect(data.hazards.features[0]!.geometry.coordinates[0]![0]).toEqual([182, 42]);
    });
  });

  it('has nothing to draw without at least two fixes', () => {
    expect(
      buildRouteMapData({ ...eddbEddm, waypoints: [eddbEddm.waypoints[0]!] }, [], describeHazard),
    ).toBeNull();
  });
});
