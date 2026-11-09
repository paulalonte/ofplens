import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp, type App } from '../app';
import { AppError } from '../errors';

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function appWithTestRoutes(): Promise<App> {
  const a = await buildApp({ pingDb: () => Promise.resolve() });
  a.get('/boom/app-error', () => {
    throw new AppError(404, 'PLAN_NOT_FOUND', 'No such flight plan');
  });
  a.get('/boom/unexpected', () => {
    throw new Error('secret connection string leaked');
  });
  a.get(
    '/boom/validated',
    { schema: { querystring: z.object({ limit: z.coerce.number().int().max(50) }) } },
    () => ({ ok: true }),
  );
  return a;
}

describe('error handling', () => {
  it('wraps unknown routes as NOT_FOUND', async () => {
    app = await appWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /api/nope not found' },
    });
  });

  it('passes AppError status, code and message through', async () => {
    app = await appWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/boom/app-error' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'PLAN_NOT_FOUND', message: 'No such flight plan' },
    });
  });

  it('hides details of unexpected errors behind a generic 500', async () => {
    app = await appWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/boom/unexpected' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
    expect(res.body).not.toContain('secret');
  });

  it('reports schema validation failures as 400 VALIDATION_ERROR', async () => {
    app = await appWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/boom/validated?limit=500' });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/limit/);
  });
});
