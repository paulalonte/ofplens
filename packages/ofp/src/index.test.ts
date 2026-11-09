import { describe, expect, it } from 'vitest';
import { WEIGHT_UNITS } from './index';

describe('@ofplens/ofp', () => {
  it('exposes the supported weight units', () => {
    expect(WEIGHT_UNITS).toEqual(['kgs', 'lbs']);
  });
});
