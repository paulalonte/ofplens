import type Anthropic from '@anthropic-ai/sdk';
import {
  BriefingPlanNotFoundError,
  PROMPT_VERSION,
  runBriefing,
  type BriefingConfig,
  type BriefingRun,
  type ToolDeps,
} from '@ofplens/agent';
import {
  LatestBriefingResponse,
  type BriefingEvent,
  type StoredBriefing,
} from '@ofplens/agent/contract';
import type { BriefingRepository, BriefingRow } from '@ofplens/db';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { signedIn } from '../auth/sessions';
import { AppError } from '../errors';
import { perMinute } from '../rateLimits';

export interface BriefingRouteOptions {
  briefings: BriefingRepository;
  /** What the agent's tools read from. */
  tools: ToolDeps;
  /** Null when no ANTHROPIC_API_KEY is configured: briefings answer 503. */
  anthropic: Anthropic | null;
  config: Partial<BriefingConfig> & { model: string };
  /** Briefings one pilot may start in any rolling 24 hours, across all their plans. */
  dailyLimit: number;
  /** Briefings all pilots together may start in any rolling 24 hours. */
  globalDailyLimit: number;
  now?: () => Date;
  /** Starts per minute per pilot (on top of the daily limits). */
  rateLimit?: number | undefined;
  /** Called once per finished run, done or failed (the app's metrics). */
  onFinished?: (run: BriefingRun) => void;
}

const PlanParams = z.object({ id: z.uuid('Not a flight plan id') });
const DAY_MS = 24 * 3600 * 1000;

export const briefingRoutes: FastifyPluginCallbackZod<BriefingRouteOptions> = (
  app,
  {
    briefings,
    tools,
    anthropic,
    config,
    dailyLimit,
    globalDailyLimit,
    now = () => new Date(),
    rateLimit,
    onFinished,
  },
  done,
) => {
  /** The plan's most recent briefing (done, failed or still running), or null. */
  app.get(
    '/api/flight-plans/:id/briefings/latest',
    { schema: { params: PlanParams, response: { 200: LatestBriefingResponse } } },
    async (request) => {
      const row = await briefings.latest(request.params.id);
      return { briefing: row ? toStored(row) : null };
    },
  );

  /**
   * Runs the briefing agent and streams progress as Server-Sent Events: `started`, one `tool`
   * per tool call, then `done` or `failed` with the stored briefing. Checks before streaming
   * answer as ordinary JSON errors: 503 not configured, 404, 429 a daily limit, 409 already
   * running.
   */
  app.post(
    '/api/flight-plans/:id/briefings',
    { schema: { params: PlanParams }, config: perMinute(rateLimit) },
    async (request, reply) => {
      const flightPlanId = request.params.id;
      if (!anthropic) {
        throw new AppError(
          503,
          'BRIEFINGS_NOT_CONFIGURED',
          // Shown to pilots, so it says nothing about where the key goes: the API logs that
          // at startup, for whoever runs the server (server.ts).
          'This server has no Claude API key, so AI briefings are turned off. Everything else works as usual.',
        );
      }
      const started = await briefings.start(
        {
          flightPlanId,
          pilotId: signedIn(request).id,
          model: config.model,
          promptVersion: PROMPT_VERSION,
        },
        {
          now: now(),
          limits: { perPilot: dailyLimit, global: globalDailyLimit, windowMs: DAY_MS },
        },
      );
      switch (started.status) {
        case 'started':
          break;
        case 'in-progress':
          throw new AppError(
            409,
            'BRIEFING_IN_PROGRESS',
            'A briefing for this plan is already running.',
          );
        case 'pilot-limit':
          throw new AppError(
            429,
            'BRIEFING_DAILY_LIMIT',
            `You have used your ${dailyLimit} briefings for the last 24 hours. Try again later.`,
          );
        case 'global-limit':
          throw new AppError(
            429,
            'BRIEFING_GLOBAL_LIMIT',
            'OFP Lens has reached its briefing limit for today. Try again later.',
          );
      }

      // From here on the answer is an event stream.
      await reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const send = (event: BriefingEvent) => {
        if (!res.writableEnded)
          res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      };
      send({ event: 'started', data: { id: started.id } });

      let run: BriefingRun;
      try {
        run = await runBriefing(flightPlanId, {
          client: anthropic,
          deps: tools,
          config,
          onToolCall: (call) => send({ event: 'tool', data: { name: call.name, ok: call.ok } }),
        });
      } catch (err) {
        request.log.error({ err }, 'Briefing run crashed');
        run = crashedRun(config.model, err);
      }
      onFinished?.(run);

      try {
        await briefings.finish(started.id, {
          status: run.status,
          output: run.status === 'done' ? run.briefing : null,
          toolCalls: run.toolCalls,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          costUsd: run.costUsd,
          latencyMs: run.latencyMs,
          error: run.status === 'failed' ? run.error : null,
        });
        const row = await briefings.latest(flightPlanId);
        if (row) send({ event: run.status, data: toStored(row) });
        request.log.info(
          { flightPlanId, status: run.status, costUsd: run.costUsd, turns: run.turns },
          'Briefing finished',
        );
      } catch (err) {
        request.log.error({ err }, 'Could not store the briefing');
      } finally {
        res.end();
      }
    },
  );

  done();
};

function crashedRun(model: string, err: unknown): BriefingRun {
  return {
    status: 'failed',
    error:
      err instanceof BriefingPlanNotFoundError
        ? 'The flight plan was deleted while the briefing ran.'
        : 'The briefing failed unexpectedly.',
    model,
    promptVersion: PROMPT_VERSION,
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    latencyMs: 0,
    turns: 0,
    responseModel: null,
  };
}

const toIso = (date: Date) => date.toISOString().replace('.000Z', 'Z');

export function toStored(row: BriefingRow): StoredBriefing {
  const calls = Array.isArray(row.toolCalls) ? (row.toolCalls as Record<string, unknown>[]) : [];
  return {
    id: row.id,
    flightPlanId: row.flightPlanId,
    status: row.status,
    model: row.model,
    promptVersion: row.promptVersion,
    briefing: row.status === 'done' ? (row.output as StoredBriefing['briefing']) : null,
    error: row.error,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd,
    latencyMs: row.latencyMs,
    toolCalls: calls.map((c) => ({
      name: String(c.name),
      ok: c.ok === true,
      ms: typeof c.ms === 'number' ? c.ms : 0,
      error: typeof c.error === 'string' ? c.error : null,
    })),
    createdAt: toIso(row.createdAt),
    finishedAt: row.finishedAt ? toIso(row.finishedAt) : null,
  };
}
