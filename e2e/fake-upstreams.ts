/**
 * Stand-ins for the outside services, so end-to-end runs never depend on them being up:
 *
 * - SimBrief's fetcher: the latest OFP as JSON v2, or HTTP 400 for an unknown user.
 * - aviationweather.gov's Data API: METARs and TAFs from fixtures/weather (real reports
 *   captured earlier), filtered by `ids`; HTTP 204 when none of the stations has one.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { FAKE_UPSTREAMS_PORT } from './ports';

/** Which captured OFP each test username "generated" most recently. */
const LATEST_PLAN: Record<string, string> = {
  e2epilot: 'eddb-eddm-c750-kgs',
};

const fixtures = resolve(import.meta.dirname, '../fixtures');
const readJson = async (path: string) =>
  JSON.parse(await readFile(resolve(fixtures, path), 'utf8')) as unknown;

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status: number, body: unknown) =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

    if (url.pathname === '/health') {
      res.writeHead(200).end('ok');
      return;
    }

    // SimBrief
    if (url.pathname === '/api/xml.fetcher.php' && url.searchParams.get('json') === 'v2') {
      const plan = LATEST_PLAN[url.searchParams.get('username') ?? ''];
      if (!plan) {
        json(400, { fetch: { userid: '', status: 'Error: Unknown UserID' } });
        return;
      }
      json(200, await readJson(`ofp/${plan}.json`));
      return;
    }

    // aviationweather.gov
    const weather = /^\/api\/data\/(metar|taf)$/.exec(url.pathname);
    if (weather && url.searchParams.get('format') === 'json') {
      const ids = (url.searchParams.get('ids') ?? '').split(',');
      const all = (await readJson(`weather/${weather[1]}.json`)) as { icaoId: string }[];
      const reports = all.filter((r) => ids.includes(r.icaoId));
      if (reports.length === 0) {
        res.writeHead(204).end();
        return;
      }
      json(200, reports);
      return;
    }

    res.writeHead(404).end();
  })().catch((err: unknown) => {
    console.error(err);
    res.writeHead(500).end();
  });
});

server.listen(FAKE_UPSTREAMS_PORT, '127.0.0.1', () => {
  console.log(`Fake SimBrief and aviationweather.gov on http://127.0.0.1:${FAKE_UPSTREAMS_PORT}`);
});
