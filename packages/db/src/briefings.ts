import { and, count, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Database } from './client';
import { briefings, type BriefingRow } from './schema';

export interface StartBriefingInput {
  flightPlanId: string;
  model: string;
  promptVersion: string;
}

export interface FinishBriefingInput {
  status: 'done' | 'failed';
  output: unknown;
  toolCalls: unknown;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  latencyMs: number;
  error: string | null;
}

export interface BriefingRepository {
  /**
   * Records a new `pending` run. Null when this plan already has one running. A `pending` run
   * older than `staleAfterMs` (the server stopped mid-run) is marked failed first, so it cannot
   * block the plan forever.
   */
  start(
    input: StartBriefingInput,
    options?: { staleAfterMs?: number; now?: Date },
  ): Promise<{ id: string } | null>;
  /** Stores the outcome of a run started with start(). */
  finish(id: string, result: FinishBriefingInput, now?: Date): Promise<void>;
  /** The plan's most recent briefing, whatever its status. */
  latest(flightPlanId: string): Promise<BriefingRow | null>;
  /** Briefings created since `since`, across all plans, for the daily limit. */
  countSince(since: Date): Promise<number>;
}

export const INTERRUPTED_ERROR = 'Interrupted: the server stopped before the briefing finished.';

export function createBriefingRepository(db: Database): BriefingRepository {
  return {
    start: (
      { flightPlanId, model, promptVersion },
      { staleAfterMs = 5 * 60_000, now = new Date() } = {},
    ) =>
      db.transaction(async (tx) => {
        await tx
          .update(briefings)
          .set({ status: 'failed', error: INTERRUPTED_ERROR, finishedAt: now })
          .where(
            and(
              eq(briefings.flightPlanId, flightPlanId),
              eq(briefings.status, 'pending'),
              lt(briefings.createdAt, new Date(now.getTime() - staleAfterMs)),
            ),
          );

        const [row] = await tx
          .insert(briefings)
          .values({ flightPlanId, model, promptVersion, status: 'pending', createdAt: now })
          .onConflictDoNothing({
            target: briefings.flightPlanId,
            where: sql`${briefings.status} = 'pending'`,
          })
          .returning({ id: briefings.id });
        return row ?? null;
      }),

    async finish(id, result, now = new Date()) {
      await db
        .update(briefings)
        .set({ ...result, finishedAt: now })
        .where(and(eq(briefings.id, id), eq(briefings.status, 'pending')));
    },

    async latest(flightPlanId) {
      const [row] = await db
        .select()
        .from(briefings)
        .where(eq(briefings.flightPlanId, flightPlanId))
        .orderBy(desc(briefings.createdAt))
        .limit(1);
      return row ?? null;
    },

    async countSince(since) {
      const [row] = await db
        .select({ n: count() })
        .from(briefings)
        .where(gte(briefings.createdAt, since));
      return row?.n ?? 0;
    },
  };
}
