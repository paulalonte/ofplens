import { z } from 'zod';
import { SimbriefNotFoundError, SimbriefUpstreamError } from './errors';

export const SIMBRIEF_FETCH_URL = 'https://www.simbrief.com/api/xml.fetcher.php';

export interface SimbriefClient {
  /**
   * The pilot's most recent OFP as raw JSON v2, not yet validated (run it through parseOfp).
   * Throws SimbriefNotFoundError or SimbriefUpstreamError.
   */
  fetchLatestOfp(username: string): Promise<unknown>;
}

export interface SimbriefClientOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  /** Per attempt. SimBrief answers in well under a second; 10 s means something is wrong. */
  timeoutMs?: number;
  /** Pause before the single retry. */
  retryDelayMs?: number;
  log?: { warn: (obj: object, msg: string) => void };
}

/** SimBrief's in-band status, e.g. { fetch: { status: "Error: Unknown UserID" } }. */
const FetchStatus = z.object({ fetch: z.object({ status: z.string() }) });

/** Thrown by one attempt when a second attempt might succeed. */
class RetryableError extends Error {}

export function createSimbriefClient(options: SimbriefClientOptions = {}): SimbriefClient {
  const {
    fetch = globalThis.fetch,
    baseUrl = SIMBRIEF_FETCH_URL,
    timeoutMs = 10_000,
    retryDelayMs = 300,
    log,
  } = options;

  async function attempt(url: string, username: string): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) {
        // Already waited the full timeout; a retry would double the wait for the pilot.
        throw new SimbriefUpstreamError(`SimBrief did not answer within ${timeoutMs / 1000} s`, {
          cause: err,
        });
      }
      throw new RetryableError('Network error reaching SimBrief', { cause: err });
    }

    if (res.status >= 500) {
      await res.body?.cancel();
      throw new RetryableError(`SimBrief returned HTTP ${res.status}`);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      if (isTimeout(err)) {
        throw new SimbriefUpstreamError(`SimBrief did not answer within ${timeoutMs / 1000} s`, {
          cause: err,
        });
      }
      throw new SimbriefUpstreamError(
        `SimBrief sent a response that is not JSON (HTTP ${res.status})`,
        {
          cause: err,
        },
      );
    }

    if (res.ok) return body;

    // SimBrief reports a bad user as HTTP 400 with the reason in fetch.status.
    const status = FetchStatus.safeParse(body);
    if (res.status === 400 && status.success) {
      const reason = status.data.fetch.status.replace(/^Error:\s*/i, '');
      throw new SimbriefNotFoundError(
        `SimBrief has no flight plan for "${username}" (${reason}). ` +
          'Check the username in your SimBrief account settings.',
      );
    }
    throw new SimbriefUpstreamError(`SimBrief returned HTTP ${res.status}`);
  }

  return {
    async fetchLatestOfp(username) {
      const url = `${baseUrl}?username=${encodeURIComponent(username)}&json=v2`;
      try {
        return await attempt(url, username);
      } catch (err) {
        if (!(err instanceof RetryableError)) throw err;
        log?.warn({ err }, 'SimBrief request failed, retrying once');
      }

      await sleep(retryDelayMs);
      try {
        return await attempt(url, username);
      } catch (err) {
        if (err instanceof RetryableError) {
          throw new SimbriefUpstreamError(`${err.message} (after one retry)`, { cause: err });
        }
        throw err;
      }
    },
  };
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
