import type { z } from 'zod';
import { toLiveMetar, toLiveTaf, type LiveMetar, type LiveTaf } from './reports';
import { AwcMetar, AwcTaf } from './schema';

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

export interface WeatherClient {
  /** Latest METAR per station, keyed by ICAO. Stations without a report are simply absent. */
  fetchMetars(icaos: readonly string[]): Promise<Map<string, LiveMetar>>;
  /** Latest TAF per station, keyed by ICAO. Stations without a TAF are simply absent. */
  fetchTafs(icaos: readonly string[]): Promise<Map<string, LiveTaf>>;
}

export interface WeatherClientOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  /** Per attempt. */
  timeoutMs?: number;
  /** Pause before the single retry. */
  retryDelayMs?: number;
  log?: { warn: (obj: object, msg: string) => void };
}

const ICAO = /^[A-Z0-9]{4}$/;

/** Thrown by one attempt when a second attempt might succeed. */
class RetryableError extends Error {}

export function createWeatherClient(options: WeatherClientOptions = {}): WeatherClient {
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

    // 204: none of the stations has a report. Not an error.
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

  async function get(kind: 'metar' | 'taf', icaos: readonly string[]): Promise<unknown[]> {
    const ids = [...new Set(icaos.map((i) => i.trim().toUpperCase()))];
    const invalid = ids.filter((i) => !ICAO.test(i));
    if (invalid.length > 0) throw new RangeError(`Not ICAO codes: ${invalid.join(', ')}`);
    if (ids.length === 0) return [];

    const url = `${baseUrl}/${kind}?ids=${ids.join(',')}&format=json`;
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
  }

  /** Validates each report on its own, so one odd report does not hide the others. */
  function latestPerStation<Raw, Report extends { icao: string }>(
    entries: unknown[],
    schema: z.ZodType<Raw>,
    toReport: (raw: Raw) => Report,
    newer: (a: Report, b: Report) => boolean,
  ): Map<string, Report> {
    const byStation = new Map<string, Report>();
    for (const entry of entries) {
      const parsed = schema.safeParse(entry);
      if (!parsed.success) {
        log?.warn({ issues: parsed.error.issues }, 'Skipped an aviationweather.gov report');
        continue;
      }
      const report = toReport(parsed.data);
      const existing = byStation.get(report.icao);
      if (!existing || newer(report, existing)) byStation.set(report.icao, report);
    }
    return byStation;
  }

  return {
    async fetchMetars(icaos) {
      return latestPerStation(
        await get('metar', icaos),
        AwcMetar,
        toLiveMetar,
        (a, b) => a.observedAt > b.observedAt,
      );
    },
    async fetchTafs(icaos) {
      return latestPerStation(
        await get('taf', icaos),
        AwcTaf,
        toLiveTaf,
        (a, b) => a.issuedAt > b.issuedAt,
      );
    },
  };
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
