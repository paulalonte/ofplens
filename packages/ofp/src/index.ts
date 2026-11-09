// OFP Zod schema and parseOfp() land in OFP-06.

/** Weight unit as SimBrief reports it in params.units. */
export type WeightUnit = 'kgs' | 'lbs';

export const WEIGHT_UNITS = ['kgs', 'lbs'] as const satisfies readonly WeightUnit[];
