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
import { AppError } from '../errors';

export interface BriefingRouteOptions {
  briefings: BriefingRepository;
  /** What the agent's tools read from. */
  tools: ToolDeps;
  /** Null when no ANTHROPIC_API_KEY is configured: briefings answer 503. */
  anthropic: Anthropic | null;
  config: Partial<BriefingConfig> & { model: string };
  /** Briefings allowed in any rolling 24 hours, across all plans. */
  dailyLimit: number;
  now?: () => Date;
}

const PlanParams = z.object({ id: z.uuid('Not a flight plan id') });
const DAY_MS = 24 * 3600 * 1000;

export const briefingRoutes: FastifyPluginCallbackZod<BriefingRouteOptions> = (
  app,
  { briefings, tools, anthropic, config, dailyLimit, now = () => new Date() },
  done,
) => {
  /** The plan's most recent briefing (done, failed or still running), or null. */
  app.get(
    '/api/flight-plans/:id/briefings/latest',
    { schema: { params: PlanParams, response: { 200: LatestBriefingResponse } } },
    async (request) => {
      if (!(await tools.flightPlans.get(request.params.id))) throw planNotFound();
      const row = await briefings.latest(request.params.id);
      return { briefing: row ? toStored(row) : null };
    },
  );

  /**
   * Runs the briefing agent and streams progress as Server-Sent Events: `started`, one `tool`
   * per tool call, then `done` or `failed` with the stored briefing. Checks before streaming
   * answer as ordinary JSON errors: 503 not configured, 404, 429 daily limit, 409 already running.
   */
  app.post(
    '/api/flight-plans/:id/briefings',
    { schema: { params: PlanParams } },
    async (request, reply) => {
      const flightPlanId = request.params.id;
      if (!anthropic) {
        throw new AppError(
          503,
          'BRIEFINGS_NOT_CONFIGURED',
          'AI briefings are not set up on this server: add ANTHROPIC_API_KEY to .env and restart.',
        );
      }
      if (!(await tools.flightPlans.get(flightPlanId))) throw planNotFound();
      const at = now();
      if ((await briefings.countSince(new Date(at.getTime() - DAY_MS))) >= dailyLimit) {
        throw new AppError(
          429,
          'BRIEFING_DAILY_LIMIT',
          `The limit of ${dailyLimit} briefings per day has been reached. Try again later.`,
        );
      }
      const started = await briefings.start(
        { flightPlanId, model: config.model, promptVersion: PROMPT_VERSION },
        { now: at },
      );
      if (!started) {
        throw new AppError(
          409,
          'BRIEFING_IN_PROGRESS',
          'A briefing for this plan is already running.',
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

const planNotFound = () =>
  new AppError(
    404,
    'FLIGHT_PLAN_NOT_FOUND',
    'That flight plan does not exist (it may have been deleted).',
  );

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
