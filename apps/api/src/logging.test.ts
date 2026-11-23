import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, loggerOptions, type App } from './app';
import { testDeps } from './testing/fakes';

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Builds the app with the real logger options, writing log lines into an array. */
async function withLogs(overrides: Parameters<typeof testDeps>[0] = {}) {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, next) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      next();
    },
  });
  app = await buildApp(testDeps({ ...overrides, logger: { ...loggerOptions('info'), stream } }));
  return { app, lines };
}

describe('API logs', () => {
  it('writes the level as a word', async () => {
    const { app, lines } = await withLogs();

    await app.inject({ method: 'GET', url: '/api/pilot' });

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.level === 'info')).toBe(true);
  });

  it('logs health checks and scrapes only when something is wrong', async () => {
    let dbUp = true;
    const { app, lines } = await withLogs({
      pingDb: () => (dbUp ? Promise.resolve() : Promise.reject(new Error('ECONNREFUSED'))),
    });

    await app.inject({ method: 'GET', url: '/api/health' });
    await app.inject({ method: 'GET', url: '/metrics' });
    expect(lines).toEqual([]);

    dbUp = false;
    await app.inject({ method: 'GET', url: '/api/health' });
    expect(lines).toEqual([
      expect.objectContaining({ level: 'warn', msg: 'Health check: database unreachable' }),
    ]);
  });
});
