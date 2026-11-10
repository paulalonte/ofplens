import { describe, expect, it } from 'vitest';
import { tafIssuedAt } from './taf';
import { loadWeatherFixture } from './testing/fixtures';

describe('tafIssuedAt', () => {
  it('reads the issue time of OFP and live TAFs, with or without the TAF/AMD prefix', () => {
    const ref = '2026-11-09T13:28:39Z';
    expect(tafIssuedAt('EDDM 091100Z 0912/1018 10006KT 9999 OVC004', ref)).toBe(
      '2026-11-09T11:00:00Z',
    );
    expect(tafIssuedAt('TAF EDDB 100500Z 1006/1106 15004KT', '2026-11-10T09:00:00Z')).toBe(
      '2026-11-10T05:00:00Z',
    );
    expect(tafIssuedAt('TAF AMD LSZH 100825Z 1009/1115 17005KT', '2026-11-10T09:00:00Z')).toBe(
      '2026-11-10T08:25:00Z',
    );
  });

  it('returns null without an issue time', () => {
    expect(tafIssuedAt('TAF EDDB NIL', '2026-11-10T09:00:00Z')).toBeNull();
  });

  it('agrees with aviationweather.gov’s issueTime for every captured TAF', () => {
    for (const t of loadWeatherFixture('taf') as { rawTAF: string; issueTime: string }[]) {
      const expected = new Date(t.issueTime).toISOString().replace('.000Z', 'Z');
      expect(tafIssuedAt(t.rawTAF, t.issueTime)).toBe(expected);
    }
  });
});
