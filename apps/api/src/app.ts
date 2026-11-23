import type Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_BRIEFING_CONFIG, type BriefingConfig } from '@ofplens/agent';
import cookie from '@fastify/cookie';
import type {
  AuthRepository,
  BriefingRepository,
  FlightPlanRepository,
  HazardRepository,
  PilotRepository,
  WeatherRepository,
} from '@ofplens/db';
import {
  createCachedHazardClient,
  createCachedWeatherClient,
  createHazardClient,
  createWeatherClient,
  type HazardClient,
  type WeatherClient,
} from '@ofplens/weather';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { OAuthProvider } from './auth/providers';
import {
  cookieAuthenticate,
  registerSessions,
  SESSION_TTL_MS,
  type Authenticate,
} from './auth/sessions';
import { registerErrorHandling } from './plugins/errors';
import { registerMetrics } from './plugins/metrics';
import { DEFAULT_RATE_LIMITS, registerRateLimits, type RateLimits } from './rateLimits';
import { authRoutes } from './routes/auth';
import { briefingRoutes } from './routes/briefings';
import { flightPlanRoutes } from './routes/flightPlans';
import { hazardRoutes } from './routes/hazards';
import { healthRoutes } from './routes/health';
import { pilotRoutes } from './routes/pilot';
import { simbriefRoutes } from './routes/simbrief';
import { weatherRoutes } from './routes/weather';
import { createSimbriefClient, type SimbriefClient } from './simbrief';

export interface AppDeps {
  pingDb: () => Promise<void>;
  /** Sign-in and sessions. */
  auth: AuthRepository;
  /** "Sign in with ..." buttons: the providers with a client id and secret. */
  authProviders?: OAuthProvider[];
  /** Development sign-in by name (DEV_SIGN_IN). */
  devSignIn?: boolean;
  /** Cookies only over https (PUBLIC_URL is https). */
  secureCookies?: boolean;
  /**
   * Who is behind a request. Defaults to the session cookie; route tests pass a fixed pilot
   * so they do not have to sign in first.
   */
  authenticate?: Authenticate | undefined;
  /** Per-minute limits; false switches them off (route tests). */
  rateLimits?: Partial<RateLimits> | false;
  /** Trust X-Forwarded-For from the proxy in front (TRUST_PROXY). */
  trustProxy?: boolean;
  pilots: PilotRepository;
  flightPlans: FlightPlanRepository;
  weatherReports: WeatherRepository;
  briefings: BriefingRepository;
  hazards: HazardRepository;
  /** Claude client for briefings; null or absent = briefings answer 503 (no API key). */
  anthropic?: Anthropic | null;
  briefingConfig?: Partial<BriefingConfig>;
  /** Briefings per pilot per rolling 24 hours (default 10). */
  briefingDailyLimit?: number;
  /** Briefings for all pilots together per rolling 24 hours (default 50). */
  briefingGlobalDailyLimit?: number;
  now?: () => Date;
  /** Defaults to aviationweather.gov behind a 5-minute per-station cache. */
  weather?: WeatherClient;
  /** Defaults to aviationweather.gov's SIGMET/G-AIRMET feeds behind a 5-minute cache. */
  hazardFeeds?: HazardClient;
  /** Defaults to the real SimBrief client, logging through the app's logger. */
  simbrief?: SimbriefClient;
  /** Base URL for the default SimBrief client (end-to-end tests point it at a fake). */
  simbriefUrl?: string | undefined;
  /** Base URL for the default weather client (end-to-end tests point it at a fake). */
  aviationWeatherUrl?: string | undefined;
  dbTimeoutMs?: number;
  logger?: FastifyServerOptions['logger'];
}

/**
 * How the API logs: JSON lines on stdout, one per event, collected in the cluster and sent to
 * Grafana Cloud (Loki). The level is written as a word ("level":"info", not pino's 30), so
 * Loki recognises it.
 */
export function loggerOptions(level: string) {
  return {
    level,
    formatters: { level: (label: string) => ({ level: label }) },
  } satisfies FastifyServerOptions['logger'];
}

/** Builds the Fastify app without listening, so tests can drive it with `app.inject()`. */
export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: deps.logger ?? false,
    trustProxy: deps.trustProxy ?? false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  const metrics = registerMetrics(app);

  await app.register(cookie);
  registerSessions(app, {
    authenticate: deps.authenticate ?? cookieAuthenticate(deps.auth),
    flightPlans: deps.flightPlans,
  });
  const limits: Partial<RateLimits> =
    deps.rateLimits === false ? {} : { ...DEFAULT_RATE_LIMITS, ...deps.rateLimits };
  if (deps.rateLimits !== false) await registerRateLimits(app);

  await app.register(healthRoutes, {
    pingDb: deps.pingDb,
    ...(deps.dbTimeoutMs !== undefined && { dbTimeoutMs: deps.dbTimeoutMs }),
  });
  await app.register(authRoutes, {
    auth: deps.auth,
    providers: deps.authProviders ?? [],
    devSignIn: deps.devSignIn ?? false,
    secureCookies: deps.secureCookies ?? false,
    sessionTtlMs: SESSION_TTL_MS,
    rateLimit: limits.signIn,
  });
  await app.register(pilotRoutes, { pilots: deps.pilots });
  const simbrief =
    deps.simbrief ??
    createSimbriefClient({
      log: app.log,
      ...(deps.simbriefUrl !== undefined && { baseUrl: deps.simbriefUrl }),
    });
  await app.register(simbriefRoutes, {
    pilots: deps.pilots,
    simbrief,
    rateLimit: limits.simbrief,
  });
  await app.register(flightPlanRoutes, {
    pilots: deps.pilots,
    flightPlans: deps.flightPlans,
    simbrief,
    rateLimit: limits.simbrief,
  });
  // One cached weather client and one cached hazard client, shared by their endpoints and the
  // briefing agent.
  const weather =
    deps.weather ??
    createCachedWeatherClient(
      createWeatherClient({
        log: app.log,
        ...(deps.aviationWeatherUrl !== undefined && { baseUrl: deps.aviationWeatherUrl }),
      }),
    );
  await app.register(weatherRoutes, {
    weatherReports: deps.weatherReports,
    weather,
    rateLimit: limits.weather,
  });
  const hazardFeeds =
    deps.hazardFeeds ??
    createCachedHazardClient(
      createHazardClient({
        log: app.log,
        // Three feeds, the international one large: more time than for a few METARs.
        timeoutMs: 20_000,
        ...(deps.aviationWeatherUrl !== undefined && { baseUrl: deps.aviationWeatherUrl }),
      }),
    );
  await app.register(hazardRoutes, {
    hazards: deps.hazards,
    hazardFeeds,
    ...(deps.now && { now: deps.now }),
    rateLimit: limits.hazards,
  });
  await app.register(briefingRoutes, {
    briefings: deps.briefings,
    tools: {
      flightPlans: deps.flightPlans,
      weatherReports: deps.weatherReports,
      weather,
      hazards: deps.hazards,
      hazardFeeds,
    },
    anthropic: deps.anthropic ?? null,
    config: { ...DEFAULT_BRIEFING_CONFIG, ...deps.briefingConfig },
    dailyLimit: deps.briefingDailyLimit ?? 10,
    globalDailyLimit: deps.briefingGlobalDailyLimit ?? 50,
    ...(deps.now && { now: deps.now }),
    rateLimit: limits.briefing,
    onFinished: (run) => metrics.briefingFinished(run),
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
