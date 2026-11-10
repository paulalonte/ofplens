import { describe, expect, it } from 'vitest';
import { reportId } from './reports';

describe('reportId', () => {
  it('builds a stable id from source, kind, station and time to the minute', () => {
    expect(reportId('dispatch', 'metar', 'EDDB', '2026-11-09T13:20:00Z')).toBe(
      'dispatch:metar:EDDB:2026-11-09T1320Z',
    );
    expect(reportId('live', 'taf', 'EDDM', '2026-11-10T05:00:00Z')).toBe(
      'live:taf:EDDM:2026-11-10T0500Z',
    );
    expect(reportId('live', 'metar', 'EDDB', null)).toBe('live:metar:EDDB:untimed');
  });
});
