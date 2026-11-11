import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Test-only: real aviationweather.gov responses captured by `pnpm fixture:weather`. */
const DIR = resolve(import.meta.dirname, '../../../../fixtures/weather');

export function loadWeatherFixture(kind: 'metar' | 'taf'): Record<string, unknown>[] {
  return JSON.parse(readFileSync(resolve(DIR, `${kind}.json`), 'utf8')) as Record<
    string,
    unknown
  >[];
}

const HAZARDS_DIR = resolve(import.meta.dirname, '../../../../fixtures/hazards');

/** Test-only: real hazard feeds captured by `pnpm fixture:hazards`. */
export function loadHazardFixture(feed: 'isigmet' | 'airsigmet' | 'gairmet'): unknown[] {
  return JSON.parse(readFileSync(resolve(HAZARDS_DIR, `${feed}.json`), 'utf8')) as unknown[];
}
