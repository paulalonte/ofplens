import { describe, expect, it } from 'vitest';
import { durationS, int, optInt, optText, utcOffsetMin } from './values';

describe('value schemas', () => {
  it('parses HH:MM:SS durations into seconds, including hours above 23', () => {
    expect(durationS.parse('01:07:31')).toBe(4051);
    expect(durationS.parse('00:00:00')).toBe(0);
    expect(durationS.parse('100:00:00')).toBe(360_000);
    expect(durationS.safeParse('1:2:3').success).toBe(false);
    expect(durationS.safeParse('01:60:00').success).toBe(false);
  });

  it('turns airport UTC offsets in hours into minutes, including half hours', () => {
    expect(utcOffsetMin.parse('1')).toBe(60);
    expect(utcOffsetMin.parse('-5')).toBe(-300);
    expect(utcOffsetMin.parse('5.5')).toBe(330);
    expect(utcOffsetMin.parse('-3.5')).toBe(-210);
  });

  it('accepts only integer strings for int, and maps empty strings to null where optional', () => {
    expect(int.parse('2432')).toBe(2432);
    expect(int.parse('-16')).toBe(-16);
    expect(int.safeParse('1.5').success).toBe(false);
    expect(int.safeParse('').success).toBe(false);
    expect(int.safeParse('12kg').success).toBe(false);
    expect(optInt.parse('')).toBeNull();
    expect(optText.parse('  ')).toBeNull();
    expect(optText.parse(' 06L ')).toBe('06L');
  });
});
