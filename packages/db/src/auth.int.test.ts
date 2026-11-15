import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthRepository, hashToken, type SignInProfile } from './auth';
import { createPilotRepository } from './pilots';
import { sessions } from './schema';
import { countRows, createTestDatabase, truncateAll, type TestDatabase } from './testing';

let testDb: TestDatabase;
beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await testDb.destroy();
});
beforeEach(async () => {
  await truncateAll(testDb.db);
});

const github: SignInProfile = {
  provider: 'github',
  subject: '1001',
  email: 'ana@example.com',
  displayName: 'Ana',
  avatarUrl: 'https://avatars.example.com/1001',
};
const google: SignInProfile = { ...github, provider: 'google', subject: 'g-2002' };
const DAY = 24 * 3600_000;

describe('sign-in (Postgres)', () => {
  it('creates a pilot at the first sign-in and finds the same one afterwards', async () => {
    const auth = createAuthRepository(testDb.db);

    const first = await auth.signIn(github);
    const again = await auth.signIn({ ...github, displayName: 'Ana B.' });

    expect(first).toEqual({ pilotId: expect.any(String), created: true, claimed: false });
    expect(again).toEqual({ pilotId: first.pilotId, created: false, claimed: false });
    expect(await countRows(testDb.db, 'pilots')).toBe(1);
  });

  it('keys accounts by provider and subject, never by email', async () => {
    const auth = createAuthRepository(testDb.db);

    const a = await auth.signIn(github);
    // Same email at another provider, and another GitHub account that took over the address.
    const b = await auth.signIn(google);
    const c = await auth.signIn({ ...github, subject: '9999' });

    expect(new Set([a.pilotId, b.pilotId, c.pilotId]).size).toBe(3);
  });

  it('lets the first account take over the pilot from before sign-in, and only the first', async () => {
    const legacy = await createPilotRepository(testDb.db).create({ simbriefUsername: 'jetpilot' });
    const auth = createAuthRepository(testDb.db);

    const first = await auth.signIn(github);
    const second = await auth.signIn(google);

    expect(first).toEqual({ pilotId: legacy.id, created: false, claimed: true });
    expect(second.created).toBe(true);
    expect(second.pilotId).not.toBe(legacy.id);
  });

  it('lets only one of two simultaneous first sign-ins claim the old pilot', async () => {
    await createPilotRepository(testDb.db).create({ simbriefUsername: 'jetpilot' });
    const auth = createAuthRepository(testDb.db);

    const results = await Promise.all([auth.signIn(github), auth.signIn(google)]);

    expect(results.map((r) => r.claimed).sort()).toEqual([false, true]);
  });
});

describe('sessions (Postgres)', () => {
  it('finds the pilot behind a token, with their latest name and picture', async () => {
    const auth = createAuthRepository(testDb.db);
    const { pilotId } = await auth.signIn(github);
    const { token, expiresAt } = await auth.createSession(pilotId, { ttlMs: DAY });

    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    await expect(auth.findSession(token)).resolves.toEqual({
      id: pilotId,
      displayName: 'Ana',
      email: 'ana@example.com',
      avatarUrl: 'https://avatars.example.com/1001',
    });
  });

  it('stores only a hash of the token', async () => {
    const auth = createAuthRepository(testDb.db);
    const { pilotId } = await auth.signIn(github);
    const { token } = await auth.createSession(pilotId, { ttlMs: DAY });

    const rows = await testDb.db.select().from(sessions);
    expect(rows.map((r) => r.id)).toEqual([hashToken(token)]);
    expect(JSON.stringify(rows)).not.toContain(token);
    // The hash itself is not a working token.
    await expect(auth.findSession(hashToken(token))).resolves.toBeNull();
  });

  it('does not find unknown, expired or signed-out sessions, and clears expired ones', async () => {
    const auth = createAuthRepository(testDb.db);
    const { pilotId } = await auth.signIn(github);
    const t0 = new Date('2026-11-10T10:00:00Z');
    const current = await auth.createSession(pilotId, { ttlMs: DAY });
    const old = await auth.createSession(pilotId, { ttlMs: DAY, now: t0 });

    await expect(auth.findSession('not-a-token')).resolves.toBeNull();
    await expect(auth.findSession(old.token, new Date(t0.getTime() + DAY))).resolves.toBeNull();
    await expect(auth.findSession(old.token, t0)).resolves.not.toBeNull();

    // A new session is a good moment to drop the expired ones.
    await auth.createSession(pilotId, { ttlMs: DAY });
    expect(await countRows(testDb.db, 'sessions')).toBe(2);

    await auth.deleteSession(current.token);
    await expect(auth.findSession(current.token)).resolves.toBeNull();
  });
});
