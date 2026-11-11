import { describe, expect, it } from 'vitest';
import {
  intensityMismatches,
  isBacked,
  metarNumbers,
  summaryNumbers,
  weatherCodes,
  weatherMentions,
} from './wx';

describe('weather in reports', () => {
  it('reads weather groups, CB clouds and gusts', () => {
    const codes = weatherCodes(
      'METAR ENGM 111820Z VRB01KT 1700 -FZDZ BR VV003 M00/M01 Q0995 TEMPO 0700 FZFG',
    );
    expect([...codes]).toEqual(expect.arrayContaining(['FZ', 'DZ', 'FZDZ', 'BR', 'FG', 'FZFG']));
    expect(weatherCodes('LEPA 091900Z 24016G28KT 9999 FEW030CB')).toEqual(new Set(['GUST', 'CB']));
    // Words that look like codes are not weather.
    expect(weatherCodes('EDDB 091320Z AUTO 10005KT 9999 BKN009 BECMG NOSIG')).toEqual(new Set());
  });
});

describe('weather words in prose', () => {
  it('finds the longest phrase and skips negated ones', () => {
    expect(weatherMentions('Light freezing rain, then rain showers.').map((m) => m.label)).toEqual([
      'freezing rain',
      'showers',
      'rain',
    ]);
    expect(
      weatherMentions('No thunderstorms or icing expected; light rain at EDDM.').map(
        (m) => m.label,
      ),
    ).toEqual(['rain']);
    expect(weatherMentions('Nil significant weather.')).toEqual([]);
  });

  it('is backed by a matching code, or by a route hazard', () => {
    const [freezingRain] = weatherMentions('freezing rain');
    expect(isBacked(freezingRain!, ['EDDF 091920Z 04006KT 9999 -RA BKN025'], [])).toBe(false);
    expect(isBacked(freezingRain!, ['EDDF 091920Z 04006KT 2000 FZRA BKN005'], [])).toBe(true);
    const [turbulence] = weatherMentions('severe turbulence');
    expect(isBacked(turbulence!, ['EGLL 111820Z 36004KT 9999 NCD'], [])).toBe(false);
    expect(isBacked(turbulence!, ['EGLL 111820Z 36004KT 9999 NCD'], ['turbulence'])).toBe(true);
    expect(isBacked(turbulence!, [], ['thunderstorm'])).toBe(true);
  });
});

describe('intensity', () => {
  it('matches light, moderate and heavy to -, none and +', () => {
    const metar = 'LEMD 111730Z 14011KT 6000 RA SCT010 BKN035TCU';
    expect(intensityMismatches('6 km visibility in light rain', metar)).toEqual([
      '"light rain", but the METAR has RA',
    ]);
    expect(intensityMismatches('6 km visibility in rain', metar)).toEqual([]);
    expect(
      intensityMismatches('light freezing drizzle', 'ENGM 111820Z VRB01KT 1700 -FZDZ BR'),
    ).toEqual([]);
    expect(
      intensityMismatches('heavy snow', 'BIKF 111850Z 36028G40KT 0800 +SN DRSN VV004'),
    ).toEqual([]);
  });
});

describe('numbers', () => {
  it('reads wind, heights, visibility and pressure from a summary', () => {
    expect(
      summaryNumbers(
        'Wind 240 at 16 kt gusting 28 kt, 6 km visibility, broken cloud at 1,200 ft, QNH 1010 hPa.',
      ),
    ).toEqual({
      wind: { calm: false, variable: false, directionDeg: 240, speedKt: 16, gustKt: 28 },
      heightsFt: [1200],
      visibilitiesM: [{ metres: 6000, orMore: false, text: '6 km' }],
      pressuresHpa: [{ hpa: 1010, text: '1010 hpa' }],
    });
    expect(summaryNumbers('Calm, 3/4 SM in mist.').wind?.calm).toBe(true);
    expect(summaryNumbers('1.06 sm visibility').visibilitiesM[0]!.metres).toBeCloseTo(1706, 0);
    expect(summaryNumbers('visibility 0.75 SM').visibilitiesM[0]!.metres).toBeCloseTo(1207, 0);
    expect(summaryNumbers('Wind 300/22G31 kt.').wind).toMatchObject({
      directionDeg: 300,
      speedKt: 22,
      gustKt: 31,
    });
  });

  it('reads heights, visibility and pressure from a METAR, not its remarks', () => {
    const numbers = metarNumbers(
      'KSFO 091856Z 00000KT 3/4SM R28R/1400VP6000FT BR FEW001 BKN002 14/14 A3013 RMK AO2 SLP202',
    );
    expect([...numbers.heightsFt].sort((a, b) => a - b)).toEqual([100, 200, 1400, 6000]);
    expect(numbers.visibilitiesM[0]!.metres).toBeCloseTo(1207, 0);
    expect(numbers.pressuresHpa[0]).toBeCloseTo(1020.3, 1);
    const cavok = metarNumbers('BIKF 111850Z 05015KT CAVOK M01/M08 Q1022');
    expect(cavok.visibilitiesM).toEqual([{ metres: 10000, orMore: true }]);
    expect([...cavok.heightsFt]).toEqual([5000]);
  });
});
