import type { Waypoint } from '@ofplens/ofp';
import {
  parseAdvisories,
  type Advisory,
  type HazardClient,
  type HazardSource,
} from '@ofplens/weather';
import { loadHazardFixture } from '@ofplens/weather/testing';

/**
 * Made-up advisories for a case, placed over named waypoints of its route and valid around the
 * briefing time. Each is built in the feed's own JSON shape and parsed by the real code, so it
 * reaches the agent exactly as a real one would.
 */

/** An international SIGMET (the isigmet feed). Levels in feet. */
export interface SigmetSpec {
  feed: 'isigmet';
  /** FIR id and name, e.g. ['EDUU', 'EDUU RHEIN UIR']. */
  fir: [string, string];
  seriesId: string;
  /** Feed code: TS, TURB, ICE, MTW, VA, TC. */
  hazard: string;
  /** SEV, EMBD, FRQ, the volcano or the storm's name. */
  qualifier: string;
  /** The area is the box around these waypoints, plus `marginDeg`. */
  over: string[];
  marginDeg?: number;
  baseFt: number | null;
  topFt: number;
  /** Validity in hours from the briefing time (default −1 to +5). */
  validHours?: [number, number];
  /** The bulletin text after the FIR, e.g. "SEV TURB FCST FL340/410 MOV E 20KT NC". */
  text: string;
}

/** A US G-AIRMET snapshot (the gairmet feed). Levels in hundreds of feet, as the feed gives them. */
export interface GairmetSpec {
  feed: 'gairmet';
  /** ICE, TURB-HI, TURB-LO, IFR, MT_OBSC... */
  hazard: string;
  tag: string;
  severity: 'MOD' | null;
  dueTo: string | null;
  over: string[];
  marginDeg?: number;
  base: string;
  top: string;
  /** The snapshot's time in hours from the hour of the briefing (it counts ±90 minutes). */
  atHours: number;
}

export type HazardSpec = SigmetSpec | GairmetSpec;

const HOUR_S = 3600;

function box(waypoints: Waypoint[], idents: string[], margin: number) {
  const points = idents.map((ident) => {
    const wp = waypoints.find((w) => w.ident === ident);
    if (!wp) throw new Error(`No waypoint ${ident} on this route`);
    return wp;
  });
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const [south, north] = [Math.min(...lats) - margin, Math.max(...lats) + margin];
  const [west, east] = [Math.min(...lons) - margin, Math.max(...lons) + margin];
  return [
    { lat: south, lon: west },
    { lat: south, lon: east },
    { lat: north, lon: east },
    { lat: north, lon: west },
  ].map(({ lat, lon }) => ({ lat: round(lat), lon: round(lon) }));
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The case's made-up advisories, parsed by the real feed parsers. */
export function caseAdvisories(
  specs: HazardSpec[],
  waypoints: Waypoint[],
  briefAt: Date,
): Advisory[] {
  const hour = Math.floor(briefAt.getTime() / 1000 / HOUR_S) * HOUR_S;
  const sigmets = specs
    .filter((s): s is SigmetSpec => s.feed === 'isigmet')
    .map((s) => {
      const [from, to] = s.validHours ?? [-1, 5];
      return {
        icaoId: s.fir[0],
        firId: s.fir[0],
        firName: s.fir[1],
        seriesId: s.seriesId,
        validTimeFrom: hour + from * HOUR_S,
        validTimeTo: hour + to * HOUR_S,
        hazard: s.hazard,
        qualifier: s.qualifier,
        base: s.baseFt,
        top: s.topFt,
        geom: 'AREA',
        coords: box(waypoints, s.over, s.marginDeg ?? 0.3),
        rawSigmet: `${s.fir[0]} SIGMET ${s.seriesId} ${s.fir[1]} ${s.text} (made up for evals)`,
      };
    });
  const gairmets = specs
    .filter((s): s is GairmetSpec => s.feed === 'gairmet')
    .map((s) => ({
      product: s.hazard.startsWith('TURB') ? 'TANGO' : s.hazard === 'ICE' ? 'ZULU' : 'SIERRA',
      tag: s.tag,
      forecastHour: 0,
      validTime: new Date((hour + s.atHours * HOUR_S) * 1000).toISOString(),
      expireTime: hour + (s.atHours + 3) * HOUR_S,
      hazard: s.hazard,
      geom: 'AREA',
      severity: s.severity,
      due_to: s.dueTo,
      base: s.base,
      top: s.top,
      coords: box(waypoints, s.over, s.marginDeg ?? 0.3),
    }));
  return [...parseAdvisories('isigmet', sigmets), ...parseAdvisories('gairmet', gairmets)];
}

/**
 * The real SIGMETs captured in fixtures/hazards, moved so all of them ended a day before the
 * briefing: they count as advisories checked, but none is valid during the flight.
 */
export function backgroundAdvisories(briefAt: Date): Advisory[] {
  const captured = loadHazardFixture('isigmet') as { validTimeFrom: number; validTimeTo: number }[];
  const lastEnd = Math.max(...captured.map((a) => a.validTimeTo));
  const shift = Math.floor(briefAt.getTime() / 1000) - 86_400 - lastEnd;
  return parseAdvisories(
    'isigmet',
    captured.map((a) => ({
      ...a,
      validTimeFrom: a.validTimeFrom + shift,
      validTimeTo: a.validTimeTo + shift,
    })),
  );
}

/** A hazard client that always answers with these advisories, or as if the feeds were down. */
export function fixedHazardClient(
  advisories: Advisory[],
  unavailable: HazardSource[] = [],
): HazardClient {
  return {
    fetchAdvisories: () =>
      Promise.resolve({
        advisories: advisories.filter((a) => !unavailable.includes(a.source)),
        unavailable,
      }),
  };
}
