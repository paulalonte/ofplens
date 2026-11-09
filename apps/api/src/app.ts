import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerErrorHandling } from './plugins/errors';
import { healthRoutes } from './routes/health';

export interface AppDeps {
  pingDb: () => Promise<void>;
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

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
