import { flightCategory } from './category';
import { completeTime } from './time';
import type { FlightCategory } from './schema';

/**
 * Decodes the parts of a METAR OFP Lens needs, from the raw text alone, so the OFP's METAR
 * (plain text) and live METARs are judged by the same code. Pure: no network, no clock.
 *
 * Only the main report is read: everything from a trend (BECMG, TEMPO, NOSIG) or the remarks
 * (RMK) on is a forecast or extra information, not the observation.
 */
export interface DecodedMetar {
  station: string | null;
  /** Full UTC time, completed from the reference date (METARs only carry day and time). */
  observedAt: string | null;
  wind: {
    directionDeg: number | null;
    variable: boolean;
    speedKt: number;
    gustKt: number | null;
  } | null;
  /** Prevailing visibility in statute miles; `orMore` for 9999, P6SM, CAVOK. */
  visibility: { sm: number; orMore: boolean } | null;
  clouds: { cover: CloudCover; baseFt: number | null }[];
  /** Lowest BKN, OVC or vertical visibility layer, in feet; null when there is none. */
  ceilingFt: number | null;
  /** Our own flight category from ceiling and visibility (see category.ts). */
  category: FlightCategory | null;
  cavok: boolean;
  /** Air temperature in °C (M02 is −2). */
  temperatureC: number | null;
  /** QNH in inHg, as SimBrief gives it: A2992 as is, Q1013 converted. */
  altimeterInHg: number | null;
}

export type CloudCover = 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV';

const METRES_PER_SM = 1609.344;
const HPA_PER_INHG = 33.8639;
const KT_PER_MPS = 1.943844;
const KT_PER_KMH = 0.539957;
/** 10 km or more, as 9999 and CAVOK report it. */
const TEN_KM_SM = 10_000 / METRES_PER_SM;

const END_OF_OBSERVATION = new Set(['RMK', 'BECMG', 'TEMPO', 'NOSIG', 'FM', 'PROB30', 'PROB40']);

export function decodeMetar(raw: string, referenceIso: string): DecodedMetar {
  const tokens = raw.trim().toUpperCase().split(/\s+/);
  const end = tokens.findIndex((t) => END_OF_OBSERVATION.has(t));
  const body = end === -1 ? tokens : tokens.slice(0, end);

  let i = 0;
  while (body[i] === 'METAR' || body[i] === 'SPECI' || body[i] === 'COR') i++;

  const result: DecodedMetar = {
    station: null,
    observedAt: null,
    wind: null,
    visibility: null,
    clouds: [],
    ceilingFt: null,
    category: null,
    cavok: false,
    temperatureC: null,
    altimeterInHg: null,
  };

  if (body[i] && /^[A-Z][A-Z0-9]{3}$/.test(body[i]!)) result.station = body[i++]!;

  const time = body[i] ? /^(\d{2})(\d{2})(\d{2})Z$/.exec(body[i]!) : null;
  if (time) {
    result.observedAt = completeTime(
      Number(time[1]),
      Number(time[2]),
      Number(time[3]),
      referenceIso,
    );
    i++;
  }

  for (; i < body.length; i++) {
    const token = body[i]!;

    if (result.wind === null) {
      const wind = decodeWind(token);
      if (wind) {
        result.wind = wind;
        continue;
      }
    }

    if (token === 'CAVOK') {
      result.cavok = true;
      result.visibility = { sm: TEN_KM_SM, orMore: true };
      continue;
    }

    if (result.visibility === null) {
      // "1 1/2SM": whole miles and a fraction split over two tokens.
      const next = body[i + 1];
      if (/^\d$/.test(token) && next && /^\d\/\dSM$/.test(next)) {
        result.visibility = { sm: Number(token) + fraction(next.slice(0, -2)), orMore: false };
        i++;
        continue;
      }
      const visibility = decodeVisibility(token);
      if (visibility) {
        result.visibility = visibility;
        continue;
      }
    }

    const cloud = decodeCloud(token);
    if (cloud) {
      result.clouds.push(cloud);
      continue;
    }

    // Temperature/dewpoint: 12/08, M02/M05, 12/ (no dewpoint).
    const temperature = /^(M?\d{2})\/(?:M?\d{2}|\/\/)?$/.exec(token);
    if (temperature && result.temperatureC === null) {
      result.temperatureC = Number(temperature[1]!.replace('M', '-')) + 0; // + 0: M00 is 0, not −0
      continue;
    }

    const altimeter = /^([QA])(\d{4})$/.exec(token);
    if (altimeter && result.altimeterInHg === null) {
      const value = Number(altimeter[2]);
      result.altimeterInHg = altimeter[1] === 'A' ? value / 100 : value / HPA_PER_INHG;
    }
  }

  result.ceilingFt = ceiling(result.clouds);
  result.category = flightCategory(result.ceilingFt, result.visibility?.sm ?? null);
  return result;
}

function decodeWind(token: string): DecodedMetar['wind'] {
  const m = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/.exec(token);
  if (!m) return null;
  const toKt = (v: number) =>
    Math.round(m[4] === 'KT' ? v : m[4] === 'MPS' ? v * KT_PER_MPS : v * KT_PER_KMH);
  const variable = m[1] === 'VRB';
  return {
    directionDeg: variable ? null : Number(m[1]),
    variable,
    speedKt: toKt(Number(m[2])),
    gustKt: m[3] ? toKt(Number(m[3])) : null,
  };
}

function decodeVisibility(token: string): DecodedMetar['visibility'] {
  // Metres: 0800, 5000, 9999 (10 km or more); an optional NDV suffix (no directional variation).
  const metres = /^(\d{4})(NDV)?$/.exec(token);
  if (metres) {
    const m = Number(metres[1]);
    return m === 9999 ? { sm: TEN_KM_SM, orMore: true } : { sm: m / METRES_PER_SM, orMore: false };
  }
  // Statute miles: 10SM, P6SM (more than 6), 1/2SM, M1/4SM (less than 1/4).
  const sm = /^([PM])?(\d+(?:\/\d+)?)SM$/.exec(token);
  if (sm) {
    const value = sm[2]!.includes('/') ? fraction(sm[2]!) : Number(sm[2]);
    return { sm: value, orMore: sm[1] === 'P' };
  }
  return null;
}

function decodeCloud(token: string): DecodedMetar['clouds'][number] | null {
  const layer = /^(FEW|SCT|BKN|OVC)(\d{3}|\/\/\/)(?:CB|TCU|\/\/\/)?$/.exec(token);
  if (layer) {
    return {
      cover: layer[1] as CloudCover,
      baseFt: layer[2] === '///' ? null : Number(layer[2]) * 100,
    };
  }
  const vv = /^VV(\d{3}|\/\/\/)$/.exec(token);
  if (vv) return { cover: 'VV', baseFt: vv[1] === '///' ? null : Number(vv[1]) * 100 };
  return null;
}

function ceiling(clouds: DecodedMetar['clouds']): number | null {
  const bases = clouds
    .filter(
      (c) => (c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'VV') && c.baseFt !== null,
    )
    .map((c) => c.baseFt!);
  return bases.length > 0 ? Math.min(...bases) : null;
}

function fraction(text: string): number {
  const [n, d] = text.split('/').map(Number);
  return n! / d!;
}
