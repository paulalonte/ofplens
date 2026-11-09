import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app';
import { testDeps } from '../testing/fakes';

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/health', () => {
  it('returns 200 when the database answers', async () => {
    app = await buildApp(testDeps());

    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'up' });
  });

  it('returns 503 when the database rejects', async () => {
    app = await buildApp(testDeps({ pingDb: () => Promise.reject(new Error('ECONNREFUSED')) }));

    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', db: 'down' });
  });

  it('returns 503 when the database does not answer in time', async () => {
    app = await buildApp(testDeps({ pingDb: () => new Promise(() => {}), dbTimeoutMs: 20 }));

    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', db: 'down' });
  });
});
