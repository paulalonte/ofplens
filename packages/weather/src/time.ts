/**
 * METARs and TAFs give day of month and time only. Take year and month from the reference time (when
 * the OFP was generated, or when the report was fetched); a day after the reference day means
 * the previous month (e.g. a report from the 31st read on the 1st).
 */
export function completeTime(
  day: number,
  hour: number,
  minute: number,
  referenceIso: string,
): string {
  const ref = new Date(referenceIso);
  let candidate = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), day, hour, minute);
  if (candidate > ref.getTime() + 24 * 3600 * 1000) {
    candidate = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, day, hour, minute);
  }
  return new Date(candidate).toISOString().replace('.000Z', 'Z');
}
