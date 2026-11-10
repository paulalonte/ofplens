/**
 * Saves current METARs and TAFs from aviationweather.gov as test fixtures.
 *
 *   pnpm fixture:weather
 *
 * A spread of airports so the decoder sees metres and statute miles, CAVOK, gusts, variable
 * wind and every flight category. Public data; nothing personal is stored.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const STATIONS = [
  // Europe: metres, CAVOK, Q-hPa
  'EDDB',
  'EDDM',
  'EDDF',
  'EDDP',
  'LSZH',
  'LEPA',
  'EGLL',
  'LFPG',
  'EHAM',
  'LOWW',
  'ENGM',
  'BIKF',
  // North America: statute miles, A-inHg
  'KSFO',
  'KJFK',
  'KEWR',
  'KORD',
  'KDEN',
  'KSEA',
  'PANC',
  'CYYZ',
  // Elsewhere
  'RJTT',
  'YSSY',
  'OMDB',
  'VHHH',
];

const USER_AGENT =
  'OFPLens/0.1 (flight simulation briefing tool; +https://github.com/paulalonte/ofplens)';

for (const kind of ['metar', 'taf'] as const) {
  const url = `https://aviationweather.gov/api/data/${kind}?ids=${STATIONS.join(',')}&format=json`;
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${kind}: HTTP ${res.status}`);
  const reports = (await res.json()) as unknown[];
  const out = resolve(import.meta.dirname, '../fixtures/weather', `${kind}.json`);
  await writeFile(out, JSON.stringify(reports, null, 2) + '\n');
  console.log(`Saved ${reports.length} ${kind.toUpperCase()}s to ${out}`);
}
