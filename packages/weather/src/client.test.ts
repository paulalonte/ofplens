import { describe, expect, it, vi } from 'vitest';
import { createWeatherClient, USER_AGENT, WeatherUnavailableError } from './client';
import { loadWeatherFixture } from './testing/fixtures';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Plays the given outcomes in order: a Response, an Error to throw, or 'hang' until aborted. */
function fakeFetch(...outcomes: (Response | Error | 'hang')[]) {
  return vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    const next = outcomes.shift();
    if (!next) throw new Error('fake fetch called more often than expected');
    if (next instanceof Error) return Promise.reject(next);
    if (next === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
      });
    }
    return Promise.resolve(next);
  });
}

const client = (fetch: ReturnType<typeof fakeFetch>, extra = {}) =>
  createWeatherClient({ fetch, retryDelayMs: 0, timeoutMs: 1000, ...extra });

const networkError = () => new TypeError('fetch failed');

/** One METAR as aviationweather.gov sends it, with the quirks we must handle. */
const metar = (overrides: Record<string, unknown> = {}) => ({
  icaoId: 'KDEN',
  obsTime: 1794300780, // 2026-11-10T08:53:00Z, as in the raw text
  reportTime: '2026-11-10T08:53:00.000Z',
  rawOb: 'METAR KDEN 100853Z VRB03G15KT 10SM FEW120 M02/M09 A3012',
  fltCat: 'VFR',
  wdir: 'VRB',
  wspd: 3,
  wgst: 15,
  visib: '10+',
  clouds: [{ cover: 'FEW', base: 12000 }],
  temp: -2,
  dewp: -9,
  altim: 1019.6,
  ...overrides,
});

