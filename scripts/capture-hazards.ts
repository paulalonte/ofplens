/**
 * Saves the current hazard advisories from aviationweather.gov as test fixtures.
 *
 *   pnpm fixture:hazards
 *
 * International SIGMETs (worldwide), US SIGMETs and US G-AIRMETs: one request each, everything
 * currently valid. Public data; nothing personal is stored.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const FEEDS = ['isigmet', 'airsigmet', 'gairmet'] as const;

const USER_AGENT =
  'OFPLens/0.1 (flight simulation briefing tool; +https://github.com/paulalonte/ofplens)';

for (const feed of FEEDS) {
  const url = `https://aviationweather.gov/api/data/${feed}?format=json`;
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${feed}: HTTP ${res.status}`);
  const advisories = (await res.json()) as unknown[];
  const out = resolve(import.meta.dirname, '../fixtures/hazards', `${feed}.json`);
  await writeFile(out, JSON.stringify(advisories, null, 2) + '\n');
  console.log(`Saved ${advisories.length} ${feed} advisories to ${out}`);
}
