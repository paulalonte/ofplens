import { describe, expect, it } from 'vitest';
import { convertWeight, formatWeight, weightUnitLabel } from './weight';

describe('convertWeight', () => {
  it('leaves values alone when the unit does not change', () => {
    expect(convertWeight(2432, 'kgs', 'kgs')).toBe(2432);
    expect(convertWeight(35608, 'lbs', 'lbs')).toBe(35608);
  });

  it('converts kg to lb and lb to kg, rounded to whole units', () => {
    expect(convertWeight(2432, 'kgs', 'lbs')).toBe(5362); // 5361.64
    expect(convertWeight(1372, 'kgs', 'lbs')).toBe(3025); // 3024.74
    expect(convertWeight(35608, 'lbs', 'kgs')).toBe(16152); // 16151.52
    expect(convertWeight(135001, 'lbs', 'kgs')).toBe(61235); // 61235.42
  });

  it('handles zero and tiny values', () => {
    expect(convertWeight(0, 'kgs', 'lbs')).toBe(0);
    expect(convertWeight(1, 'lbs', 'kgs')).toBe(0); // 0.45 kg
    expect(convertWeight(1, 'kgs', 'lbs')).toBe(2); // 2.20 lb
  });

  it('drifts by at most one unit on a kg -> lb -> kg round trip', () => {
    for (const kg of [68, 992, 2432, 10873, 13237, 61235, 250_000]) {
      const back = convertWeight(convertWeight(kg, 'kgs', 'lbs'), 'lbs', 'kgs');
      expect(Math.abs(back - kg)).toBeLessThanOrEqual(1);
    }
  });
});

describe('formatWeight', () => {
  it('groups thousands and labels the unit', () => {
    expect(formatWeight(2432, 'kgs')).toBe('2,432 kg');
    expect(formatWeight(135001, 'lbs')).toBe('135,001 lb');
    expect(formatWeight(0, 'kgs')).toBe('0 kg');
  });

  it('converts when a display unit is given', () => {
    expect(formatWeight(2432, 'kgs', 'lbs')).toBe('5,362 lb');
    expect(formatWeight(35608, 'lbs', 'kgs')).toBe('16,152 kg');
  });

  it('exposes the unit labels', () => {
    expect(weightUnitLabel('kgs')).toBe('kg');
    expect(weightUnitLabel('lbs')).toBe('lb');
  });
});
