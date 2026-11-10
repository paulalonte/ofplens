import { describe, expect, it } from 'vitest';
import { parseOfp } from './parseOfp';
import { parsePerformance } from './performance';
import { loadFixture } from './testing/fixtures';

const performanceOf = (fixture: string) => parseOfp(loadFixture(fixture)).performance;

describe('parsePerformance on the captured OFPs', () => {
  it('reads the KSFO 01R takeoff on a wet runway with a crosswind from the left', () => {
    expect(performanceOf('ksfo-kjfk-b739-lbs')?.takeoff).toEqual({
      airportIcao: 'KSFO',
      runway: '01R',
      plannedWeight: 170109,
      windDirDeg: 306,
      windSpeedKt: 12,
      temperatureC: 14,
      altimeterInHg: 30.13,
      surface: 'wet',
      magneticCourseDeg: 14,
      headwindKt: 4,
      crosswindKt: 11,
      crosswindFrom: 'left',
      ilsFrequency: null,
      flaps: '5',
      toraFt: 8650,
      thrust: 'TO',
      flexTemperatureC: null,
      v1Kt: 146,
      vrKt: 154,
      v2Kt: 162,
    });
  });

  it('reads the KJFK 31R landing with VREF and the dry landing distance', () => {
    expect(performanceOf('ksfo-kjfk-b739-lbs')?.landing).toEqual({
      airportIcao: 'KJFK',
      runway: '31R',
      plannedWeight: 142250,
      windDirDeg: 303,
      windSpeedKt: 12,
      temperatureC: 14,
      altimeterInHg: 29.81,
      surface: 'dry',
      magneticCourseDeg: 314,
      headwindKt: 12,
      crosswindKt: 2,
      crosswindFrom: 'left',
      ilsFrequency: '111.50',
      flaps: '30',
      ldaFt: 8486,
      vrefKt: 142,
      landingDistanceFt: 4357,
    });
  });

  it('reads a FLEX takeoff with a tailwind, and uses the wet distance on a wet landing', () => {
    const performance = performanceOf('eddf-lepa-a339-noalt');
    expect(performance?.takeoff).toMatchObject({
      runway: '18',
      thrust: 'FLEX',
      flexTemperatureC: 53,
      headwindKt: -5,
      crosswindKt: 4,
    });
    expect(performance?.landing).toMatchObject({
      runway: '24L',
      surface: 'wet',
      crosswindKt: 0,
      crosswindFrom: null,
      landingDistanceFt: 5729,
    });
  });
});

describe('parsePerformance on missing or odd data', () => {
  const conditions = {
    airport_icao: 'EDDB',
    planned_runway: '06L',
    planned_weight: '13237',
    wind_direction: '95',
    wind_speed: '5',
    temperature: '3',
    altimeter: '30.15',
    surface_condition: 'DRY',
  };

  it('returns null without a TLR, or with one it cannot read', () => {
    expect(parsePerformance(undefined)).toBeNull();
    expect(parsePerformance({})).toBeNull();
    expect(parsePerformance('nonsense')).toBeNull();
  });

  it('keeps the conditions when the planned runway is not in the list', () => {
    const takeoff = parsePerformance({
      takeoff: { conditions, runway: [{ identifier: '24R', length_tora: '11811' }] },
    })?.takeoff;
    expect(takeoff).toMatchObject({ runway: '06L', windDirDeg: 95, surface: 'dry' });
    expect(takeoff).toMatchObject({ toraFt: null, headwindKt: null, crosswindFrom: null });
  });

  it('accepts a single runway object and turns SimBrief empty values ("" and []) into null', () => {
    const takeoff = parsePerformance({
      takeoff: {
        conditions,
        runway: {
          identifier: '06L',
          length_tora: '11811',
          ils_frequency: '',
          flex_temperature: [],
          headwind_component: '-0',
        },
      },
    })?.takeoff;
    expect(takeoff).toMatchObject({
      toraFt: 11811,
      ilsFrequency: null,
      flexTemperatureC: null,
      headwindKt: 0,
    });
  });
});
