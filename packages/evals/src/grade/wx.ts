/**
 * Reading METAR/TAF text and briefing prose for the graders: which weather a report contains,
 * which weather words a sentence uses, and the numbers in a summary. Deliberately small: it only
 * needs to back or refute what a briefing says about the reports it was given.
 */

/** Weather phenomena codes, two letters each (ICAO Annex 3). */
const PHENOMENA = 'DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS'.split('|');
const DESCRIPTORS = 'MI|BC|PR|DR|BL|SH|TS|FZ'.split('|');
const WX_GROUP = new RegExp(
  `^(?:[-+]|VC|RE)?((?:${DESCRIPTORS.join('|')})*(?:${PHENOMENA.join('|')})*)$`,
);

/** Every weather code in a report: "-FZDZ" gives FZ and DZ; "FEW015CB" gives CB. */
export function weatherCodes(raw: string): Set<string> {
  const codes = new Set<string>();
  for (const token of raw.toUpperCase().split(/\s+/)) {
    if (/^(?:FEW|SCT|BKN|OVC)\d{3}(?:CB|TCU)$/.test(token))
      codes.add(token.slice(-3) === 'TCU' ? 'TCU' : 'CB');
    if (
      /^\d{3,5}(?:G\d{2,3})?(?:KT|MPS)$|^VRB\d{2,3}(?:G\d{2,3})?KT$/.test(token) &&
      token.includes('G')
    )
      codes.add('GUST');
    if (/^(?:LLWS|WS)$/.test(token) || token.startsWith('WS')) codes.add('WS');
    // SIGMET bulletins name CB and TCU on their own ("CB OBS WI 150NM OF CENTRE").
    if (token === 'CB' || token === 'TCU') codes.add(token);
    const match = WX_GROUP.exec(token);
    const body = match?.[1];
    if (!body || body.length % 2 !== 0) continue;
    for (let i = 0; i < body.length; i += 2) codes.add(body.slice(i, i + 2));
    // A group with more than one code ("FZDZ", "SHSN") also counts as a combination.
    codes.add(body);
  }
  return codes;
}

/** What backs a weather word: report codes it needs (all of one inner list), or a hazard type. */
interface Phenomenon {
  word: RegExp;
  label: string;
  /** Any one of these code sets, all present in the same report text. */
  codes: string[][];
  /** Route hazard types that also back it. */
  hazards?: string[];
}

