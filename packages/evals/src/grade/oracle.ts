import type { Briefing } from '@ofplens/agent';
import { expectedRisk } from './checks';
import { airports, type MetarReport, type Reference } from './reference';
import { metarNumbers } from './wx';

/**
 * A correct briefing for a case, written by code from the tool data: the "model answer" the
 * graders must pass in full. Used to test the graders (and to show what they accept), never as
 * the eval's expected output for Claude.
 */
export function oracleBriefing(reference: Reference): Briefing {
  const weather = airports(reference);
  const conditions = (role: 'origin' | 'destination' | 'alternate') => {
    const airport = weather.find((a) => a.role === role);
    if (!airport?.metar) return null;
    const live = reference.get_weather.stations.find((s) => s.role === role)?.metar;
    return {
      icao: airport.icao,
      flightCategory: airport.metar.flightCategory,
      summary: describeMetar(airport.metar),
      changedSinceDispatch: Boolean(live) && airport.changedSinceDispatch,
      sourceReportId: airport.metar.reportId,
    };
  };
  const departure = conditions('origin');
  const destination = conditions('destination');
  if (!departure || !destination) throw new Error('No METAR for the departure or destination');

  const hazards = reference.get_route_hazards;
  const notes = hazards.hazards.map(
    (h) =>
      `${capital(h.type.replaceAll('_', ' '))}${h.severity ? ` (${h.severity})` : ''} on ` +
      `${h.segments.map((s) => `${s.fromWaypoint} to ${s.toWaypoint}`).join(' and ')}, ` +
      `${level(h.baseFt)} to ${level(h.topFt)}, valid until ${h.validUntil.slice(11, 13)}${h.validUntil.slice(14, 16)}Z.`,
  );
  if (!reference.get_weather.liveAvailable) {
    notes.push('Live weather is unavailable; conditions are from the dispatch reports.');
  }
  if (!hazards.available) {
    notes.push('Hazard advisories could not be checked; hazards on the route are unknown.');
  } else if (hazards.unavailableFeeds.length > 0) {
    notes.push(`Some hazard feeds could not be read (${hazards.unavailableFeeds.join(', ')}).`);
  }

  const risk = expectedRisk(reference)[0]!;
  return {
    headline: `${departure.icao} to ${destination.icao}: ${risk} risk.`,
    overallRisk: risk,
    departure,
    destination,
    alternate: conditions('alternate'),
    enrouteHazards: hazards.hazards.flatMap((h) =>
      h.segments.map((s) => ({
        type: h.type,
        fromWaypoint: s.fromWaypoint,
        toWaypoint: s.toWaypoint,
        validUntil: h.validUntil,
        severity: h.severity,
        advisoryId: h.advisoryId,
      })),
    ),
    pilotNotes: notes.slice(0, 5),
  };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const level = (ft: number | null) =>
  ft === null
    ? 'surface'
    : ft >= 18000
      ? `FL${Math.round(ft / 100)}`
      : `${ft.toLocaleString('en')} ft`;

const INTENSITY: Record<string, string> = { '-': 'light ', '+': 'heavy ' };
const WORDS: Record<string, string> = {
  MI: 'shallow',
  BC: 'patches of',
  PR: 'partial',
  DR: 'drifting',
  BL: 'blowing',
  SH: 'showers of',
  TS: 'thunderstorm with',
  FZ: 'freezing',
  DZ: 'drizzle',
  RA: 'rain',
  SN: 'snow',
  SG: 'snow grains',
  PL: 'ice pellets',
  GR: 'hail',
  GS: 'small hail',
  BR: 'mist',
  FG: 'fog',
  FU: 'smoke',
  HZ: 'haze',
  DU: 'dust',
  SA: 'sand',
  SQ: 'squalls',
};
const COVER: Record<string, string> = {
  FEW: 'few clouds',
  SCT: 'scattered cloud',
  BKN: 'broken cloud',
  OVC: 'overcast',
};

/** "Wind 240 at 16 kt gusting 28 kt, 10 km or more visibility, few clouds at 3,000 ft, ...". */
export function describeMetar(metar: MetarReport): string {
  const tokens = metar.raw.toUpperCase().split(/\s+/);
  const end = tokens.findIndex((t) => ['RMK', 'TEMPO', 'BECMG', 'NOSIG'].includes(t));
  const body = (end === -1 ? tokens : tokens.slice(0, end)).slice(2);
  const parts: string[] = [];

  const w = metar.wind;
  if (w) {
    if (w.speedKt === 0) parts.push('Calm wind');
    else {
      const from =
        w.variable || w.directionDeg === null
          ? 'variable'
          : String(w.directionDeg).padStart(3, '0');
      parts.push(`Wind ${from} at ${w.speedKt} kt${w.gustKt ? ` gusting ${w.gustKt} kt` : ''}`);
    }
  }

  const sm = body.find((t) => /^[PM]?\d+(?:\/\d+)?SM$/.test(t));
  const vis = metarNumbers(body.join(' ')).visibilitiesM[0];
  if (sm)
    parts.push(
      `${sm.replace(/^P/, '').replace('SM', ' SM')}${sm.startsWith('P') ? ' or more' : ''} visibility`,
    );
  else if (vis) {
    parts.push(
      vis.orMore
        ? '10 km or more visibility'
        : vis.metres < 5000
          ? `${vis.metres.toLocaleString('en')} m visibility`
          : `${vis.metres / 1000} km visibility`,
    );
  }

  for (const t of body) {
    const g =
      /^([-+])?((?:MI|BC|PR|DR|BL|SH|TS|FZ)*)((?:DZ|RA|SN|SG|PL|GR|GS|BR|FG|FU|HZ|DU|SA|SQ)*)$/.exec(
        t,
      );
    if (!g || (!g[2] && !g[3])) continue;
    const chunks = (s: string) => s.match(/.{2}/g) ?? [];
    const words = [...chunks(g[2] ?? ''), ...chunks(g[3] ?? '')].map((c) => WORDS[c]!);
    parts.push(`${INTENSITY[g[1] ?? ''] ?? ''}${words.join(' ')}`.replace(/ with$/, ''));
  }

  let layers = 0;
  for (const t of body) {
    const c = /^(FEW|SCT|BKN|OVC|VV)(\d{3})/.exec(t);
    if (!c || layers >= 3) continue;
    layers += 1;
    const ft = (Number(c[2]) * 100).toLocaleString('en');
    parts.push(c[1] === 'VV' ? `vertical visibility ${ft} ft` : `${COVER[c[1]!]} at ${ft} ft`);
  }

  const q = body.find((t) => /^Q\d{4}$/.test(t));
  const a = body.find((t) => /^A\d{4}$/.test(t));
  if (q) parts.push(`QNH ${Number(q.slice(1))} hPa`);
  else if (a) parts.push(`altimeter ${a.slice(1, 3)}.${a.slice(3)} inHg`);

  return `${parts.join(', ')}.`.slice(0, 200);
}
