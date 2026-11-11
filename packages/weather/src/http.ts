export const AVIATION_WEATHER_URL = 'https://aviationweather.gov/api/data';

/** aviationweather.gov asks clients to identify themselves; nothing personal goes here. */
export const USER_AGENT =
  'OFPLens/0.1 (flight simulation briefing tool; +https://github.com/paulalonte/ofplens)';

/** aviationweather.gov could not be reached or answered with something unusable. */
export class WeatherUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WeatherUnavailableError';
  }
}

export interface AwcRequestOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  /** Per attempt. */
  timeoutMs?: number;
  /** Pause before the single retry. */
  retryDelayMs?: number;
  log?: { warn: (obj: object, msg: string) => void };
}

/** Thrown by one attempt when a second attempt might succeed. */
class RetryableError extends Error {}

/**
 * GETs a JSON array from the Data API (`path` is e.g. "metar?ids=EDDB&format=json"), retrying
 * once on network errors and 5xx. 204 is an empty list. Anything else unusable throws
 * WeatherUnavailableError.
 */
export function createAwcRequest(
  options: AwcRequestOptions = {},
): (path: string) => Promise<unknown[]> {
  const {
    fetch = globalThis.fetch,
    baseUrl = AVIATION_WEATHER_URL,
    timeoutMs = 10_000,
    retryDelayMs = 300,
    log,
  } = options;

  async function attempt(url: string): Promise<unknown[]> {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) {
        throw new WeatherUnavailableError(
          `aviationweather.gov did not answer within ${timeoutMs / 1000} s`,
          { cause: err },
        );
      }
      throw new RetryableError('Network error reaching aviationweather.gov', { cause: err });
    }

    // 204: nothing matches (no report, no advisory). Not an error.
    if (res.status === 204) return [];
    if (res.status >= 500) {
      await res.body?.cancel();
      throw new RetryableError(`aviationweather.gov returned HTTP ${res.status}`);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new WeatherUnavailableError(`aviationweather.gov returned HTTP ${res.status}`);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new WeatherUnavailableError('aviationweather.gov sent a response that is not JSON', {
        cause: err,
      });
    }
    if (!Array.isArray(body)) {
      throw new WeatherUnavailableError('aviationweather.gov sent an unexpected response');
    }
    return body as unknown[];
  }

  return async (path) => {
    const url = `${baseUrl}/${path}`;
    try {
      return await attempt(url);
    } catch (err) {
      if (!(err instanceof RetryableError)) throw err;
      log?.warn({ err }, 'aviationweather.gov request failed, retrying once');
    }
    await sleep(retryDelayMs);
    try {
      return await attempt(url);
    } catch (err) {
      if (err instanceof RetryableError) {
        throw new WeatherUnavailableError(`${err.message} (after one retry)`, { cause: err });
      }
      throw err;
    }
  };
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