/** Longest phrases first: "freezing rain" must not also count as "rain". */
export const WEATHER_WORDS: Phenomenon[] = [
  { word: /freezing rain/g, label: 'freezing rain', codes: [['FZ', 'RA']] },
  { word: /freezing drizzle/g, label: 'freezing drizzle', codes: [['FZ', 'DZ']] },
  { word: /freezing fog/g, label: 'freezing fog', codes: [['FZ', 'FG']] },
  { word: /freezing (?:precipitation|precip)/g, label: 'freezing precipitation', codes: [['FZ']] },
  { word: /snow showers?/g, label: 'snow showers', codes: [['SHSN'], ['SH', 'SN']] },
  { word: /(?:drifting|blowing) snow/g, label: 'drifting snow', codes: [['DRSN'], ['BLSN']] },
  { word: /ice pellets|sleet/g, label: 'ice pellets', codes: [['PL'], ['RA', 'SN']] },
  {
    word: /tropical cyclone|typhoon|hurricane|cyclone/g,
    label: 'tropical cyclone',
    codes: [],
    hazards: ['tropical_cyclone'],
  },
  { word: /volcanic ash/g, label: 'volcanic ash', codes: [['VA']], hazards: ['volcanic_ash'] },
  { word: /mountain waves?/g, label: 'mountain wave', codes: [], hazards: ['mountain_wave'] },
  {
    word: /thunderstorms?|thunder|\bts(?:ra)?\b/g,
    label: 'thunderstorm',
    codes: [['TS']],
    hazards: ['thunderstorm'],
  },
  {
    word: /cumulonimbus|\bcbs?\b/g,
    label: 'cumulonimbus',
    codes: [['CB'], ['TS']],
    hazards: ['thunderstorm'],
  },
  { word: /\bhail\b/g, label: 'hail', codes: [['GR'], ['GS']] },
  { word: /\bsnow\b/g, label: 'snow', codes: [['SN'], ['SG']] },
  { word: /drizzle/g, label: 'drizzle', codes: [['DZ']] },
  { word: /showers?/g, label: 'showers', codes: [['SH']] },
  { word: /\brain\b/g, label: 'rain', codes: [['RA']] },
  { word: /\bfog\b|\bfoggy\b/g, label: 'fog', codes: [['FG']] },
  { word: /\bmist\b|\bmisty\b/g, label: 'mist', codes: [['BR']] },
  { word: /\bhaze\b|\bhazy\b/g, label: 'haze', codes: [['HZ']] },
  { word: /\bsmoke\b/g, label: 'smoke', codes: [['FU']] },
  {
    word: /\b(?:dust|sand)(?:storms?)?\b/g,
    label: 'dust or sand',
    codes: [['DU'], ['SA'], ['DS'], ['SS']],
  },
  { word: /squalls?/g, label: 'squall', codes: [['SQ']] },
  { word: /funnel cloud|tornado|waterspout/g, label: 'funnel cloud', codes: [['FC']] },
  {
    word: /\bicing\b|\bice\b/g,
    label: 'icing',
    codes: [['FZ'], ['SN'], ['PL']],
    hazards: ['icing'],
  },
  {
    word: /turbulen(?:ce|t)|\bturb\b/g,
    label: 'turbulence',
    // Gusty wind, and thunderstorms: "expect turbulence near the storms" is standard advice.
    codes: [['GUST'], ['TS'], ['CB']],
    hazards: ['turbulence', 'mountain_wave', 'thunderstorm'],
  },
  { word: /wind ?shear/g, label: 'wind shear', codes: [['WS'], ['GUST']] },
  { word: /\bgust(?:s|ing|y)?\b/g, label: 'gusts', codes: [['GUST']] },
];

/** Words before a weather word that make it not a claim: "no thunderstorms", "check for icing". */
const NEGATION =
  /\b(?:no|nil|without|free of|not|absence of|none|neither|nor|check for|check yourself for)\b[^.;]{0,30}$/;

export interface WeatherMention {
  label: string;
  phenomenon: Phenomenon;
}

/**
 * The weather words a sentence uses, longest phrase first, leaving out negated ones ("no
 * thunderstorms", "nil significant weather").
 */
export function weatherMentions(text: string): WeatherMention[] {
  let rest = text.toLowerCase();
  const mentions: WeatherMention[] = [];
  for (const phenomenon of WEATHER_WORDS) {
    rest = rest.replace(phenomenon.word, (match: string, offset: number, whole: string) => {
      const before = whole.slice(Math.max(0, offset - 40), offset);
      if (!NEGATION.test(before)) mentions.push({ label: phenomenon.label, phenomenon });
      return ' '.repeat(match.length);
    });
  }
  return mentions;
}

/** Whether the reports (and route hazards) back a weather word. */
export function isBacked(
  mention: WeatherMention,
  reports: readonly string[],
  hazardTypes: readonly string[],
): boolean {
  const { codes, hazards = [] } = mention.phenomenon;
  if (hazards.some((h) => hazardTypes.includes(h))) return true;
  return reports.some((raw) => {
    const found = weatherCodes(raw);
    return codes.some((set) => set.every((code) => found.has(code)));
  });
}

const INTENSITY_WORDS: Record<string, string> = { light: '-', moderate: '', heavy: '+' };
const PRECIP: Record<string, string> = {
  rain: 'RA',
  drizzle: 'DZ',
  snow: 'SN',
  showers: 'SH',
  shower: 'SH',
};

/**
 * "light rain" when the METAR has RA (moderate), "heavy snow" for -SN...: each intensity a
 * summary gives must be the one the METAR codes ("-" light, none moderate, "+" heavy).
 */
