import { describe, expect, it } from 'vitest';
import { runwayWind, type MetarWind } from './wind';

const wind = (directionDeg: number | null, speedKt: number, gustKt: number | null = null) =>
  ({ directionDeg, variable: directionDeg === null, speedKt, gustKt }) satisfies MetarWind;

describe('runwayWind', () => {
  it('matches SimBrief for KSFO 01R: 306/12 on course 014 is 4 kt headwind, 11 kt from the left', () => {
    expect(runwayWind(wind(306, 12), 14)).toEqual({
      headwindKt: 4,
      crosswindKt: 11,
      crosswindFrom: 'left',
      gustCrosswindKt: null,
    });
  });

  it('gives a tailwind as a negative headwind, and no side without crosswind', () => {
    // EDDM 08R (true 083) with the live 270/03: almost straight behind.
    expect(runwayWind(wind(270, 3), 83)).toEqual({
      headwindKt: -3,
      crosswindKt: 0,
      crosswindFrom: null,
      gustCrosswindKt: null,
    });
  });

  it('works across north and adds the gust crosswind', () => {
    // 350 on runway 010: 20° from the left.
    expect(runwayWind(wind(350, 20, 30), 10)).toEqual({
      headwindKt: 19,
      crosswindKt: 7,
      crosswindFrom: 'left',
      gustCrosswindKt: 10,
    });
    // 120 on runway 060: 60° from the right.
    expect(runwayWind(wind(120, 10), 60)).toMatchObject({
      headwindKt: 5,
      crosswindKt: 9,
      crosswindFrom: 'right',
    });
  });

  it('cannot split a variable wind, but a calm one is zero', () => {
    expect(runwayWind(wind(null, 4), 60)).toEqual({
      headwindKt: null,
      crosswindKt: null,
      crosswindFrom: null,
      gustCrosswindKt: null,
    });
    expect(runwayWind(wind(0, 0), 60)).toMatchObject({ headwindKt: 0, crosswindKt: 0 });
  });
});
