import { createAwcRequest, type AwcRequestOptions } from '../http';
import { HAZARD_SOURCES, parseAdvisories, type Advisory, type HazardSource } from './advisory';

export interface HazardFeeds {
  advisories: Advisory[];
  /** Feeds that could not be read this time; their advisories are missing, not absent. */
  unavailable: HazardSource[];
}

export interface HazardClient {
  /** Everything currently valid from the three feeds: one request each, in parallel. */
  fetchAdvisories(): Promise<HazardFeeds>;
}

/**
 * International SIGMETs (worldwide), US SIGMETs and US G-AIRMETs from aviationweather.gov.
 * One feed failing leaves it out (and says so); only all three failing throws
 * WeatherUnavailableError.
 */
export function createHazardClient(options: AwcRequestOptions = {}): HazardClient {
  const request = createAwcRequest(options);

  return {
    async fetchAdvisories() {
      const results = await Promise.allSettled(
        HAZARD_SOURCES.map(async (source) =>
          parseAdvisories(source, await request(`${source}?format=json`), options.log),
        ),
      );

      const advisories: Advisory[] = [];
      const unavailable: HazardSource[] = [];
      const errors: unknown[] = [];
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          advisories.push(...result.value);
        } else {
          unavailable.push(HAZARD_SOURCES[i]!);
          const err = result.reason as unknown;
          errors.push(err);
          options.log?.warn({ err }, `Hazard feed ${HAZARD_SOURCES[i]} failed`);
        }
      });
      if (errors.length === HAZARD_SOURCES.length) throw errors[0];
      return { advisories, unavailable };
    },
  };
}
