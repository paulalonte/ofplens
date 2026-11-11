import type { LiveMetar, LiveTaf } from '@ofplens/weather';

/**
 * Builds a case's live METARs and TAFs from report bodies, dated around the briefing time, in
 * the same shape aviationweather.gov's client returns.
 */

const HOUR_MS = 3_600_000;
const pad2 = (n: number) => String(n).padStart(2, '0');
const isoUtc = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const ddhh = (ms: number) => {
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}`;
};
const ddhhmm = (ms: number) => `${ddhh(ms)}${pad2(new Date(ms).getUTCMinutes())}`;

/**
 * The latest observation at the briefing: 5–15 minutes earlier, on a 10-minute mark. Later than
 * the OFP's METAR (printed shortly before the plan was made), so a change shows as one.
 */
export function observedAt(briefAt: Date): Date {
  const tenMinutes = 10 * 60_000;
  return new Date(Math.floor((briefAt.getTime() - 5 * 60_000) / tenMinutes) * tenMinutes);
}

export function liveMetar(icao: string, briefAt: Date, body: string): LiveMetar {
  const at = observedAt(briefAt).getTime();
  return {
    icao,
    observedAt: isoUtc(at),
    raw: `METAR ${icao} ${ddhhmm(at)}Z ${body.trim()}`,
    // Only the raw text is decoded downstream; the rest is what the real client also fills.
    reportedCategory: null,
    wind: null,
    visibility: null,
    clouds: [],
    temperatureC: null,
    dewpointC: null,
    altimeterHpa: null,
  };
}

const TOKEN = /\{([+-]?\d+)\}/g;

/** A TAF issued 55 minutes before the hour of the briefing, with `{+n}` tokens filled in. */
export function liveTaf(icao: string, briefAt: Date, body: string): LiveTaf {
  const base = Math.floor(briefAt.getTime() / HOUR_MS) * HOUR_MS;
  const validity = /\{([+-]?\d+)\}\/\{([+-]?\d+)\}/.exec(body);
  if (!validity) throw new Error(`TAF body for ${icao} needs a {from}/{to} validity: ${body}`);
  const at = (hours: string) => base + Number(hours) * HOUR_MS;
  const issued = base - 55 * 60_000;
  return {
    icao,
    issuedAt: isoUtc(issued),
    validFrom: isoUtc(at(validity[1]!)),
    validTo: isoUtc(at(validity[2]!)),
    raw: `TAF ${icao} ${ddhhmm(issued)}Z ${body.trim().replace(TOKEN, (_, n: string) => ddhh(at(n)))}`,
  };
}

/** "EDDB 091320Z AUTO 10005KT ..." → "AUTO 10005KT ...": a dispatch METAR without station and time. */
export function metarBody(raw: string): string {
  const match = /^(?:METAR |SPECI )?(?:COR )?[A-Z0-9]{4} \d{6}Z (.+)$/s.exec(raw.trim());
  if (!match) throw new Error(`Not a METAR: ${raw}`);
  return match[1]!.replace(/\s+/g, ' ');
}

/** A dispatch TAF as the live client would return it (same text, same times). */
export function dispatchTaf(raw: string, referenceIso: string): LiveTaf {
  const match =
    /^(?:TAF )?(?:AMD |COR )?([A-Z0-9]{4}) (\d{2})(\d{2})(\d{2})Z (\d{2})(\d{2})\/(\d{2})(\d{2})/.exec(
      raw.trim(),
    );
  if (!match) throw new Error(`Not a TAF: ${raw}`);
  const ref = new Date(referenceIso);
  const at = (day: string, hour: string, minute = '00') =>
    isoUtc(
      Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), Number(day), Number(hour), Number(minute)),
    );
  const [, icao, day, hour, minute, fromDay, fromHour, toDay, toHour] = match;
  return {
    icao: icao!,
    issuedAt: at(day!, hour!, minute),
    validFrom: at(fromDay!, fromHour!),
    validTo: at(toDay!, toHour!),
    raw: raw.trim(),
  };
}
