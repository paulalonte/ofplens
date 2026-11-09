import type { WeightUnit } from '../schema';

/** Exact by definition (international avoirdupois pound, 1959). */
const KG_PER_LB = 0.45359237;

const UNIT_LABEL: Record<WeightUnit, string> = { kgs: 'kg', lbs: 'lb' };

const grouping = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * Converts a weight between kg and lb, rounded to a whole unit.
 * Values are stored in the OFP's own unit; convert only for display, never before storing.
 */
export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  const converted = from === 'kgs' ? value / KG_PER_LB : value * KG_PER_LB;
  return Math.round(converted);
}

/** "2,432 kg", or "5,362 lb" when shown in pounds. */
export function formatWeight(value: number, from: WeightUnit, to: WeightUnit = from): string {
  return `${formatWeightNumber(value, from, to)} ${UNIT_LABEL[to]}`;
}

/** The number alone, for tables whose header carries the unit: "2,432". */
export function formatWeightNumber(value: number, from: WeightUnit, to: WeightUnit = from): string {
  return grouping.format(convertWeight(value, from, to));
}

/** Short label for a unit: "kg" or "lb". */
export function weightUnitLabel(unit: WeightUnit): string {
  return UNIT_LABEL[unit];
}
