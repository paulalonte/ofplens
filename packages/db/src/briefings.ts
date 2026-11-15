import { and, count, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Database } from './client';
import { briefings, briefingUsage, type BriefingRow } from './schema';

export interface StartBriefingInput {
  flightPlanId: string;
  /** Whose quota the run counts against: the plan's pilot. */
  pilotId: string;
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

/** Briefings allowed in any rolling window (24 hours in the API). */
export interface BriefingLimits {
  perPilot: number;
  /** All pilots together: the ceiling on the Claude bill. */
  global: number;
  windowMs: number;
}

export type StartBriefingResult =
  | { status: 'started'; id: string }
  /** This plan already has a briefing running. */
  | { status: 'in-progress' }
  | { status: 'pilot-limit' }
  | { status: 'global-limit' };

export interface BriefingRepository {
  /**
   * Records a new `pending` run and counts it against the limits, all in one transaction, so
   * two requests at the same moment cannot both squeeze under a limit. A `pending` run older
   * than `staleAfterMs` (the server stopped mid-run) is marked failed first, so it cannot
   * block the plan forever. Without `limits` nothing is limited (scripts and tests).
   */
  start(
    input: StartBriefingInput,
    options?: { staleAfterMs?: number; now?: Date; limits?: BriefingLimits },
  ): Promise<StartBriefingResult>;
  /** Stores the outcome of a run started with start(). */
  finish(id: string, result: FinishBriefingInput, now?: Date): Promise<void>;
  /** The plan's most recent briefing, whatever its status. */
  latest(flightPlanId: string): Promise<BriefingRow | null>;
  /** Briefings started since `since`, by one pilot or by everyone. Deleted plans still count. */
  countSince(since: Date, pilotId?: string): Promise<number>;
}

export const INTERRUPTED_ERROR = 'Interrupted: the server stopped before the briefing finished.';

export function createBriefingRepository(db: Database): BriefingRepository {
  return {
    start: (
      { flightPlanId, pilotId, model, promptVersion },
      { staleAfterMs = 5 * 60_000, now = new Date(), limits } = {},
    ) =>
      db.transaction(async (tx): Promise<StartBriefingResult> => {
        // Starts are rare (a few a day per pilot): taking them one at a time keeps counting
        // and inserting race-free.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ofplens:briefing-start'))`);

        if (limits) {
          const since = new Date(now.getTime() - limits.windowMs);
          const [usage] = await tx
            .select({
              all: count(),
              mine: sql<number>`count(*) filter (where ${briefingUsage.pilotId} = ${pilotId})`.mapWith(
                Number,
              ),
            })
            .from(briefingUsage)
            .where(gte(briefingUsage.createdAt, since));
          if ((usage?.mine ?? 0) >= limits.perPilot) return { status: 'pilot-limit' };
          if ((usage?.all ?? 0) >= limits.global) return { status: 'global-limit' };
        }

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
        if (!row) return { status: 'in-progress' };

        await tx.insert(briefingUsage).values({ pilotId, createdAt: now });
        return { status: 'started', id: row.id };
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

    async countSince(since, pilotId) {
      const [row] = await db
        .select({ n: count() })
        .from(briefingUsage)
        .where(
          and(
            gte(briefingUsage.createdAt, since),
            pilotId === undefined ? undefined : eq(briefingUsage.pilotId, pilotId),
          ),
        );
      return row?.n ?? 0;
    },
  };
}
