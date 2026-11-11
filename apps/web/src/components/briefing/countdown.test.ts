import { describe, expect, it } from 'vitest';
import { countdownAt, formatCountdown } from './countdown';

const times = {
  out: '2026-11-09T14:00:00Z',
  off: '2026-11-09T14:18:00Z',
  on: '2026-11-09T15:08:00Z',
};
const at = (iso: string) => Date.parse(iso);

describe('countdownAt', () => {
  it('counts down to pushback before Out', () => {
    expect(countdownAt(times, at('2026-11-09T13:50:00Z'))).toEqual({
      stage: 'pushback',
      target: times.out,
      remainingMs: 10 * 60_000,
      sincePushbackMs: null,
    });
  });

  it('counts down to takeoff between Out and Off, with the time since planned pushback', () => {
    expect(countdownAt(times, at('2026-11-09T14:03:12Z'))).toEqual({
      stage: 'takeoff',
      target: times.off,
      remainingMs: (14 * 60 + 48) * 1000,
      sincePushbackMs: (3 * 60 + 12) * 1000,
    });
  });

  it('counts down to landing between Off and On', () => {
    expect(countdownAt(times, at('2026-11-09T15:00:00Z'))).toMatchObject({
      stage: 'landing',
      target: times.on,
      remainingMs: 8 * 60_000,
    });
  });

  it('switches stage exactly at each milestone', () => {
    expect(countdownAt(times, at(times.out))?.stage).toBe('takeoff');
    expect(countdownAt(times, at(times.off))?.stage).toBe('landing');
    expect(countdownAt(times, at(times.on))).toBeNull();
  });

  it('counts to the minute shown on the card, not to the second in the OFP', () => {
    const withSeconds = { ...times, on: '2026-11-09T14:59:31Z' };
    expect(countdownAt(withSeconds, at('2026-11-09T14:52:00Z'))?.remainingMs).toBe(8 * 60_000);
  });

  it('shows nothing for a plan more than a day ahead or already flown', () => {
    expect(countdownAt(times, at('2026-11-08T13:59:59Z'))).toBeNull();
    expect(countdownAt(times, at('2026-11-08T14:00:00Z'))?.stage).toBe('pushback');
    expect(countdownAt(times, at('2026-11-12T09:00:00Z'))).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('shows minutes and seconds under an hour, hours above', () => {
    expect(formatCountdown(10 * 60_000)).toBe('10:00');
    expect(formatCountdown(5_000)).toBe('0:05');
    expect(formatCountdown(65 * 60_000)).toBe('1:05:00');
    expect(formatCountdown(24 * 3_600_000 - 1_000)).toBe('23:59:59');
  });

  it('rounds partial seconds up, and never goes below zero', () => {
    expect(formatCountdown(9_001)).toBe('0:10');
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5_000)).toBe('0:00');
  });
});
