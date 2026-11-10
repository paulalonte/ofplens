import { describe, expect, it } from 'vitest';
import {
  formatAltimeter,
  formatFlightLevel,
  formatIsaDeviation,
  formatWindComponent,
} from './flight';

describe('formatFlightLevel', () => {
  it.each([
    [35000, 'FL350'],
    [28000, 'FL280'],
    [4500, 'FL045'],
    [41365, 'FL414'],
  ])('%i ft -> %s', (ft, expected) => expect(formatFlightLevel(ft)).toBe(expected));
});

describe('formatWindComponent', () => {
  it.each([
    [61, '61 kt tailwind'],
    [-6, '6 kt headwind'],
    [0, 'No wind component'],
  ])('%i -> %s', (kt, expected) => expect(formatWindComponent(kt)).toBe(expected));
});

describe('formatIsaDeviation', () => {
  it.each([
    [1, 'ISA +1'],
    [-2, 'ISA −2'],
    [0, 'ISA +0'],
  ])('%i -> %s', (c, expected) => expect(formatIsaDeviation(c)).toBe(expected));
});

describe('formatAltimeter', () => {
  it.each([
    [30.13, '1020 hPa · 30.13 inHg'],
    [29.92, '1013 hPa · 29.92 inHg'],
    [29.81, '1009 hPa · 29.81 inHg'],
  ])('%f inHg -> %s', (inHg, expected) => expect(formatAltimeter(inHg)).toBe(expected));
});
