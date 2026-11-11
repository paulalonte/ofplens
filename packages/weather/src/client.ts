import type { z } from 'zod';
import { toLiveMetar, toLiveTaf, type LiveMetar, type LiveTaf } from './reports';
import { AwcMetar, AwcTaf } from './schema';
import { createAwcRequest, type AwcRequestOptions } from './http';

export { AVIATION_WEATHER_URL, USER_AGENT, WeatherUnavailableError } from './http';

export interface WeatherClient {
  /** Latest METAR per station, keyed by ICAO. Stations without a report are simply absent. */
  fetchMetars(icaos: readonly string[]): Promise<Map<string, LiveMetar>>;
  /** Latest TAF per station, keyed by ICAO. Stations without a TAF are simply absent. */
  fetchTafs(icaos: readonly string[]): Promise<Map<string, LiveTaf>>;
}

export type WeatherClientOptions = AwcRequestOptions;

const ICAO = /^[A-Z0-9]{4}$/;

export function createWeatherClient(options: WeatherClientOptions = {}): WeatherClient {
  const { log } = options;
  const request = createAwcRequest(options);

  async function get(kind: 'metar' | 'taf', icaos: readonly string[]): Promise<unknown[]> {
    const ids = [...new Set(icaos.map((i) => i.trim().toUpperCase()))];
    const invalid = ids.filter((i) => !ICAO.test(i));
    if (invalid.length > 0) throw new RangeError(`Not ICAO codes: ${invalid.join(', ')}`);
    if (ids.length === 0) return [];
    return request(`${kind}?ids=${ids.join(',')}&format=json`);
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
