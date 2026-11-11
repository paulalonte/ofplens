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
      windDirDeg: 306,
      windSpeedKt: 12,
      temperatureC: 14,
      altimeterInHg: 30.13,
      surface: 'wet',
      magneticCourseDeg: 14,
      trueCourseDeg: 28,
      headwindKt: 4,
      crosswindKt: 11,
      crosswindFrom: 'left',
      toraFt: 8650,
    });
  });

  it('reads the KJFK 31R landing with the runway LDA', () => {
    expect(performanceOf('ksfo-kjfk-b739-lbs')?.landing).toEqual({
      airportIcao: 'KJFK',
      runway: '31R',
      windDirDeg: 303,
      windSpeedKt: 12,
      temperatureC: 14,
      altimeterInHg: 29.81,
      surface: 'dry',
      magneticCourseDeg: 314,
      trueCourseDeg: 301,
      headwindKt: 12,
      crosswindKt: 2,
      crosswindFrom: 'left',
      ldaFt: 8486,
    });
  });

  it('reads a takeoff with a tailwind and a wet landing without crosswind', () => {
    const performance = performanceOf('eddf-lepa-a339-noalt');
    expect(performance?.takeoff).toMatchObject({
      runway: '18',
      headwindKt: -5,
      crosswindKt: 4,
    });
    expect(performance?.landing).toMatchObject({
      runway: '24L',
      surface: 'wet',
      crosswindKt: 0,
      crosswindFrom: null,
      ldaFt: 9843,
    });
  });
});

describe('parsePerformance on missing or odd data', () => {
  const conditions = {
    airport_icao: 'EDDB',
    planned_runway: '06L',
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
          magnetic_course: '',
          crosswind_component: [],
          headwind_component: '-0',
        },
      },
    })?.takeoff;
    expect(takeoff).toMatchObject({
      toraFt: 11811,
      magneticCourseDeg: null,
      crosswindKt: null,
      headwindKt: 0,
    });
  });
});
