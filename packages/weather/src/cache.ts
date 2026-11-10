import type { WeatherClient } from './client';
import type { LiveMetar, LiveTaf } from './reports';

/**
 * Remembers each station's latest METAR and TAF for a while (5 minutes by default), so
 * refreshing again, or several plans sharing airports, do not call aviationweather.gov again.
 * Only stations missing or expired are requested; "no report" is remembered too.
 * In memory, per API process: a restart simply starts empty.
 */
export function createCachedWeatherClient(
  client: WeatherClient,
  { ttlMs = 5 * 60_000, now = () => Date.now() }: { ttlMs?: number; now?: () => number } = {},
): WeatherClient {
  function cached<Report>(fetchFresh: (icaos: readonly string[]) => Promise<Map<string, Report>>) {
    const entries = new Map<string, { report: Report | null; at: number }>();

    return async (icaos: readonly string[]): Promise<Map<string, Report>> => {
      const wanted = [...new Set(icaos.map((i) => i.trim().toUpperCase()))];
      const stale = wanted.filter((icao) => {
        const entry = entries.get(icao);
        return !entry || now() - entry.at >= ttlMs;
      });

      if (stale.length > 0) {
        const fresh = await fetchFresh(stale);
        const at = now();
        for (const icao of stale) entries.set(icao, { report: fresh.get(icao) ?? null, at });
      }

      const result = new Map<string, Report>();
      for (const icao of wanted) {
        const report = entries.get(icao)?.report;
        if (report) result.set(icao, report);
      }
      return result;
    };
  }

  return {
    fetchMetars: cached<LiveMetar>((icaos) => client.fetchMetars(icaos)),
    fetchTafs: cached<LiveTaf>((icaos) => client.fetchTafs(icaos)),
  };
}
