/**
 * Stand-ins for the outside services, so end-to-end runs never depend on them being up:
 *
 * - SimBrief's fetcher: the latest OFP as JSON v2, or HTTP 400 for an unknown user.
 * - aviationweather.gov's Data API: METARs and TAFs from fixtures/weather (real reports
 *   captured earlier), filtered by `ids`; HTTP 204 when none of the stations has one. The
 *   hazard feeds from fixtures/hazards, plus one made-up SIGMET on the e2e route.
 * - Claude's Messages API (the API's ANTHROPIC_BASE_URL): first asks for all three briefing
 *   tools, then writes a briefing from their results, citing real report ids so it passes the
 *   guardrails. No key and no cost.
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

    // Claude
    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      json(200, fakeClaudeReply(JSON.parse(await readBody(req)) as MessagesRequest));
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

    // aviationweather.gov hazard feeds: the captured ones, plus a thunderstorm SIGMET over the
    // EDDB → EDDM route (around PIKIB) valid around now, since the plan is flown "now".
    const hazards = /^\/api\/data\/(isigmet|airsigmet|gairmet)$/.exec(url.pathname);
    if (hazards && url.searchParams.get('format') === 'json') {
      const captured = (await readJson(`hazards/${hazards[1]}.json`)) as unknown[];
      json(200, hazards[1] === 'isigmet' ? [...captured, sigmetOverPikib()] : captured);
      return;
    }

    res.writeHead(404).end();
  })().catch((err: unknown) => {
    console.error(err);
    res.writeHead(500).end();
  });
});

/** Embedded thunderstorms up to FL380 around PIKIB, from an hour ago to four hours ahead. */
function sigmetOverPikib() {
  const hour = Math.floor(Date.now() / 3_600_000) * 3600;
  return {
    icaoId: 'EDZZ',
    firId: 'EDUU',
    firName: 'EDUU RHEIN UIR',
    validTimeFrom: hour - 3600,
    validTimeTo: hour + 4 * 3600,
    seriesId: 'E2E',
    hazard: 'TS',
    qualifier: 'EMBD',
    base: null,
    top: 38000,
    geom: 'AREA',
    coords: [
      { lon: 13.5, lat: 50.8 },
      { lon: 13.8, lat: 50.8 },
      { lon: 13.8, lat: 51.0 },
      { lon: 13.5, lat: 51.0 },
    ],
    rawSigmet: 'EDUU SIGMET E2E VALID EDZZ- EDUU RHEIN UIR EMBD TS FCST TOP FL380 (made up)',
  };
}

const readBody = async (req: AsyncIterable<Buffer>) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

interface Block {
  type: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  content?: string | { type: string; text?: string }[];
}
interface MessagesRequest {
  model: string;
  messages: { role: string; content: string | Block[] }[];
}
interface ToolStation {
  role: 'origin' | 'destination' | 'alternate';
  icao: string;
  metar: { reportId: string; flightCategory: string | null } | null;
  changedSinceDispatch?: boolean;
}

const BRIEFING_TOOLS = ['get_flight_plan', 'get_planned_weather', 'get_weather'];

/** One Messages API reply: call the tools, or answer from what they returned. */
function fakeClaudeReply(request: MessagesRequest) {
  const blocks = request.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
  const toolNames = new Map(
    blocks.filter((b) => b.type === 'tool_use').map((b) => [b.id ?? '', b.name ?? '']),
  );
  const results = new Map<string, unknown>();
  for (const b of blocks.filter((x) => x.type === 'tool_result')) {
    const text =
      typeof b.content === 'string'
        ? b.content
        : (b.content ?? []).map((c) => c.text ?? '').join('');
    results.set(toolNames.get(b.tool_use_id ?? '') ?? '', JSON.parse(text));
  }

  const message = (content: unknown[], stopReason: string) => ({
    id: `msg_fake_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: request.model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 5000, output_tokens: 500 },
  });

  if (results.size === 0) {
    return message(
      BRIEFING_TOOLS.map((name, i) => ({ type: 'tool_use', id: `toolu_${i}`, name, input: {} })),
      'tool_use',
    );
  }

  const planned = (results.get('get_planned_weather') as { stations: ToolStation[] }).stations;
  const live = (results.get('get_weather') as { stations: ToolStation[] }).stations;
  const conditions = (role: ToolStation['role']) => {
    const now = live.find((s) => s.role === role);
    const station = now?.metar ? now : planned.find((s) => s.role === role);
    if (!station?.metar) return null;
    return {
      icao: station.icao,
      flightCategory: station.metar.flightCategory,
      summary: `Scripted summary for ${station.icao}.`,
      changedSinceDispatch: station === now && (now.changedSinceDispatch ?? false),
      sourceReportId: station.metar.reportId,
    };
  };
  const briefing = {
    headline: 'Scripted briefing from the fake Claude',
    overallRisk: 'moderate',
    departure: conditions('origin'),
    destination: conditions('destination'),
    alternate: conditions('alternate'),
    enrouteHazards: [],
    pilotNotes: ['This note comes from the end-to-end fake.'],
  };
  return message([{ type: 'text', text: JSON.stringify(briefing) }], 'end_turn');
}

server.listen(FAKE_UPSTREAMS_PORT, '127.0.0.1', () => {
  console.log(
    `Fake SimBrief, aviationweather.gov and Claude on http://127.0.0.1:${FAKE_UPSTREAMS_PORT}`,
  );
});
