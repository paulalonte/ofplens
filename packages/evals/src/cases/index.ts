import type { EvalCase } from '../case';
import { eddbEddm, eddfLepa, engmBikf, lowwLszh } from './europe';
import { egllKjfk, ksfoKjfk, rjttVhhh } from './longhaul';

/** Every eval case, grouped by plan. Listed for review in packages/evals/CASES.md. */
export const EVAL_CASES: readonly EvalCase[] = [
  ...eddbEddm,
  ...eddfLepa,
  ...lowwLszh,
  ...engmBikf,
  ...ksfoKjfk,
  ...egllKjfk,
  ...rjttVhhh,
];
