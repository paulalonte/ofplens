import { completeTime } from './time';

/**
 * When a TAF was issued, from its text alone ("TAF AMD EDDB 100500Z 1006/1106 …"), so the OFP's
 * plain-text TAF and live ones are compared the same way. Null when the text has no issue time.
 */
export function tafIssuedAt(raw: string, referenceIso: string): string | null {
  const tokens = raw.trim().toUpperCase().split(/\s+/);
  let i = 0;
  while (tokens[i] === 'TAF' || tokens[i] === 'AMD' || tokens[i] === 'COR') i++;
  if (tokens[i] && /^[A-Z][A-Z0-9]{3}$/.test(tokens[i]!)) i++;
  const time = tokens[i] ? /^(\d{2})(\d{2})(\d{2})Z$/.exec(tokens[i]!) : null;
  return time
    ? completeTime(Number(time[1]), Number(time[2]), Number(time[3]), referenceIso)
    : null;
}
