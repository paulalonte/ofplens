import { describe, expect, it } from 'vitest';
import { decodeMetar } from './metar';

const REF = '2026-11-10T09:00:00Z';
const decode = (raw: string, ref = REF) => decodeMetar(raw, ref);

describe('decodeMetar: header and time', () => {
  it('reads station and completes the observation time from the reference date', () => {
    const m = decode('METAR EDDB 100850Z AUTO 34003KT 9999 FEW040 03/01 Q1013');
    expect(m.station).toBe('EDDB');
    expect(m.observedAt).toBe('2026-11-10T08:50:00Z');
  });

  it('handles the OFP’s METARs, which have no "METAR" prefix', () => {
    expect(decode('EDDB 091320Z AUTO 10005KT 9999 BKN009 03/01 Q1021').observedAt).toBe(
      '2026-11-09T13:20:00Z',
    );
  });

  it('puts a report from the end of last month in last month', () => {
    // November has 30 days: a report from the 30th, read early on 1 December.
    expect(decode('KJFK 302351Z 30011KT 10SM CLR', '2026-12-01T00:30:00Z').observedAt).toBe(
      '2026-11-30T23:51:00Z',
    );
    expect(decode('KJFK 312351Z 30011KT 10SM CLR', '2027-01-01T00:10:00Z').observedAt).toBe(
      '2026-12-31T23:51:00Z',
    );
  });

  it('skips SPECI and COR before the station', () => {
    expect(decode('SPECI COR LSZH 100855Z 17004KT 7000 BKN010').station).toBe('LSZH');
  });
});

describe('decodeMetar: wind', () => {
  it.each([
    ['34003KT', { directionDeg: 340, variable: false, speedKt: 3, gustKt: null }],
    ['VRB02KT', { directionDeg: null, variable: true, speedKt: 2, gustKt: null }],
    ['24015G28KT', { directionDeg: 240, variable: false, speedKt: 15, gustKt: 28 }],
    ['00000KT', { directionDeg: 0, variable: false, speedKt: 0, gustKt: null }],
    ['27010MPS', { directionDeg: 270, variable: false, speedKt: 19, gustKt: null }],
    ['18020KMH', { directionDeg: 180, variable: false, speedKt: 11, gustKt: null }],
  ])('%s', (group, wind) => {
    expect(decode(`EDDB 100850Z ${group} 9999 FEW040`).wind).toEqual(wind);
  });

  it('ignores the variability group after the wind', () => {
    expect(decode('EDDB 100850Z 34003KT 320V020 9999').wind?.directionDeg).toBe(340);
  });
});

describe('decodeMetar: visibility', () => {
  const vis = (group: string) => decode(`KXXX 100850Z 00000KT ${group} CLR`).visibility;

  it('reads metres', () => {
    expect(vis('5000')?.sm).toBeCloseTo(3.107, 3);
    expect(vis('0800')?.sm).toBeCloseTo(0.497, 3);
    expect(vis('7000NDV')?.sm).toBeCloseTo(4.35, 2);
  });

  it('treats 9999 and CAVOK as 10 km or more', () => {
    expect(vis('9999')).toEqual({ sm: expect.closeTo(6.21, 2), orMore: true });
    const cavok = decode('VHHH 100830Z 02011KT CAVOK 22/03 Q1021');
    expect(cavok.cavok).toBe(true);
    expect(cavok.visibility).toEqual({ sm: expect.closeTo(6.21, 2), orMore: true });
    expect(cavok.category).toBe('VFR');
  });

  it('reads statute miles, fractions and P/M prefixes', () => {
    expect(vis('10SM')).toEqual({ sm: 10, orMore: false });
    expect(vis('P6SM')).toEqual({ sm: 6, orMore: true });
    expect(vis('1/2SM')).toEqual({ sm: 0.5, orMore: false });
    expect(vis('M1/4SM')).toEqual({ sm: 0.25, orMore: false });
    expect(vis('1 1/2SM')).toEqual({ sm: 1.5, orMore: false });
  });

  it('uses the prevailing visibility, not a later directional one', () => {
    expect(
      decode('ENGM 100820Z VRB02KT 0800 0550S R19R/P2000N FZFG VV002 M03/M04 Q1010').visibility?.sm,
    ).toBeCloseTo(0.497, 3);
  });

  it('is null when the report has none', () => {
    expect(decode('EDDB 100850Z AUTO 34003KT ////// 03/01 Q1013').visibility).toBeNull();
  });
});

describe('decodeMetar: clouds and ceiling', () => {
  it('lists layers and takes the lowest BKN/OVC as the ceiling', () => {
    const m = decode('EDDP 100850Z AUTO 30006KT 3900 BR FEW002 SCT003 BKN008 OVC013 03/02 Q1013');
    expect(m.clouds).toEqual([
      { cover: 'FEW', baseFt: 200 },
      { cover: 'SCT', baseFt: 300 },
      { cover: 'BKN', baseFt: 800 },
      { cover: 'OVC', baseFt: 1300 },
    ]);
    expect(m.ceilingFt).toBe(800); // FEW and SCT are not a ceiling
  });

  it('counts vertical visibility as a ceiling', () => {
    expect(decode('ENGM 100820Z VRB02KT 0800 FZFG VV002 M03/M04 Q1010').ceilingFt).toBe(200);
  });

  it('reads CB/TCU layers and ignores unknown bases', () => {
    const m = decode('LFPG 100830Z 07009KT 9999 SCT030CB BKN///');
    expect(m.clouds).toEqual([
      { cover: 'SCT', baseFt: 3000 },
      { cover: 'BKN', baseFt: null },
    ]);
    expect(m.ceilingFt).toBeNull();
  });

  it('has no ceiling for NSC, NCD, SKC or CLR', () => {
    for (const sky of ['NSC', 'NCD', 'SKC', 'CLR']) {
      expect(decode(`EHAM 100825Z 08003KT 9999 ${sky}`).ceilingFt).toBeNull();
    }
  });
});

describe('decodeMetar: only the observation counts', () => {
  it('ignores trend groups (BECMG, TEMPO, NOSIG) and remarks', () => {
    const m = decode(
      'METAR LSZH 100850Z 17004KT 7000 -RA FEW004 BKN010 11/10 Q1012 TEMPO 3500 DZRA BR BECMG BKN005',
    );
    expect(m.ceilingFt).toBe(1000);
    expect(m.visibility?.sm).toBeCloseTo(4.35, 2);
    expect(m.category).toBe('MVFR');

    const us = decode('KDEN 100853Z 24008KT 10SM CLR 06/M04 A3018 RMK AO2 SLP172 T00611039 57005');
    expect(us.clouds).toEqual([]);
    expect(us.category).toBe('VFR');
  });
});
