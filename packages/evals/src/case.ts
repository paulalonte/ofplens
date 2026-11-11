import type { HazardSource } from '@ofplens/weather';
import type { HazardSpec } from './hazards';

/**
 * One frozen eval case: a captured OFP, the moment the pilot asks for the briefing, and the
 * weather and advisories the tools will see then. Everything the agent reads is fixed, so a case
 * gives the same tool results on every run.
 */
export type Role = 'origin' | 'destination' | 'alternate';

/**
 * Live weather for one airport. Bodies leave out station and time ("24010KT 9999 SCT030 ...");
 * they are filled in for the case. In a TAF, `{+3}` is day and hour three hours after the hour
 * of the briefing ("1121"), so `{0}/{24}` is the validity and `FM{+3}00` a change group.
 * `null` means aviationweather.gov has no report for that airport.
 */
export interface StationLive {
  metar?: string | null;
  taf?: string | null;
}

export interface EvalCase {
  /** Stable id, e.g. "eddb-eddm-ts-sigmet". */
  id: string;
  /** Fixture name in fixtures/ofp. */
  plan: string;
  /** One line for the case list. */
  title: string;
  /** tags[0] is the scenario group; further tags are short labels shown with results. */
  tags: string[];
  /** What a correct briefing says, for the reviewer. Graders work out the rest from tool data. */
  expect: string;
  /** Minutes before the planned Out time that the briefing is asked for (default 20). */
  briefMinutesBeforeOut?: number;
  /**
   * Live weather per airport. An airport left out gets its dispatch METAR again, newly
   * observed (unchanged weather), and its dispatch TAF. 'unavailable': aviationweather.gov is down.
   */
  weather: 'unavailable' | Partial<Record<Role, StationLive>>;
  /**
   * Advisories made up for the case (each must touch the route), on top of real captured
   * SIGMETs that are not valid at the case time. 'unavailable': every hazard feed is down.
   */
  hazards: 'unavailable' | { advisories: HazardSpec[]; unavailableFeeds?: HazardSource[] };
}

export const defineCase = (c: EvalCase): EvalCase => c;

/** When the pilot asks for the briefing: the planned Out time minus the case's lead. */
export function briefingTime(evalCase: EvalCase, plannedOut: string): Date {
  return new Date(Date.parse(plannedOut) - (evalCase.briefMinutesBeforeOut ?? 20) * 60_000);
}
