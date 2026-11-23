import type { FastifyInstance } from 'fastify';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/** Paths that are not counted as traffic: the scrape itself, and the probes' health checks. */
const UNCOUNTED = new Set(['/metrics', '/api/health']);

/**
 * The API's own metrics in Prometheus format, at GET /metrics (deployment step 7, OFP-58).
 * In the cluster, Alloy finds the pods by their k8s.grafana.com/scrape annotation and pushes
 * these to Grafana Cloud. Not reachable from outside: the load balancer and nginx only forward
 * /api to the API.
 *
 * - RED for every route: one histogram gives the Rate (its count), Errors (count by status) and
 *   Duration (its buckets). Labelled by the route *pattern* (/api/flight-plans/:id), never the
 *   real URL, so the number of series stays fixed however many plans exist.
 * - Briefings: how many, how they ended, how long they took and what they cost.
 * - Node.js itself: memory, event loop delay, garbage collection (prom-client's defaults).
 *
 * One registry per app, so tests don't share counts.
 */
export function registerMetrics(app: FastifyInstance) {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  // Names and labels follow OpenTelemetry's HTTP conventions, which Grafana's views know.
  const requestDuration = new Histogram({
    name: 'http_server_request_duration_seconds',
    help: 'Time from receiving a request to sending the response, by route and status.',
    labelNames: ['http_request_method', 'http_route', 'http_response_status_code'],
    // Fast reads (a few ms) up to SimBrief and weather calls (seconds).
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const briefings = new Counter({
    name: 'ofplens_briefings_total',
    help: 'AI briefings run, by how they ended (done, failed).',
    labelNames: ['status'],
    registers: [registry],
  });
  const briefingDuration = new Histogram({
    name: 'ofplens_briefing_duration_seconds',
    help: 'How long an AI briefing took, from the first to the last call to Claude.',
    buckets: [5, 10, 20, 30, 45, 60, 90, 120, 180],
    registers: [registry],
  });
  const briefingCost = new Counter({
    name: 'ofplens_briefing_cost_usd_total',
    help: 'What AI briefings cost in Claude usage, in US dollars.',
    registers: [registry],
  });

  app.addHook('onResponse', async (request, reply) => {
    // Unknown URLs (404s) all share one label instead of one series per URL tried.
    const route = request.routeOptions.url ?? 'unmatched';
    if (UNCOUNTED.has(route)) return;
    requestDuration.observe(
      {
        http_request_method: request.method,
        http_route: route,
        http_response_status_code: reply.statusCode,
      },
      reply.elapsedTime / 1000,
    );
  });

  app.get('/metrics', { logLevel: 'warn' }, async (_request, reply) => {
    return reply.type(registry.contentType).send(await registry.metrics());
  });

  return {
    /** One finished briefing (the route calls this after storing it). */
    briefingFinished(run: { status: string; latencyMs: number; costUsd: number | null }) {
      briefings.inc({ status: run.status });
      briefingDuration.observe(run.latencyMs / 1000);
      // Null when the model has no price in the table: nothing to add.
      if (run.costUsd !== null) briefingCost.inc(run.costUsd);
    },
  };
}

export type AppMetrics = ReturnType<typeof registerMetrics>;
