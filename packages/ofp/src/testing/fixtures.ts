import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Test-only helpers for the captured SimBrief OFPs in fixtures/ofp. Not exported from the package. */
export const FIXTURE_DIR = resolve(import.meta.dirname, '../../../../fixtures/ofp');

export const FIXTURE_NAMES = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

/** A fresh, mutable copy of a fixture's raw JSON. */
export function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${name}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
}
