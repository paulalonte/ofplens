import { describe, expect, it } from 'vitest';
import { dispatchTaf, liveMetar, liveTaf, metarBody, observedAt } from './reports';

const briefAt = new Date('2026-11-11T18:45:00Z');

describe('case reports', () => {
  it('dates a METAR 5 to 15 minutes before the briefing, on a 10-minute mark', () => {
    expect(observedAt(briefAt).toISOString()).toBe('2026-11-11T18:40:00.000Z');
    expect(observedAt(new Date('2026-11-11T18:55:00Z')).toISOString()).toBe(
      '2026-11-11T18:50:00.000Z',
    );
    expect(observedAt(new Date('2026-11-10T00:04:00Z')).toISOString()).toBe(
      '2026-11-09T23:50:00.000Z',
    );

    const metar = liveMetar('KPHL', briefAt, '00000KT 1/4SM FG VV002 12/12 A2990');
    expect(metar.raw).toBe('METAR KPHL 111840Z 00000KT 1/4SM FG VV002 12/12 A2990');
    expect(metar.observedAt).toBe('2026-11-11T18:40:00Z');
  });

  it('fills TAF hour tokens from the hour of the briefing, across midnight', () => {
    const taf = liveTaf(
      'KJFK',
      briefAt,
      '{0}/{24} 21008KT P6SM SCT250 FM{+6}00 18006KT 4SM -RA BR OVC012',
    );
    expect(taf.raw).toBe(
      'TAF KJFK 111705Z 1118/1218 21008KT P6SM SCT250 FM120000 18006KT 4SM -RA BR OVC012',
    );
    expect(taf).toMatchObject({
      issuedAt: '2026-11-11T17:05:00Z',
      validFrom: '2026-11-11T18:00:00Z',
      validTo: '2026-11-12T18:00:00Z',
    });
    expect(() => liveTaf('KJFK', briefAt, '21008KT P6SM')).toThrow(/validity/);
  });

  it('reuses dispatch reports: a METAR without station and time, a TAF as it was', () => {
    expect(metarBody('EDDB 091320Z AUTO 10005KT 9999 BKN009 03/01 Q1021 BECMG SCT008')).toBe(
      'AUTO 10005KT 9999 BKN009 03/01 Q1021 BECMG SCT008',
    );
    expect(metarBody('METAR KSFO 091856Z 00000KT 3/4SM BR')).toBe('00000KT 3/4SM BR');
    expect(
      dispatchTaf(
        'EDDB 091100Z 0912/1012 10005KT 9999 BKN007\nBECMG 0912/0915 NSC',
        '2026-11-09T13:28:39Z',
      ),
    ).toMatchObject({
      icao: 'EDDB',
      issuedAt: '2026-11-09T11:00:00Z',
      validFrom: '2026-11-09T12:00:00Z',
      validTo: '2026-11-10T12:00:00Z',
    });
  });
});
