import { describe, expect, it, vi } from 'vitest';
import { createSimbriefClient } from './client';
import { SimbriefNotFoundError, SimbriefUpstreamError } from './errors';

const OFP = { fetch: { status: 'Success' }, params: { request_id: '1' } };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake fetch that plays the given outcomes in order: a Response to return, or an Error to throw. */
function fakeFetch(...outcomes: (Response | Error | 'hang')[]) {
  return vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    const next = outcomes.shift();
    if (!next) throw new Error('fake fetch called more often than expected');
    if (next instanceof Error) return Promise.reject(next);
    if (next === 'hang') {
      // Like real fetch: never resolves on its own, rejects when the signal aborts.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
      });
    }
    return Promise.resolve(next);
  });
}

function client(fetch: ReturnType<typeof fakeFetch>, timeoutMs = 1000) {
  return createSimbriefClient({ fetch, timeoutMs, retryDelayMs: 0 });
}

const networkError = () => new TypeError('fetch failed', { cause: new Error('ECONNRESET') });

describe('SimBrief client', () => {
  it('returns the raw OFP JSON for a username', async () => {
    const fetch = fakeFetch(json(OFP));

    await expect(client(fetch).fetchLatestOfp('jetpilot')).resolves.toEqual(OFP);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://www.simbrief.com/api/xml.fetcher.php?username=jetpilot&json=v2');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('URL-encodes the username', async () => {
    const fetch = fakeFetch(json(OFP));
    await client(fetch).fetchLatestOfp('a b&c=d');
    expect(fetch.mock.calls[0]![0]).toContain('username=a%20b%26c%3Dd&json=v2');
  });

  it('turns SimBrief’s "Unknown UserID" into a 404 the pilot can act on, without retrying', async () => {
    const fetch = fakeFetch(json({ fetch: { userid: '', status: 'Error: Unknown UserID' } }, 400));

    const err: unknown = await client(fetch)
      .fetchLatestOfp('nobody')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SimbriefNotFoundError);
    expect(err).toMatchObject({ statusCode: 404, code: 'SIMBRIEF_NOT_FOUND' });
    expect((err as Error).message).toBe(
      'SimBrief has no flight plan for "nobody" (Unknown UserID). ' +
        'Check the username in your SimBrief account settings.',
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('retries once after a network error and returns the second answer', async () => {
    const fetch = fakeFetch(networkError(), json(OFP));
    await expect(client(fetch).fetchLatestOfp('jetpilot')).resolves.toEqual(OFP);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries once after a 5xx and returns the second answer', async () => {
    const fetch = fakeFetch(json({}, 503), json(OFP));
    await expect(client(fetch).fetchLatestOfp('jetpilot')).resolves.toEqual(OFP);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up with a 502 after two network errors', async () => {
    const fetch = fakeFetch(networkError(), networkError());

    const err: unknown = await client(fetch)
      .fetchLatestOfp('jetpilot')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SimbriefUpstreamError);
    expect(err).toMatchObject({ statusCode: 502, code: 'SIMBRIEF_UNAVAILABLE' });
    expect((err as Error).message).toBe('Network error reaching SimBrief (after one retry)');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up with a 502 after two 5xx answers', async () => {
    const fetch = fakeFetch(json({}, 500), json({}, 502));
    await expect(client(fetch).fetchLatestOfp('jetpilot')).rejects.toThrow(
      'SimBrief returned HTTP 502 (after one retry)',
    );
  });

  it('times out after the configured time and does not retry', async () => {
    const fetch = fakeFetch('hang');

    const started = Date.now();
    const err: unknown = await client(fetch, 50)
      .fetchLatestOfp('jetpilot')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SimbriefUpstreamError);
    expect((err as Error).message).toBe('SimBrief did not answer within 0.05 s');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('reports a non-JSON answer as unavailable, without retrying', async () => {
    const fetch = fakeFetch(new Response('<html>maintenance</html>', { status: 200 }));
    await expect(client(fetch).fetchLatestOfp('jetpilot')).rejects.toThrow(
      'SimBrief sent a response that is not JSON (HTTP 200)',
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('reports other 4xx answers as unavailable', async () => {
    const fetch = fakeFetch(json({ message: 'slow down' }, 429));
    await expect(client(fetch).fetchLatestOfp('jetpilot')).rejects.toBeInstanceOf(
      SimbriefUpstreamError,
    );
  });

  it('logs the first failure before retrying', async () => {
    const warn = vi.fn();
    const fetch = fakeFetch(networkError(), json(OFP));

    await createSimbriefClient({ fetch, retryDelayMs: 0, log: { warn } }).fetchLatestOfp('x');

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'SimBrief request failed, retrying once',
    );
  });
});
