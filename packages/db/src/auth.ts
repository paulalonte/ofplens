import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import type { Database } from './client';
import { pilotIdentities, pilots, sessions } from './schema';

export type AuthProviderId = (typeof pilotIdentities.$inferSelect)['provider'];

/** Who signed in, as the provider told us. */
export interface SignInProfile {
  provider: AuthProviderId;
  /** The provider's stable user id (never the email: emails change and get reused). */
  subject: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface SignInResult {
  pilotId: string;
  /** A new pilot was created for this account. */
  created: boolean;
  /** This first account took over the pilot from before sign-in existed (see signIn). */
  claimed: boolean;
}

/** The signed-in pilot, as every request sees it. */
export interface SessionPilot {
  id: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface AuthRepository {
  /**
   * Finds or creates the pilot for a provider account and refreshes their name, email and
   * picture. The very first account to sign in to a server takes over the pilot (and plans)
   * that existed before sign-in was added, so a single-pilot install keeps its history.
   */
  signIn(profile: SignInProfile, now?: Date): Promise<SignInResult>;
  /** A new session for the pilot. Only the token's hash is stored; the token goes in the cookie. */
  createSession(
    pilotId: string,
    options: { ttlMs: number; now?: Date },
  ): Promise<{ token: string; expiresAt: Date }>;
  /** The pilot behind a session token, or null when it is unknown or expired. */
  findSession(token: string, now?: Date): Promise<SessionPilot | null>;
  deleteSession(token: string): Promise<void>;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function createAuthRepository(db: Database): AuthRepository {
  return {
    signIn: (profile, now = new Date()) =>
      db.transaction(async (tx) => {
        // One sign-in at a time, so two first sign-ins cannot both claim the old pilot.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ofplens:sign-in'))`);

        const details = {
          displayName: profile.displayName,
          email: profile.email,
          avatarUrl: profile.avatarUrl,
        };
        const [identity] = await tx
          .select({ id: pilotIdentities.id, pilotId: pilotIdentities.pilotId })
          .from(pilotIdentities)
          .where(
            and(
              eq(pilotIdentities.provider, profile.provider),
              eq(pilotIdentities.subject, profile.subject),
            ),
          );

        if (identity) {
          await tx
            .update(pilotIdentities)
            .set({ email: profile.email, lastSignInAt: now })
            .where(eq(pilotIdentities.id, identity.id));
          await tx.update(pilots).set(details).where(eq(pilots.id, identity.pilotId));
          return { pilotId: identity.pilotId, created: false, claimed: false };
        }

        const [anyIdentity] = await tx
          .select({ id: pilotIdentities.id })
          .from(pilotIdentities)
          .limit(1);
        const [legacy] = anyIdentity
          ? []
          : await tx.select({ id: pilots.id }).from(pilots).orderBy(asc(pilots.createdAt)).limit(1);

        let pilotId: string;
        if (legacy) {
          await tx.update(pilots).set(details).where(eq(pilots.id, legacy.id));
          pilotId = legacy.id;
        } else {
          const [row] = await tx.insert(pilots).values(details).returning({ id: pilots.id });
          if (!row) throw new Error('Creating the pilot returned no row');
          pilotId = row.id;
        }

        await tx.insert(pilotIdentities).values({
          pilotId,
          provider: profile.provider,
          subject: profile.subject,
          email: profile.email,
          createdAt: now,
          lastSignInAt: now,
        });
        return { pilotId, created: !legacy, claimed: !!legacy };
      }),

    async createSession(pilotId, { ttlMs, now = new Date() }) {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + ttlMs);
      // Housekeeping: expired sessions are useless; drop them while we are here.
      await db.delete(sessions).where(lte(sessions.expiresAt, now));
      await db
        .insert(sessions)
        .values({ id: hashToken(token), pilotId, createdAt: now, expiresAt });
      return { token, expiresAt };
    },

    async findSession(token, now = new Date()) {
      const [row] = await db
        .select({
          id: pilots.id,
          displayName: pilots.displayName,
          email: pilots.email,
          avatarUrl: pilots.avatarUrl,
        })
        .from(sessions)
        .innerJoin(pilots, eq(pilots.id, sessions.pilotId))
        .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, now)));
      return row ?? null;
    },

    async deleteSession(token) {
      await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
    },
  };
}
