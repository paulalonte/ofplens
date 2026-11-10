import { describe, expect, it } from 'vitest';
import { flightCategory, worse } from './category';

describe('flightCategory', () => {
  it.each([
    // ceiling ft, visibility SM, expected
    [null, 10, 'VFR'],
    [3100, 6, 'VFR'],
    [3000, 10, 'MVFR'], // 3,000 ft is still MVFR
    [1000, 10, 'MVFR'], // 1,000 ft is MVFR, not IFR
    [999, 10, 'IFR'],
    [500, 10, 'IFR'], // 500 ft is IFR, not LIFR
    [499, 10, 'LIFR'],
    [null, 5, 'MVFR'], // 5 SM is still MVFR
    [null, 5.01, 'VFR'],
    [null, 3, 'MVFR'],
    [null, 2.99, 'IFR'],
    [null, 1, 'IFR'],
    [null, 0.99, 'LIFR'],
  ] as const)('ceiling %s ft, visibility %s SM → %s', (ceiling, visibility, expected) => {
    expect(flightCategory(ceiling, visibility)).toBe(expected);
  });

  it('takes the worse of ceiling and visibility', () => {
    expect(flightCategory(400, 10)).toBe('LIFR'); // ceiling decides
    expect(flightCategory(5000, 0.5)).toBe('LIFR'); // visibility decides
    expect(flightCategory(2000, 2)).toBe('IFR');
  });

  it('copes with unknown visibility, and gives up when nothing is known', () => {
    expect(flightCategory(800, null)).toBe('IFR');
    expect(flightCategory(null, null)).toBeNull();
  });

  it('orders categories from best to worst', () => {
    expect(worse('VFR', 'IFR')).toBe('IFR');
    expect(worse('LIFR', 'MVFR')).toBe('LIFR');
    expect(worse('MVFR', 'MVFR')).toBe('MVFR');
  });
});
