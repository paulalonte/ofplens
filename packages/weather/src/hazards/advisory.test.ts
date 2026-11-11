import { describe, expect, it, vi } from 'vitest';
import { loadHazardFixture } from '../testing/fixtures';
import { HAZARD_KINDS, hazardKind, parseAdvisories, type Advisory } from './advisory';

const isigmets = parseAdvisories('isigmet', loadHazardFixture('isigmet'));
const airsigmets = parseAdvisories('airsigmet', loadHazardFixture('airsigmet'));
const gairmets = parseAdvisories('gairmet', loadHazardFixture('gairmet'));
const all = [...isigmets, ...airsigmets, ...gairmets];

const byFir = (fir: string) => isigmets.filter((a) => a.fir === fir);

describe('hazard feeds captured on 11 Nov 2026', () => {
  it('parses every entry of every feed without skipping one', () => {
    const warn = vi.fn();
    for (const feed of ['isigmet', 'airsigmet', 'gairmet'] as const) {
      parseAdvisories(feed, loadHazardFixture(feed), { warn });
    }
    expect(warn).not.toHaveBeenCalled();
    // 43 G-AIRMET areas less 12 freezing-level contours.
    expect([isigmets.length, airsigmets.length, gairmets.length]).toEqual([125, 4, 31]);
  });

  it('maps every hazard code seen in the feeds', () => {
    const kinds = Object.fromEntries(all.map((a) => [a.code, a.hazard]));
    expect(kinds).toEqual({
      TS: 'thunderstorm',
      TURB: 'turbulence',
      ICE: 'icing',
      MTW: 'mountain_wave',
      VA: 'volcanic_ash',
      TC: 'tropical_cyclone',
      CONVECTIVE: 'thunderstorm',
      'TURB-HI': 'turbulence',
      'TURB-LO': 'turbulence',
      IFR: 'low_visibility',
      MT_OBSC: 'low_visibility',
      LLWS: 'other',
      SFC_WND: 'other',
    });
  });

  it('gives each advisory a unique id and closed, valid rings', () => {
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length);
    for (const advisory of all) {
      expect(HAZARD_KINDS).toContain(advisory.hazard);
      expect(Date.parse(advisory.validTo)).toBeGreaterThan(Date.parse(advisory.validFrom));
      for (const ring of advisory.polygons) {
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring[0]).toEqual(ring.at(-1));
        for (const [lon, lat] of ring) {
          expect(Math.abs(lon)).toBeLessThanOrEqual(360);
          expect(Math.abs(lat)).toBeLessThanOrEqual(90);
        }
      }
    }
    // Every advisory in this capture came with a shape.
    expect(all.filter((a) => a.polygons.length === 0)).toEqual([]);
  });

  it('reads an international SIGMET: times, levels, FIR, qualifier and raw text', () => {
    const [ts] = byFir('SVZM');
    expect(ts).toMatchObject({
      id: 'isigmet:SVZM:02:1794384000',
      source: 'isigmet',
      hazard: 'thunderstorm',
      code: 'TS',
      severity: null,
      detail: 'EMBD',
      validFrom: '2026-11-11T08:00:00.000Z',
      validTo: '2026-11-11T13:00:00.000Z',
      baseFt: null,
      topFt: null,
      fir: 'SVZM',
      firName: 'SVZM MAIQUETIA',
    } satisfies Partial<Advisory>);
    expect(ts?.rawText).toContain('EMBD TS OBS AT 0800Z');
    // Six corners, closed by repeating the first.
    expect(ts?.polygons).toHaveLength(1);
    expect(ts?.polygons[0]).toHaveLength(7);
    expect(ts?.polygons[0]?.[0]).toEqual([-67.633, 11.65]);
  });

  it('reads severity, a volcano name and a storm name', () => {
    expect(isigmets.find((a) => a.code === 'TURB')).toMatchObject({ severity: 'severe' });
    expect(isigmets.find((a) => a.code === 'VA')?.detail).toMatch(/^(ERUPTION MT )?[A-Z ]+$/);
    // Tropical cyclone Pena: the SIGMET and its forecast part ("21F") are two advisories.
    expect(isigmets.filter((a) => a.code === 'TC').map((a) => a.id)).toEqual([
      'isigmet:KZAK:XRAY 21:1794388800',
      'isigmet:KZAK:XRAY 21F:1794388800',
    ]);
    expect(isigmets.find((a) => a.code === 'TC')).toMatchObject({
      detail: 'PENA',
      topFt: 59000,
    });
    // An empty qualifier is no detail.
    expect(byFir('FYWH')[0]).toMatchObject({ code: 'TS', detail: null, severity: null });
  });

  it('keeps every area of a multi-area SIGMET and drops a sliver', () => {
    // Jakarta 04: "N OF S0232 AND E OF E10916", cut by the FIR boundary into two areas.
    expect(isigmets.find((a) => a.id.startsWith('isigmet:WIIF:04:'))?.polygons).toHaveLength(2);
    // Curitiba: the first "area" is one point repeated, so only the real one remains.
    expect(byFir('SBCW').find((a) => a.code === 'TURB')?.polygons).toHaveLength(1);
  });

  it('keeps an area across the antimeridian continuous, past 180', () => {
    const magadan = byFir('UHMM').find((a) => a.code === 'TURB');
    expect(magadan).toMatchObject({ baseFt: 0, topFt: 10000 });
    expect(magadan?.polygons).toHaveLength(3);
    expect(magadan?.polygons[2]).toContainEqual([190.5, 76.889]);
  });

  it('reads a US convective SIGMET', () => {
    expect(airsigmets[0]).toMatchObject({
      id: 'airsigmet:SIGMET:16C:1794401700',
      hazard: 'thunderstorm',
      code: 'CONVECTIVE',
      severity: null,
      baseFt: null,
      topFt: 42000,
      fir: null,
    });
    expect(airsigmets[0]?.rawText).toContain('CONVECTIVE SIGMET 16C');
  });

  it('reads G-AIRMET levels in hundreds of feet, SFC and the freezing level', () => {
    expect(gairmets[0]).toMatchObject({
      source: 'gairmet',
      hazard: 'turbulence',
      code: 'TURB-HI',
      severity: 'moderate',
      baseFt: 30000,
      topFt: 42000,
      rawText: null,
      // The 12:00Z snapshot stands for 10:30Z to 13:30Z.
      validFrom: '2026-11-11T10:30:00.000Z',
      validTo: '2026-11-11T13:30:00.000Z',
    });
    // Icing from the freezing level (4,000 ft at its lowest) up to FL150.
    expect(gairmets).toContainEqual(
      expect.objectContaining({ code: 'ICE', baseFt: 4000, topFt: 15000 }),
    );
    expect(gairmets).toContainEqual(
      expect.objectContaining({ code: 'TURB-LO', detail: 'MTN WAVE', baseFt: 0, topFt: 7000 }),
    );
    expect(gairmets.find((a) => a.code === 'IFR')?.detail).toMatch(/^CIG BLW 010 VIS BLW 3SM/);
  });
});

