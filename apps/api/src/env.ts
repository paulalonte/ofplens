import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Only for end-to-end tests: a fake SimBrief fetcher URL. Unset = the real SimBrief. */
  SIMBRIEF_URL: z.url({ protocol: /^https?$/ }).optional(),
  /** Only for end-to-end tests: a fake aviationweather.gov Data API base URL. */
  AVIATION_WEATHER_URL: z.url({ protocol: /^https?$/ }).optional(),
  /** Claude API key for AI briefings. Unset: briefings are switched off (503). Never logged. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Claude model for briefings (PLAN.md, Phase 5 decisions). */
  BRIEFING_MODEL: z.string().min(1).default('claude-haiku-5-5'),
  /** Briefings allowed per rolling 24 hours, to protect the budget. */
  BRIEFING_DAILY_LIMIT: z.coerce.number().int().min(0).default(20),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Parses and validates environment variables; throws one readable error listing every problem.
 * An empty variable counts as unset (`ANTHROPIC_API_KEY=` in .env, or passed through empty by
 * docker compose), so its default applies or the feature stays off.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const set = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = EnvSchema.safeParse(set);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
