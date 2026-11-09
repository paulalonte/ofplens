import { describe, expect, it } from 'vitest';
import { loadSamplePlan, SAMPLE_NAMES, SampleNotFoundError } from './samples';

describe('sample plans', () => {
  it('lists every captured fixture in development', () => {
    expect(SAMPLE_NAMES).toEqual([
      'eddb-eddm-c750-kgs',
      'eddf-lepa-a339-noalt',
      'ksfo-kjfk-b739-lbs',
    ]);
  });

  it('loads and parses a sample by name', async () => {
    const plan = await loadSamplePlan('ksfo-kjfk-b739-lbs');
    expect(plan.flight.callsign).toBe('UAL1234');
  });

  it('rejects an unknown name', async () => {
    await expect(loadSamplePlan('nope')).rejects.toBeInstanceOf(SampleNotFoundError);
  });
});
