import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { describe, expect, it } from 'vitest';
import { decodeMetar } from './metar';
import { loadWeatherFixture } from './testing/fixtures';

/**
 * The decoder judged against real data: aviationweather.gov decodes the same METARs itself
 * (fltCat, visib, clouds, obsTime), so its answers are the oracle for ours.
 */
const live = loadWeatherFixture('metar') as unknown as {
  icaoId: string;
  rawOb: string;
  reportTime: string;
  obsTime: number;
  fltCat: string;
  visib: number | string;
  clouds: { cover: string; base: number | null }[];
}[];

describe('decodeMetar against aviationweather.gov’s own decoding', () => {
  it.each(live.map((m) => [m.icaoId, m] as const))('%s', (_icao, m) => {
    const decoded = decodeMetar(m.rawOb, m.reportTime);

    expect(decoded.station).toBe(m.icaoId);
    expect(decoded.observedAt).toBe(new Date(m.obsTime * 1000).toISOString().replace('.000Z', 'Z'));
    expect(decoded.category).toBe(m.fltCat);

    const awcCeiling = m.clouds
      .filter((c) => ['BKN', 'OVC', 'OVX'].includes(c.cover) && c.base !== null)
      .map((c) => c.base!)
      .sort((a, b) => a - b)[0];
    expect(decoded.ceilingFt).toBe(awcCeiling ?? null);

    if (typeof m.visib === 'number') {
      expect(decoded.visibility?.sm).toBeCloseTo(m.visib, 1);
    } else {
      // "10+" / "6+": at least that much.
      expect(decoded.visibility?.orMore || (decoded.visibility?.sm ?? 0) >= 6).toBe(true);
    }
  });

  it('covers every flight category', () => {
    const categories = new Set(live.map((m) => decodeMetar(m.rawOb, m.reportTime).category));
    expect(categories).toEqual(new Set(['VFR', 'MVFR', 'IFR', 'LIFR']));
  });
});

describe('decodeMetar on the METARs printed in the captured OFPs', () => {
  const ofps = ['eddb-eddm-c750-kgs', 'ksfo-kjfk-b739-lbs', 'eddf-lepa-a339-noalt'];
  const reports = ofps.flatMap((name) => {
    const plan = parseOfp(loadFixture(name));
    return [plan.origin, plan.destination, plan.alternate]
      .filter((a) => a?.metar)
      .map((a) => ({ name, icao: a!.icao, metar: a!.metar!, generatedAt: plan.generatedAt }));
  });

  it('has the OFP METARs to check', () => {
    expect(reports).toHaveLength(8); // 3 + 3 + 2 (no alternate)
  });

  it.each(reports.map((r) => [`${r.name} ${r.icao}`, r] as const))('%s', (_label, r) => {
    const decoded = decodeMetar(r.metar, r.generatedAt);

    expect(decoded.station).toBe(r.icao);
    expect(decoded.category).not.toBeNull();
    expect(decoded.visibility).not.toBeNull();
    // Observed before the plan was generated, and not more than a few hours before.
    const ageMin = (Date.parse(r.generatedAt) - Date.parse(decoded.observedAt!)) / 60_000;
    expect(ageMin).toBeGreaterThanOrEqual(0);
    expect(ageMin).toBeLessThan(6 * 60);
  });

  it('decodes the EDDB departure METAR of the C750 plan exactly', () => {
    // EDDB 091320Z AUTO 10005KT 9999 BKN009 03/01 Q1021 BECMG SCT008
    const plan = parseOfp(loadFixture('eddb-eddm-c750-kgs'));
    expect(decodeMetar(plan.origin.metar!, plan.generatedAt)).toEqual({
      station: 'EDDB',
      observedAt: '2026-11-09T13:20:00Z',
      wind: { directionDeg: 100, variable: false, speedKt: 5, gustKt: null },
      visibility: { sm: expect.closeTo(6.21, 2), orMore: true },
      clouds: [{ cover: 'BKN', baseFt: 900 }],
      ceilingFt: 900,
      category: 'IFR',
      cavok: false,
    });
  });
});
