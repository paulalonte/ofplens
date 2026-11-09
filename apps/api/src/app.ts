import type { PilotRepository } from '@ofplens/db';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerErrorHandling } from './plugins/errors';
import { healthRoutes } from './routes/health';
import { pilotRoutes } from './routes/pilot';
import { simbriefRoutes } from './routes/simbrief';
import { createSimbriefClient, type SimbriefClient } from './simbrief';

export interface AppDeps {
  pingDb: () => Promise<void>;
  pilots: PilotRepository;
  /** Defaults to the real SimBrief client, logging through the app's logger. */
  simbrief?: SimbriefClient;
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
  await app.register(simbriefRoutes, {
    pilots: deps.pilots,
    simbrief: deps.simbrief ?? createSimbriefClient({ log: app.log }),
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
