import { describe, expect, it } from 'vitest';
import { parseOfp } from '../parseOfp';
import { loadFixture } from '../testing/fixtures';
import {
  addSeconds,
  formatDuration,
  formatLocal,
  formatUtcOffset,
  formatZulu,
  formatZuluDate,
  localDayOffset,
} from './time';

describe('addSeconds', () => {
  it('adds elapsed time to a timestamp, across midnight', () => {
    expect(addSeconds('2026-11-09T14:10:00Z', 245)).toBe('2026-11-09T14:14:05Z');
    expect(addSeconds('2026-11-09T23:50:00Z', 1200)).toBe('2026-11-10T00:10:00Z');
  });
});

describe('formatZulu', () => {
  it('prints HH:MMZ rounded to the nearest minute', () => {
    expect(formatZulu('2026-11-09T14:00:00Z')).toBe('14:00Z');
    expect(formatZulu('2026-11-09T14:59:31Z')).toBe('15:00Z');
    expect(formatZulu('2026-11-09T14:59:29Z')).toBe('14:59Z');
  });

  it('rolls the date forward when rounding crosses midnight', () => {
    expect(formatZulu('2026-11-09T23:59:30Z')).toBe('00:00Z');
    expect(formatZuluDate('2026-11-09T23:59:30Z')).toBe('10 NOV 2026');
  });

  it('rejects anything that is not a timestamp', () => {
    expect(() => formatZulu('soon')).toThrow(RangeError);
  });
});

describe('formatLocal and localDayOffset', () => {
  it('applies the airport offset, not the viewer’s timezone', () => {
    expect(formatLocal('2026-11-09T14:00:00Z', 60)).toBe('15:00');
    expect(formatLocal('2026-11-09T14:00:00Z', 0)).toBe('14:00');
  });

  it('goes back a day west of UTC around midnight', () => {
    expect(formatLocal('2026-11-10T01:00:00Z', -480)).toBe('17:00');
    expect(localDayOffset('2026-11-10T01:00:00Z', -480)).toBe(-1);
  });

  it('goes forward a day east of UTC around midnight, with half-hour offsets', () => {
    expect(formatLocal('2026-11-09T20:00:00Z', 330)).toBe('01:30');
    expect(localDayOffset('2026-11-09T20:00:00Z', 330)).toBe(1);
    expect(formatLocal('2026-11-09T12:00:00Z', 14 * 60)).toBe('02:00');
    expect(localDayOffset('2026-11-09T12:00:00Z', 14 * 60)).toBe(1);
  });

  it('is 0 when local and UTC share the date', () => {
    expect(localDayOffset('2026-11-09T14:00:00Z', 60)).toBe(0);
    expect(localDayOffset('2026-11-09T07:59:00Z', -480)).toBe(-1);
    expect(localDayOffset('2026-11-09T08:00:00Z', -480)).toBe(0);
  });
});

describe('formatDuration', () => {
  it('prints HH:MM rounded to the nearest minute', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(29)).toBe('00:00');
    expect(formatDuration(30)).toBe('00:01');
    expect(formatDuration(4051)).toBe('01:08'); // 01:07:31
  });

  it('keeps counting hours past 10 and past 24', () => {
    expect(formatDuration(11 * 3600 + 5 * 60)).toBe('11:05');
    expect(formatDuration(25 * 3600)).toBe('25:00');
    expect(formatDuration(59 * 3600 + 59 * 60 + 59)).toBe('60:00');
  });

  it('rejects negative and non-finite values', () => {
    expect(() => formatDuration(-1)).toThrow(RangeError);
    expect(() => formatDuration(Number.NaN)).toThrow(RangeError);
  });
});

describe('formatUtcOffset', () => {
  it('labels whole and fractional offsets', () => {
    expect(formatUtcOffset(0)).toBe('UTC');
    expect(formatUtcOffset(60)).toBe('UTC+1');
    expect(formatUtcOffset(-480)).toBe('UTC-8');
    expect(formatUtcOffset(330)).toBe('UTC+5:30');
    expect(formatUtcOffset(-210)).toBe('UTC-3:30');
  });
});

describe('with real plans', () => {
  it('keeps clock times and block time consistent despite seconds in the OFP', () => {
    const { times } = parseOfp(loadFixture('eddb-eddm-c750-kgs'));
    expect(formatZulu(times.out)).toBe('14:00Z');
    expect(formatZulu(times.in)).toBe('15:08Z'); // 15:07:31
    expect(formatDuration(times.blockTimeS)).toBe('01:08'); // 01:07:31
  });

  it('shows the KSFO departure on the previous local day and the KJFK arrival on the same day', () => {
    const plan = parseOfp(loadFixture('ksfo-kjfk-b739-lbs'));
    const { out, in: inTime } = plan.times;

    expect(formatZuluDate(out)).toBe('10 NOV 2026');
    expect(formatLocal(out, plan.origin.utcOffsetMin)).toBe('17:00');
    expect(localDayOffset(out, plan.origin.utcOffsetMin)).toBe(-1);

    expect(formatZulu(inTime)).toBe('06:18Z');
    expect(formatLocal(inTime, plan.destination.utcOffsetMin)).toBe('01:18');
    expect(localDayOffset(inTime, plan.destination.utcOffsetMin)).toBe(0);
    expect(formatDuration(plan.times.blockTimeS)).toBe('05:18');
  });
});
