/**
 * Briefing agent settings. The API reads them from the environment (OFP-26); tests pass their own.
 * Decisions (PLAN.md, "Phase 5 decisions"): Claude Haiku 5.5 to start, effort medium, at most
 * 8 tool calls per briefing.
 */
export interface BriefingConfig {
  /** Any Claude model id; the price table below must know it to report cost. */
  model: string;
  effort: 'low' | 'medium' | 'high';
  /** Tool calls allowed per briefing; more are refused and the model must answer. */
  maxToolCalls: number;
  /** API requests allowed per briefing (each turn is one). */
  maxTurns: number;
  /** Output tokens per request, thinking included. */
  maxTokens: number;
}

export const DEFAULT_BRIEFING_CONFIG: BriefingConfig = {
  model: 'claude-haiku-5-5',
  effort: 'medium',
  maxToolCalls: 8,
  maxTurns: 6,
  maxTokens: 16_000,
};

/** USD per million tokens (input, output), Anthropic API list prices, November 2026. */
export const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

/** Cost of a run in USD, or null for a model missing from the price table. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = PRICES_PER_MTOK[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