export function intensityMismatches(summary: string, metarRaw: string): string[] {
  const groups = metarRaw
    .toUpperCase()
    .split(/\s+/)
    .map((t) => /^([-+]?)((?:MI|BC|PR|DR|BL|SH|TS|FZ)*(?:DZ|RA|SN|SG|PL|GR|GS)+)$/.exec(t))
    .filter((m): m is RegExpExecArray => m !== null);
  const problems: string[] = [];
  for (const m of summary
    .toLowerCase()
    .matchAll(/\b(light|moderate|heavy)\s+(?:freezing\s+)?(rain|drizzle|snow|showers?)\b/g)) {
    const code = PRECIP[m[2]!]!;
    const sign = INTENSITY_WORDS[m[1]!]!;
    const withCode = groups.filter((g) =>
      (g[2]!.match(/.{2}/g) ?? ([] as string[])).includes(code),
    );
    if (withCode.length > 0 && !withCode.some((g) => g[1] === sign)) {
      problems.push(`"${m[0]}", but the METAR has ${withCode.map((g) => g[0]).join(' ')}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Numbers in a summary

export interface SummaryNumbers {
  wind: {
    calm: boolean;
    variable: boolean;
    directionDeg: number | null;
    speedKt: number | null;
    gustKt: number | null;
  } | null;
  /** Heights in feet ("broken at 1,200 ft"). */
  heightsFt: number[];
  /** Visibilities in metres, from "800 m", "6 km" or "3/4 SM" (statute miles converted). */
  visibilitiesM: { metres: number; orMore: boolean; text: string }[];
  /** Pressures in hPa (inches of mercury converted). */
  pressuresHpa: { hpa: number; text: string }[];
}

const num = (s: string) => Number(s.replace(/,/g, ''));
const SM_M = 1609.344;

function fraction(text: string): number {
  const parts = text.trim().split(/\s+/);
  return parts.reduce((sum, part) => {
    const [a, b] = part.split('/');
    return sum + (b ? Number(a) / Number(b) : Number(a));
  }, 0);
}

export function summaryNumbers(summary: string): SummaryNumbers {
  const text = summary.toLowerCase();
  let wind: SummaryNumbers['wind'] = null;
  if (/\bcalm\b/.test(text)) {
    wind = { calm: true, variable: false, directionDeg: null, speedKt: 0, gustKt: null };
  }
  const windMatch =
    /wind\s+(?:from\s+)?(\d{3}|variable|vrb)(?:°|\s*degrees)?(?:\s+at\s+|\s*\/\s*)(\d{1,3})(?:\s*(?:kt|knots))?(?:,?\s*gust(?:s|ing)?\s*(?:to\s+)?(\d{1,3})|g(\d{1,3}))?/.exec(
      text,
    ) ?? /\b(\d{3}|vrb)\/?(\d{2,3})(?:g(\d{2,3}))?\s*(?:kt|knots)\b/.exec(text);
  if (windMatch) {
    const variable = /variable|vrb/.test(windMatch[1]!);
    wind = {
      calm: false,
      variable,
      directionDeg: variable ? null : Number(windMatch[1]),
      speedKt: Number(windMatch[2]),
      gustKt: (windMatch[3] ?? windMatch[4]) ? Number(windMatch[3] ?? windMatch[4]) : null,
    };
  }

  const heightsFt = [...text.matchAll(/(\d[\d,]*)\s*(?:ft|feet)\b/g)].map((m) => num(m[1]!));

  const visibilitiesM: SummaryNumbers['visibilitiesM'] = [];
  for (const m of text.matchAll(/(\d[\d,]*)\s*(?:m|metres|meters)\b/g)) {
    visibilitiesM.push({ metres: num(m[1]!), orMore: false, text: m[0] });
  }
  for (const m of text.matchAll(
    /(\d+(?:\.\d+)?)\s*(?:km|kilometres|kilometers)(\s*(?:or more|\+|plus))?/g,
  )) {
    visibilitiesM.push({ metres: Number(m[1]) * 1000, orMore: Boolean(m[2]), text: m[0] });
  }
  for (const m of text.matchAll(
    /((?:\d+\s+)?\d+(?:\.\d+|\/\d+)?)\+?\s*(?:sm|statute miles?|miles?)\b/g,
  )) {
    visibilitiesM.push({ metres: fraction(m[1]!) * SM_M, orMore: m[0].includes('+'), text: m[0] });
  }

  const pressuresHpa: SummaryNumbers['pressuresHpa'] = [];
  for (const m of text.matchAll(/(\d{3,4})\s*(?:hpa|mb)\b/g))
    pressuresHpa.push({ hpa: Number(m[1]), text: m[0] });
  for (const m of text.matchAll(/(\d{2}\.\d{2})\s*(?:inhg|in\b|inches)/g))
    pressuresHpa.push({ hpa: Number(m[1]) * 33.8639, text: m[0] });

  return { wind, heightsFt, visibilitiesM, pressuresHpa };
}

export interface MetarNumbers {
  /**
   * Heights in feet from the whole report (trend included): cloud and vertical visibility,
   * 5,000 ft for CAVOK, and runway visual ranges given in feet.
   */
  heightsFt: Set<number>;
  /** Visibilities in metres from the whole report; 9999 counts as 10 km or more. */
  visibilitiesM: { metres: number; orMore: boolean }[];
  pressuresHpa: number[];
}

export function metarNumbers(raw: string): MetarNumbers {
  const heightsFt = new Set<number>();
  const visibilitiesM: MetarNumbers['visibilitiesM'] = [];
  const pressuresHpa: number[] = [];
  const tokens = raw.toUpperCase().split(/\s+/);
  // Skip station and time; remarks (RMK) are US-coded data, not for pilots' summaries.
  const end = tokens.indexOf('RMK');
  const body = end === -1 ? tokens : tokens.slice(0, end);
  for (let i = 0; i < body.length; i++) {
    const t = body[i]!;
    const cloud = /^(?:FEW|SCT|BKN|OVC|VV)(\d{3})/.exec(t);
    if (cloud) heightsFt.add(Number(cloud[1]) * 100);
    if (t === 'CAVOK') {
      visibilitiesM.push({ metres: 10_000, orMore: true });
      heightsFt.add(5000); // CAVOK: no cloud below 5,000 ft
    }
    // Runway visual range, e.g. R28R/1400VP6000FT (feet) or R19R/P2000N (metres).
    const rvr = /^R\d{2}[LCR]?\/([PM]?)(\d{4})(?:V([PM]?)(\d{4}))?(FT)?/.exec(t);
    if (rvr) {
      for (const value of [rvr[2], rvr[4]].filter((v): v is string => Boolean(v))) {
        if (rvr[5]) heightsFt.add(Number(value));
        else visibilitiesM.push({ metres: Number(value), orMore: false });
      }
    }
    const metres = /^(\d{4})(?:N|NE|E|SE|S|SW|W|NW|NDV)?$/.exec(t);
    if (metres && i > 1) {
      const m = Number(metres[1]);
      visibilitiesM.push(
        m === 9999 ? { metres: 10_000, orMore: true } : { metres: m, orMore: false },
      );
    }
    const sm = /^(P|M)?(\d+(?:\/\d+)?)SM$/.exec(t);
    if (sm) {
      const whole = /^\d$/.test(body[i - 1] ?? '') ? Number(body[i - 1]) : 0;
      visibilitiesM.push({ metres: (whole + fraction(sm[2]!)) * SM_M, orMore: sm[1] === 'P' });
    }
    const q = /^Q(\d{4})$/.exec(t);
    if (q) pressuresHpa.push(Number(q[1]));
    const a = /^A(\d{4})$/.exec(t);
    if (a) pressuresHpa.push((Number(a[1]) / 100) * 33.8639);
  }
  return { heightsFt, visibilitiesM, pressuresHpa };
}
