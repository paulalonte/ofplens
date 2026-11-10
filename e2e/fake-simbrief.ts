/**
 * A stand-in for SimBrief's fetcher, so end-to-end runs never depend on SimBrief being up.
 * It answers like the real one: the latest OFP as JSON v2, or HTTP 400 for an unknown user.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { FAKE_SIMBRIEF_PORT } from './ports';

/** Which captured OFP each test username "generated" most recently. */
const LATEST_PLAN: Record<string, string> = {
  e2epilot: 'eddb-eddm-c750-kgs',
};

const fixture = (name: string) =>
  readFile(resolve(import.meta.dirname, '../fixtures/ofp', `${name}.json`), 'utf8');

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200).end('ok');
      return;
    }
    if (url.pathname !== '/api/xml.fetcher.php' || url.searchParams.get('json') !== 'v2') {
      res.writeHead(404).end();
      return;
    }

    const plan = LATEST_PLAN[url.searchParams.get('username') ?? ''];
    if (!plan) {
      res
        .writeHead(400, { 'content-type': 'application/json' })
        .end(JSON.stringify({ fetch: { userid: '', status: 'Error: Unknown UserID' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(await fixture(plan));
  })().catch((err: unknown) => {
    console.error(err);
    res.writeHead(500).end();
  });
});

server.listen(FAKE_SIMBRIEF_PORT, '127.0.0.1', () => {
  console.log(`Fake SimBrief on http://127.0.0.1:${FAKE_SIMBRIEF_PORT}`);
});
