import type Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_BRIEFING_CONFIG, type BriefingConfig } from '@ofplens/agent';
import type {
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
import { registerErrorHandling } from './plugins/errors';
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
  pilots: PilotRepository;
  flightPlans: FlightPlanRepository;
  weatherReports: WeatherRepository;
  briefings: BriefingRepository;
  hazards: HazardRepository;
  /** Claude client for briefings; null or absent = briefings answer 503 (no API key). */
  anthropic?: Anthropic | null;
  briefingConfig?: Partial<BriefingConfig>;
  /** Briefings per rolling 24 hours (default 20). */
  briefingDailyLimit?: number;
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

/** Builds the Fastify app without listening, so tests can drive it with `app.inject()`. */
export async function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.logger ?? false }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  await app.register(healthRoutes, {
    pingDb: deps.pingDb,
    ...(deps.dbTimeoutMs !== undefined && { dbTimeoutMs: deps.dbTimeoutMs }),
  });
  await app.register(pilotRoutes, { pilots: deps.pilots });
  const simbrief =
    deps.simbrief ??
    createSimbriefClient({
      log: app.log,
      ...(deps.simbriefUrl !== undefined && { baseUrl: deps.simbriefUrl }),
    });
  await app.register(simbriefRoutes, { pilots: deps.pilots, simbrief });
  await app.register(flightPlanRoutes, {
    pilots: deps.pilots,
    flightPlans: deps.flightPlans,
    simbrief,
  });
  // One cached weather client, shared by the weather endpoints and the briefing agent.
  const weather =
    deps.weather ??
    createCachedWeatherClient(
      createWeatherClient({
        log: app.log,
        ...(deps.aviationWeatherUrl !== undefined && { baseUrl: deps.aviationWeatherUrl }),
      }),
    );
  await app.register(weatherRoutes, { weatherReports: deps.weatherReports, weather });
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
  });
  await app.register(briefingRoutes, {
    briefings: deps.briefings,
    tools: { flightPlans: deps.flightPlans, weatherReports: deps.weatherReports, weather },
    anthropic: deps.anthropic ?? null,
    config: { ...DEFAULT_BRIEFING_CONFIG, ...deps.briefingConfig },
    dailyLimit: deps.briefingDailyLimit ?? 20,
    ...(deps.now && { now: deps.now }),
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
