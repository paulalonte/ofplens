import { z } from 'zod';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True for http://localhost:5173 and friends: a server only this machine can reach. */
export const isLocalUrl = (url: string) => {
  const { hostname } = new URL(url);
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost');
};

const EnvSchema = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /**
     * Where pilots open the app, without a trailing slash. Sign-in callbacks go to
     * <PUBLIC_URL>/api/auth/<provider>/callback, and https here makes cookies Secure.
     */
    PUBLIC_URL: z
      .url({ protocol: /^https?$/ })
      .transform((url) => url.replace(/\/+$/, ''))
      .default('http://localhost:5173'),
    /** Sign in with Google: an OAuth client from Google Cloud. Both or neither. */
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    /** Sign in with GitHub: an OAuth app from GitHub's developer settings. Both or neither. */
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    /**
     * Sign in by typing any name, no password: for development and end-to-end tests only.
     * Refused unless PUBLIC_URL is a localhost address.
     */
    DEV_SIGN_IN: z.stringbool().default(false),
    /**
     * Trust X-Forwarded-For from the proxy in front (nginx, the ingress), so rate limits see
     * the pilot's address instead of the proxy's. Only when the API is not reachable directly.
     */
    TRUST_PROXY: z.stringbool().default(false),
    /** Only for end-to-end tests: a fake SimBrief fetcher URL. Unset = the real SimBrief. */
    SIMBRIEF_URL: z.url({ protocol: /^https?$/ }).optional(),
    /** Only for end-to-end tests: a fake aviationweather.gov Data API base URL. */
    AVIATION_WEATHER_URL: z.url({ protocol: /^https?$/ }).optional(),
    /** Claude API key for AI briefings. Unset: briefings are switched off (503). Never logged. */
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    /** Claude model for briefings (PLAN.md, Phase 5 decisions). */
    BRIEFING_MODEL: z.string().min(1).default('claude-haiku-5-5'),
    /** Briefings one pilot may start per rolling 24 hours. */
    BRIEFING_DAILY_LIMIT: z.coerce.number().int().min(0).default(10),
    /** Briefings all pilots together may start per rolling 24 hours: the cap on the bill. */
    BRIEFING_GLOBAL_DAILY_LIMIT: z.coerce.number().int().min(0).default(50),
  })
  .superRefine((env, ctx) => {
    for (const provider of ['GOOGLE', 'GITHUB'] as const) {
      const id = env[`${provider}_CLIENT_ID`];
      const secret = env[`${provider}_CLIENT_SECRET`];
      if ((id === undefined) !== (secret === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: [id === undefined ? `${provider}_CLIENT_ID` : `${provider}_CLIENT_SECRET`],
          message: `Set both ${provider}_CLIENT_ID and ${provider}_CLIENT_SECRET, or neither`,
        });
      }
    }
    if (env.DEV_SIGN_IN && !isLocalUrl(env.PUBLIC_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_SIGN_IN'],
        message: `Development sign-in lets anyone be any pilot: only allowed when PUBLIC_URL is localhost (it is ${env.PUBLIC_URL})`,
      });
    }
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