describe('parseAdvisories on odd entries', () => {
  const sigmet = (overrides: Record<string, unknown> = {}) => ({
    icaoId: 'RPLL',
    firId: 'RPHI',
    firName: 'RPHI MANILA',
    seriesId: 3,
    validTimeFrom: 1794384000,
    validTimeTo: 1794398400,
    hazard: 'TS',
    qualifier: 'EMBD',
    base: null,
    top: 45000,
    coords: [
      { lon: 120, lat: 14 },
      { lon: 122, lat: 14 },
      { lon: 121, lat: '15.5' },
    ],
    rawSigmet: 'RPHI SIGMET 3 VALID 110800/111200 RPLL- RPHI MANILA FIR EMBD TS ...',
    ...overrides,
  });

  it('closes an open ring and accepts string coordinates and numeric series ids', () => {
    const [advisory] = parseAdvisories('isigmet', [sigmet()]);
    expect(advisory?.id).toBe('isigmet:RPHI:3:1794384000');
    expect(advisory?.polygons).toEqual([
      [
        [120, 14],
        [122, 14],
        [121, 15.5],
        [120, 14],
      ],
    ]);
  });

  it('keeps an advisory given only as text, with no shape', () => {
    for (const coords of [undefined, null, []]) {
      expect(parseAdvisories('isigmet', [sigmet({ coords })])).toEqual([
        expect.objectContaining({ hazard: 'thunderstorm', polygons: [] }),
      ]);
    }
  });

  it('turns an unknown hazard code into "other"', () => {
    expect(parseAdvisories('isigmet', [sigmet({ hazard: 'RDOACT CLD' })])[0]).toMatchObject({
      hazard: 'other',
      code: 'RDOACT CLD',
    });
    expect(hazardKind('turb-hi')).toBe('turbulence');
  });

  it('skips an unreadable entry, says so, and keeps the rest', () => {
    const warn = vi.fn();
    const advisories = parseAdvisories(
      'isigmet',
      [sigmet({ validTimeFrom: 'soon' }), sigmet({ coords: [{ lon: 0, lat: 91 }] }), sigmet()],
      { warn },
    );
    expect(advisories).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