describe('weather client: METARs', () => {
  it('asks for several stations in one request, identifying itself', async () => {
    const fetch = fakeFetch(json([]));

    await client(fetch).fetchMetars(['eddb', 'EDDM', 'EDDB', ' eddf ']);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://aviationweather.gov/api/data/metar?ids=EDDB,EDDM,EDDF&format=json');
    expect(new Headers(init?.headers).get('user-agent')).toBe(USER_AGENT);
    expect(USER_AGENT).not.toMatch(/@/); // no personal contact details
  });

  it('turns a report into our shape: ISO time, variable wind, "10+" visibility, gusts', async () => {
    const metars = await client(fakeFetch(json([metar()]))).fetchMetars(['KDEN']);

    expect(metars.get('KDEN')).toEqual({
      icao: 'KDEN',
      observedAt: '2026-11-10T08:53:00Z',
      raw: 'METAR KDEN 100853Z VRB03G15KT 10SM FEW120 M02/M09 A3012',
      reportedCategory: 'VFR',
      wind: { directionDeg: null, variable: true, speedKt: 3, gustKt: 15 },
      visibility: { sm: 10, orMore: true },
      clouds: [{ cover: 'FEW', baseFt: 12000 }],
      temperatureC: -2,
      dewpointC: -9,
      altimeterHpa: 1019.6,
    });
  });

  it('keeps missing values as null instead of failing', async () => {
    const sparse = { icaoId: 'EDDB', obsTime: 1794298800, rawOb: 'METAR EDDB 100820Z AUTO NIL' };

    const metars = await client(fakeFetch(json([sparse]))).fetchMetars(['EDDB']);

    expect(metars.get('EDDB')).toMatchObject({
      reportedCategory: null,
      wind: null,
      visibility: null,
      clouds: [],
      temperatureC: null,
    });
  });

  it('reads every captured real METAR (24 airports, all four categories)', async () => {
    const fixture = loadWeatherFixture('metar');
    const warn = vi.fn();

    const metars = await client(fakeFetch(json(fixture)), { log: { warn } }).fetchMetars(
      fixture.map((m) => m.icaoId as string),
    );

    expect(warn).not.toHaveBeenCalled();
    expect(metars.size).toBe(24);
    expect(new Set([...metars.values()].map((m) => m.reportedCategory))).toEqual(
      new Set(['VFR', 'MVFR', 'IFR', 'LIFR']),
    );
    for (const [icao, report] of metars) {
      expect(report.icao).toBe(icao);
      expect(report.raw).toMatch(new RegExp(`^METAR ${icao} `));
      expect(report.observedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    }
  });

  it('keeps only the latest report per station', async () => {
    const older = metar({ obsTime: 1794296000, rawOb: 'METAR KDEN older' });
    const newer = metar({ obsTime: 1794300780, rawOb: 'METAR KDEN newer' });

    const metars = await client(fakeFetch(json([newer, older]))).fetchMetars(['KDEN']);

    expect(metars.get('KDEN')?.raw).toBe('METAR KDEN newer');
  });

  it('skips a malformed report but keeps the others', async () => {
    const warn = vi.fn();
    const broken = { icaoId: 'EDDB', obsTime: 'yesterday' };

    const metars = await client(fakeFetch(json([broken, metar()])), { log: { warn } }).fetchMetars([
      'EDDB',
      'KDEN',
    ]);

    expect([...metars.keys()]).toEqual(['KDEN']);
    expect(warn).toHaveBeenCalledWith(expect.anything(), 'Skipped an aviationweather.gov report');
  });

  it('treats HTTP 204 as "no reports", not as an error', async () => {
    const fetch = fakeFetch(new Response(null, { status: 204 }));

    await expect(client(fetch).fetchMetars(['ZZZZ'])).resolves.toEqual(new Map());
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('makes no request for an empty list and rejects things that are not ICAO codes', async () => {
    const fetch = fakeFetch();

    await expect(client(fetch).fetchMetars([])).resolves.toEqual(new Map());
    await expect(client(fetch).fetchMetars(['EDDB', 'nope!'])).rejects.toThrow(RangeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('weather client: TAFs', () => {
  it('reads every captured real TAF with ISO issue and validity times', async () => {
    const fixture = loadWeatherFixture('taf');

    const tafs = await client(fakeFetch(json(fixture))).fetchTafs(
      fixture.map((t) => t.icaoId as string),
    );

    expect(tafs.size).toBe(24);
    for (const [icao, taf] of tafs) {
      expect(taf.raw).toMatch(new RegExp(`^TAF (AMD |COR )?${icao} `));
      expect(taf.issuedAt).toMatch(/Z$/);
      expect(taf.validFrom < taf.validTo).toBe(true);
    }
  });

  it('turns a TAF into our shape', async () => {
    const taf = {
      icaoId: 'EDDB',
      issueTime: '2026-11-10T05:00:00.000Z',
      validTimeFrom: 1794290400,
      validTimeTo: 1794376800,
      rawTAF: 'TAF EDDB 100500Z 1006/1106 15004KT 4000 BR BKN005',
    };

    const tafs = await client(fakeFetch(json([taf]))).fetchTafs(['EDDB']);

    expect(tafs.get('EDDB')).toEqual({
      icao: 'EDDB',
      issuedAt: '2026-11-10T05:00:00Z',
      validFrom: '2026-11-10T06:00:00Z',
      validTo: '2026-11-11T06:00:00Z',
      raw: 'TAF EDDB 100500Z 1006/1106 15004KT 4000 BR BKN005',
    });
  });
});

describe('weather client: failures', () => {
  it('retries once after a network error', async () => {
    const fetch = fakeFetch(networkError(), json([metar()]));
    await expect(client(fetch).fetchMetars(['KDEN'])).resolves.toHaveProperty('size', 1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries once after a 5xx', async () => {
    const fetch = fakeFetch(json({}, 503), json([metar()]));
    await expect(client(fetch).fetchMetars(['KDEN'])).resolves.toHaveProperty('size', 1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after a second failure', async () => {
    const fetch = fakeFetch(networkError(), json({}, 502));

    const err: unknown = await client(fetch)
      .fetchMetars(['KDEN'])
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WeatherUnavailableError);
    expect((err as Error).message).toBe('aviationweather.gov returned HTTP 502 (after one retry)');
  });

  it('times out without retrying', async () => {
    const fetch = fakeFetch('hang');

    await expect(client(fetch, { timeoutMs: 50 }).fetchMetars(['KDEN'])).rejects.toThrow(
      'aviationweather.gov did not answer within 0.05 s',
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ['a rate limit (429)', json({ error: 'slow down' }, 429), 'HTTP 429'],
    ['a body that is not JSON', new Response('<html>down</html>', { status: 200 }), 'not JSON'],
    ['JSON that is not a list', json({ error: 'oops' }), 'unexpected response'],
  ])('reports %s as unavailable without retrying', async (_, response, message) => {
    const fetch = fakeFetch(response);

    await expect(client(fetch).fetchMetars(['KDEN'])).rejects.toThrow(message);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
