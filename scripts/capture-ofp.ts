/**
 * Fetches your latest SimBrief OFP (JSON v2), removes personal identifiers and saves it as a
 * test fixture.
 *
 *   pnpm fixture:capture <name>      e.g. pnpm fixture:capture eddb-eddm-c750-kgs
 *
 * Reads SIMBRIEF_PILOT_ID from the root .env. The pilot ID is replaced everywhere with
 * 0000000, and the script refuses to write a file that still contains it.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const REDACTED_ID = '0000000';

const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('Usage: pnpm fixture:capture <name>   (lowercase letters, digits and dashes)');
  process.exit(1);
}

const pilotId = process.env.SIMBRIEF_PILOT_ID;
if (!pilotId || !/^\d+$/.test(pilotId)) {
  console.error('Set SIMBRIEF_PILOT_ID in the root .env (your SimBrief Pilot ID, digits only).');
  process.exit(1);
}

const url = `https://www.simbrief.com/api/xml.fetcher.php?userid=${pilotId}&json=v2`;
const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
const raw = await res.text();
if (!res.ok) {
  console.error(`SimBrief returned HTTP ${res.status}: ${raw.slice(0, 200)}`);
  process.exit(1);
}

// Replace the pilot ID wherever it appears, including inside longer strings.
const redacted = JSON.stringify(JSON.parse(raw), null, 2).replaceAll(pilotId, REDACTED_ID);
if (redacted.includes(pilotId)) throw new Error('Pilot ID still present after redaction');

const ofp = JSON.parse(redacted) as {
  params: { request_id: string; units: string };
  origin: { icao_code: string };
  destination: { icao_code: string };
  alternate: unknown[];
};

const dir = resolve(import.meta.dirname, '../fixtures/ofp');

// SimBrief only serves the most recent plan: refuse to save the same one twice.
for (const file of await readdir(dir)) {
  if (!file.endsWith('.json')) continue;
  const existing = JSON.parse(await readFile(resolve(dir, file), 'utf8')) as typeof ofp;
  if (existing.params.request_id === ofp.params.request_id) {
    console.error(
      `Request ${ofp.params.request_id} is already saved as ${file}. ` +
        'Generate a new plan on SimBrief first.',
    );
    process.exit(1);
  }
}

const out = resolve(dir, `${name}.json`);
await writeFile(out, redacted + '\n');

console.log(
  `Saved ${out}\n` +
    `  ${ofp.origin.icao_code} -> ${ofp.destination.icao_code}, units ${ofp.params.units}, ` +
    `${ofp.alternate.length} alternate(s), request ${ofp.params.request_id}`,
);
