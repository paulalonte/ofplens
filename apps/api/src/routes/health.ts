import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export interface HealthRouteOptions {
  /** Resolves if the database is reachable. */
  pingDb: () => Promise<void>;
  /** How long to wait for the database before reporting it down. */
  dbTimeoutMs?: number;
}

const HealthResponse = z.object({
  status: z.enum(['ok', 'error']),
  db: z.enum(['up', 'down']),
});

export const healthRoutes: FastifyPluginCallbackZod<HealthRouteOptions> = (app, opts, done) => {
  const timeoutMs = opts.dbTimeoutMs ?? 2000;

  app.get(
    '/api/health',
    { schema: { response: { 200: HealthResponse, 503: HealthResponse } } },
    async (request, reply) => {
      try {
        await withTimeout(opts.pingDb(), timeoutMs);
        return { status: 'ok', db: 'up' } as const;
      } catch (err) {
        request.log.warn({ err }, 'Health check: database unreachable');
        return reply.status(503).send({ status: 'error', db: 'down' });
      }
    },
  );

  done();
};

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
