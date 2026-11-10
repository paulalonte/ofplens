import type { FlightPlanRepository, PilotRepository } from '@ofplens/db';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerErrorHandling } from './plugins/errors';
import { flightPlanRoutes } from './routes/flightPlans';
import { healthRoutes } from './routes/health';
import { pilotRoutes } from './routes/pilot';
import { simbriefRoutes } from './routes/simbrief';
import { createSimbriefClient, type SimbriefClient } from './simbrief';

export interface AppDeps {
  pingDb: () => Promise<void>;
  pilots: PilotRepository;
  flightPlans: FlightPlanRepository;
  /** Defaults to the real SimBrief client, logging through the app's logger. */
  simbrief?: SimbriefClient;
  /** Base URL for the default SimBrief client (end-to-end tests point it at a fake). */
  simbriefUrl?: string | undefined;
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

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
