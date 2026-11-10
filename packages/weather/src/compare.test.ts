import { describe, expect, it } from 'vitest';
import { compareStation, type RawReports } from './compare';

const DISPATCH = '2026-11-09T13:28:39Z';
const LATER = '2026-11-10T08:50:00Z';

const reports = (metar: string | null, taf: string | null, referenceIso: string): RawReports => ({
  metar: metar ? { raw: metar, referenceIso } : null,
  taf: taf ? { raw: taf, referenceIso } : null,
});

describe('compareStation', () => {
  it('decodes both sides and flags a changed flight category', () => {
    const station = compareStation(
      'origin',
      'EDDB',
      reports(
        'EDDB 091320Z AUTO 10005KT 9999 BKN009 03/01 Q1021',
        'EDDB 091100Z 0912/1012 10005KT',
        DISPATCH,
      ),
      reports(
        'METAR EDDB 100850Z AUTO 34003KT 7000 BKN004 OVC015 03/01 Q1013',
        'TAF EDDB 100500Z 1006/1106 15004KT',
        LATER,
      ),
    );

    expect(station).toEqual({
      role: 'origin',
      icao: 'EDDB',
      dispatch: {
        metar: {
          raw: 'EDDB 091320Z AUTO 10005KT 9999 BKN009 03/01 Q1021',
          observedAt: '2026-11-09T13:20:00Z',
          category: 'IFR',
          ceilingFt: 900,
          visibilitySm: 6.21,
          visibilityOrMore: true,
        },
        taf: { raw: 'EDDB 091100Z 0912/1012 10005KT', issuedAt: '2026-11-09T11:00:00Z' },
      },
      live: {
        metar: {
          raw: 'METAR EDDB 100850Z AUTO 34003KT 7000 BKN004 OVC015 03/01 Q1013',
          observedAt: '2026-11-10T08:50:00Z',
          category: 'LIFR',
          ceilingFt: 400,
          visibilitySm: 4.35,
          visibilityOrMore: false,
        },
        taf: { raw: 'TAF EDDB 100500Z 1006/1106 15004KT', issuedAt: '2026-11-10T05:00:00Z' },
      },
      changedSinceDispatch: true,
      newerTaf: true,
    });
  });

  it('does not flag a newer report with the same category', () => {
    const station = compareStation(
      'destination',
      'LEPA',
      reports('LEPA 091950Z 24009KT 9999 FEW020 21/17 Q1015', null, DISPATCH),
      reports('METAR LEPA 100830Z 24009KT 9999 FEW020 21/17 Q1015', null, LATER),
    );
    expect(station.changedSinceDispatch).toBe(false);
    expect(station.newerTaf).toBe(false);
  });

  it('does not flag anything without live weather yet', () => {
    const station = compareStation(
      'alternate',
      'EDDF',
      reports(
        'EDDF 091320Z AUTO 09007KT 9999 OVC014 08/04 Q1017',
        'EDDF 091100Z 0912/1018',
        DISPATCH,
      ),
      reports(null, null, LATER),
    );
    expect(station.live).toEqual({ metar: null, taf: null });
    expect(station.changedSinceDispatch).toBe(false);
    expect(station.newerTaf).toBe(false);
  });

  it('does not flag when the OFP had no METAR to compare with', () => {
    const station = compareStation(
      'origin',
      'EDDB',
      reports(null, null, DISPATCH),
      reports('METAR EDDB 100850Z AUTO 34003KT 7000 BKN004 03/01 Q1013', null, LATER),
    );
    expect(station.changedSinceDispatch).toBe(false);
  });
});
