import { checkBriefing, collectEvidence, type Briefing } from '@ofplens/agent';
import { airports, metarsById, referenceToolCalls, type Reference } from './reference';
import { intensityMismatches, isBacked, metarNumbers, summaryNumbers, weatherMentions } from './wx';

/**
 * The eval's checks. Each looks at one thing, from the briefing and the tool data alone, and
 * says pass, fail (with reasons) or not applicable (null).
 */

export const CHECK_IDS = [
  'guardrails',
  'risk',
  'no_invented_weather',
  'numbers',
  'hazards_in_notes',
  'says_what_is_missing',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export const CHECK_LABELS: Record<CheckId, string> = {
  guardrails: 'Guardrails',
  risk: 'Risk level',
  no_invented_weather: 'No invented wx',
  numbers: 'Numbers',
  hazards_in_notes: 'Hazards noted',
  says_what_is_missing: 'Missing data said',
};

export interface CheckResult {
  id: CheckId;
  /** null: not applicable to this case. */
  pass: boolean | null;
  reasons: string[];
}

const result = (id: CheckId, reasons: string[], applicable = true): CheckResult => ({
  id,
  pass: applicable ? reasons.length === 0 : null,
  reasons,
});

/** The guardrails the app applies, against the case's tool data. */
export function checkGuardrails(briefing: Briefing, reference: Reference): CheckResult {
  return result(
    'guardrails',
    checkBriefing(briefing, collectEvidence(referenceToolCalls(reference))),
  );
}

const CATEGORY_ORDER = ['VFR', 'MVFR', 'IFR', 'LIFR'];
const rank = (category: string | null | undefined) =>
  category ? CATEGORY_ORDER.indexOf(category) : -1;

/**
 * The overall risk the prompt's rule gives for the tool data. Usually one level; when the
 * hazard feeds were unreadable, "no route hazard" is unknown, so low and moderate both count.
 */
export function expectedRisk(reference: Reference): Briefing['overallRisk'][] {
  const weather = airports(reference);
  const hazards = reference.get_route_hazards;
  const category = (role: string) => weather.find((a) => a.role === role)?.metar?.flightCategory;
  const worse = weather.some(
    (a) =>
      a.changedSinceDispatch &&
      rank(a.metar?.flightCategory) > rank(a.dispatchMetar?.flightCategory),
  );
  const origin = weather.find((a) => a.role === 'origin');
  const originWorseToLifr =
    category('origin') === 'LIFR' &&
    Boolean(origin?.changedSinceDispatch) &&
    rank(origin?.metar?.flightCategory) > rank(origin?.dispatchMetar?.flightCategory);

  const high =
    category('destination') === 'LIFR' ||
    category('alternate') === 'LIFR' ||
    originWorseToLifr ||
    hazards.hazards.some(
      (h) => h.severity === 'severe' || h.type === 'volcanic_ash' || h.type === 'tropical_cyclone',
    );
  if (high) return ['high'];

  const allGood = weather.every((a) => ['VFR', 'MVFR'].includes(a.metar?.flightCategory ?? ''));
  const hazardsKnown = hazards.available && hazards.unavailableFeeds.length === 0;
  if (allGood && !worse && hazards.hazards.length === 0) {
    return hazardsKnown ? ['low'] : ['low', 'moderate'];
  }
  return ['moderate'];
}

export function checkRisk(briefing: Briefing, reference: Reference): CheckResult {
  const allowed = expectedRisk(reference);
  return result(
    'risk',
    allowed.includes(briefing.overallRisk)
      ? []
      : [`overallRisk is ${briefing.overallRisk}; the rule gives ${allowed.join(' or ')}.`],
  );
}

/** The briefing's prose, with the airport each piece is about (null: the whole flight). */
function prose(briefing: Briefing): { where: string; text: string; icao: string | null }[] {
  const blocks = [
    ['departure', briefing.departure],
    ['destination', briefing.destination],
    ['alternate', briefing.alternate],
  ] as const;
  return [
    { where: 'headline', text: briefing.headline, icao: null },
    ...blocks.flatMap(([where, c]) =>
      c ? [{ where: `${where} summary`, text: c.summary, icao: c.icao }] : [],
    ),
    ...briefing.pilotNotes.map((text, i) => ({ where: `pilot note ${i + 1}`, text, icao: null })),
  ];
}

/**
 * Every weather word must be backed by a report. An airport summary describes current
 * conditions, so only the METAR it cites counts (a TAF's "TEMPO mist" does not make mist now),
 * and a stated intensity ("light rain") must be the METAR's. The headline and notes may draw on
 * any report of the airports they name (all airports when they name none) or a route hazard.
 */
export function checkNoInventedWeather(briefing: Briefing, reference: Reference): CheckResult {
  const weather = airports(reference);
  const metars = metarsById(reference);
  const hazardTypes = reference.get_route_hazards.hazards.map((h) => h.type);
  const reasons: string[] = [];
  const blocks = [
    ['departure', briefing.departure],
    ['destination', briefing.destination],
    ['alternate', briefing.alternate],
  ] as const;
  for (const [where, conditions] of blocks) {
    if (!conditions) continue;
    const metar = metars.get(conditions.sourceReportId);
    const sources = metar
      ? [metar.raw]
      : (weather.find((a) => a.icao === conditions.icao)?.raws ?? []);
    for (const mention of weatherMentions(conditions.summary)) {
      if (!isBacked(mention, sources, [])) {
        reasons.push(
          `${where} summary says "${mention.label}", which the cited METAR does not report.`,
        );
      }
    }
    if (metar) {
      for (const problem of intensityMismatches(conditions.summary, metar.raw)) {
        reasons.push(`${where} summary says ${problem}.`);
      }
    }
  }
  const free = [
    { where: 'headline', text: briefing.headline },
    ...briefing.pilotNotes.map((text, i) => ({ where: `pilot note ${i + 1}`, text })),
  ];
  for (const { where, text } of free) {
    const named = weather.filter((a) => text.toUpperCase().includes(a.icao));
    const sources = (named.length > 0 ? named : weather).flatMap((a) => a.raws);
    for (const mention of weatherMentions(text)) {
      if (!isBacked(mention, sources, hazardTypes)) {
        const whereFrom = named.length > 0 ? named.map((a) => a.icao).join('/') : 'any report';
        reasons.push(`${where} says "${mention.label}", which ${whereFrom} does not report.`);
      }
    }
  }
  return result('no_invented_weather', reasons);
}

/**
 * Numbers in each airport summary match the METAR it cites: wind, cloud and vertical
 * visibility heights, visibility, pressure.
 */
export function checkNumbers(briefing: Briefing, reference: Reference): CheckResult {
  const metars = metarsById(reference);
  const reasons: string[] = [];
  const blocks = [
    ['departure', briefing.departure],
    ['destination', briefing.destination],
    ['alternate', briefing.alternate],
  ] as const;
  for (const [where, conditions] of blocks) {
    if (!conditions) continue;
    const metar = metars.get(conditions.sourceReportId);
    if (!metar) continue; // a bad citation is the guardrails' finding
    const said = summaryNumbers(conditions.summary);
    const has = metarNumbers(metar.raw);

    if (said.wind && metar.wind) {
      const w = metar.wind;
      const ok = said.wind.calm
        ? w.speedKt === 0
        : said.wind.speedKt === w.speedKt &&
          (said.wind.variable
            ? w.variable || w.directionDeg === null
            : w.directionDeg !== null &&
              Math.abs(((said.wind.directionDeg! - w.directionDeg + 540) % 360) - 180) <= 10) &&
          (said.wind.gustKt === null || said.wind.gustKt === w.gustKt);
      if (!ok) {
        const real =
          w.speedKt === 0
            ? 'calm'
            : `${w.variable ? 'VRB' : String(w.directionDeg).padStart(3, '0')}/${w.speedKt}${w.gustKt ? `G${w.gustKt}` : ''} kt`;
        reasons.push(`${where} summary gives a wind the METAR does not have (METAR: ${real}).`);
      }
    }
    for (const ft of said.heightsFt) {
      if (!has.heightsFt.has(ft)) {
        reasons.push(
          `${where} summary says ${ft.toLocaleString('en')} ft; the METAR has ${[...has.heightsFt].map((h) => `${h} ft`).join(', ') || 'no cloud heights'}.`,
        );
      }
    }
    for (const v of said.visibilitiesM) {
      const match = has.visibilitiesM.some((m) =>
        m.orMore
          ? v.metres >= m.metres - 500
          : Math.abs(m.metres - v.metres) <= Math.max(100, m.metres * 0.1),
      );
      if (!match)
        reasons.push(`${where} summary says "${v.text}", which is not a visibility in the METAR.`);
    }
    for (const p of said.pressuresHpa) {
      if (!has.pressuresHpa.some((h) => Math.abs(h - p.hpa) <= 1.5)) {
        reasons.push(`${where} summary says "${p.text}", which is not the METAR's pressure.`);
      }
    }
  }
  return result('numbers', reasons);
}

const HAZARD_WORDS: Record<string, RegExp> = {
  thunderstorm: /thunderstorm|\bts\b|\bcbs?\b|cumulonimbus|convective/i,
  turbulence: /turbulen|\bturb\b/i,
  icing: /\bicing\b|\bice\b/i,
  volcanic_ash: /volcanic|\bash\b/i,
  tropical_cyclone: /tropical cyclone|typhoon|cyclone|hurricane/i,
  mountain_wave: /mountain wave/i,
  low_visibility: /visibility|\bifr\b|obscur/i,
  other: /hazard|sigmet|airmet/i,
};

/** Each hazard on the route is named in the headline or a pilot note. */
export function checkHazardsInNotes(briefing: Briefing, reference: Reference): CheckResult {
  const hazards = reference.get_route_hazards.hazards;
  const text = [briefing.headline, ...briefing.pilotNotes].join(' ');
  const reasons = hazards
    .filter(
      (h) =>
        !(HAZARD_WORDS[h.type]!.test(text) || (h.detail && text.toUpperCase().includes(h.detail))),
    )
    .map((h) => {
      const first = h.segments[0];
      return `No note names the ${h.type.replaceAll('_', ' ')}${first ? ` (${first.fromWaypoint} to ${first.toWaypoint})` : ''}.`;
    });
  return result('hazards_in_notes', reasons, hazards.length > 0);
}

const UNAVAILABLE =
  /unavailable|not available|could not|couldn't|cannot|can't|unable|not checked|missing|unknown|no live/i;

/**
 * When live weather or a hazard feed could not be read, the briefing says so instead of
 * presenting old or missing data as complete.
 */
export function checkSaysWhatIsMissing(briefing: Briefing, reference: Reference): CheckResult {
  const text = prose(briefing)
    .map((p) => p.text)
    .join(' ');
  const sentences = text.split(/(?<=[.;!?])\s+/);
  const says = (topic: RegExp) => sentences.some((s) => topic.test(s) && UNAVAILABLE.test(s));
  const reasons: string[] = [];
  const weatherDown = !reference.get_weather.liveAvailable;
  const hazards = reference.get_route_hazards;
  const hazardsMissing = !hazards.available || hazards.unavailableFeeds.length > 0;
  if (weatherDown && !says(/weather|metar|taf|report|dispatch/i)) {
    reasons.push('Live weather was unavailable, but the briefing does not say so.');
  }
  if (hazardsMissing && !says(/hazard|sigmet|airmet|advisor/i)) {
    reasons.push(
      `Hazard ${hazards.available ? `feeds (${hazards.unavailableFeeds.join(', ')})` : 'advisories'} could not be read, but the briefing does not say so.`,
    );
  }
  return result('says_what_is_missing', reasons, weatherDown || hazardsMissing);
}
