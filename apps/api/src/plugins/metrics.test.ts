import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app';
import { testDeps } from '../testing/fakes';

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const scrape = async (a: App) => (await a.inject({ method: 'GET', url: '/metrics' })).body;

/** The value of the first series with this name and these labels, or undefined. */
function value(text: string, name: string, labels: Record<string, string>): number | undefined {
  const line = text
    .split('\n')
    .find(
      (l) =>
        l.startsWith(`${name}{`) &&
        Object.entries(labels).every(([k, v]) => l.includes(`${k}="${v}"`)),
    );
  return line === undefined ? undefined : Number(line.split(' ').at(-1));
}

describe('GET /metrics', () => {
  it('serves Prometheus text, without a session, including Node.js metrics', async () => {
    app = await buildApp(testDeps({ authenticate: () => Promise.resolve(null) }));

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('# TYPE http_server_request_duration_seconds histogram');
    expect(res.body).toContain('nodejs_eventloop_lag_seconds');
    expect(res.body).toContain('# TYPE ofplens_briefings_total counter');
  });

  it('counts requests by route pattern, method and status', async () => {
    app = await buildApp(testDeps());

    await app.inject({ method: 'GET', url: '/api/pilot' });
    await app.inject({ method: 'GET', url: '/api/pilot' });
    await app.inject({
      method: 'GET',
      url: '/api/flight-plans/33333333-3333-4333-8333-333333333333',
    });
    await app.inject({ method: 'GET', url: '/api/no-such-thing' });
    const text = await scrape(app);

    const count = 'http_server_request_duration_seconds_count';
    expect(value(text, count, { http_route: '/api/pilot', http_response_status_code: '200' })).toBe(
      2,
    );
    // The pattern, not the plan's id: one series however many plans there are.
    expect(
      value(text, count, { http_route: '/api/flight-plans/:id', http_response_status_code: '404' }),
    ).toBe(1);
    expect(text).not.toContain('33333333-3333');
    // Unknown URLs share one label.
    expect(value(text, count, { http_route: 'unmatched', http_response_status_code: '404' })).toBe(
      1,
    );
    expect(text).not.toContain('no-such-thing');
  });

  it('leaves out health checks and the scrape itself', async () => {
    app = await buildApp(testDeps());

    await app.inject({ method: 'GET', url: '/api/health' });
    await scrape(app);
    const text = await scrape(app);

    expect(text).not.toContain('http_route="/api/health"');
    expect(text).not.toContain('http_route="/metrics"');
  });

  it('keeps counts per app (tests do not share them)', async () => {
    const first = await buildApp(testDeps());
    await first.inject({ method: 'GET', url: '/api/pilot' });
    await first.close();
    app = await buildApp(testDeps());

    expect(await scrape(app)).not.toContain('http_route="/api/pilot"');
  });
});
