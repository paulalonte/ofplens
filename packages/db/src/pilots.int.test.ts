import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPilotRepository, PilotNotFoundError } from './pilots';
import { pilots } from './schema';
import { createTestDatabase, truncateAll, type TestDatabase } from './testing';

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

describe('pilot repository (Postgres)', () => {
  it('has no settings until the pilot saves them', async () => {
    const repo = createPilotRepository(testDb.db);
    const { id } = await repo.create();

    await expect(repo.get(id)).resolves.toBeNull();
  });

  it('saves and reads back one pilot’s settings, leaving other pilots alone', async () => {
    const repo = createPilotRepository(testDb.db);
    const { id } = await repo.create();
    const other = await repo.create({ simbriefUsername: 'otherpilot', weightUnit: 'kgs' });
    const [before] = await testDb.db.select().from(pilots).where(eq(pilots.id, id));

    await expect(
      repo.save(id, { simbriefUsername: 'jetpilot', weightUnit: 'lbs' }),
    ).resolves.toEqual({ simbriefUsername: 'jetpilot', weightUnit: 'lbs' });

    await expect(repo.get(id)).resolves.toEqual({
      simbriefUsername: 'jetpilot',
      weightUnit: 'lbs',
    });
    await expect(repo.get(other.id)).resolves.toEqual({
      simbriefUsername: 'otherpilot',
      weightUnit: 'kgs',
    });
    const [after] = await testDb.db.select().from(pilots).where(eq(pilots.id, id));
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });

  it('allows two pilots with the same SimBrief username', async () => {
    const repo = createPilotRepository(testDb.db);
    await repo.create({ simbriefUsername: 'jetpilot' });
    await expect(repo.create({ simbriefUsername: 'jetpilot' })).resolves.toEqual({
      id: expect.any(String),
    });
  });

  it('refuses to save settings for a pilot that does not exist', async () => {
    await expect(
      createPilotRepository(testDb.db).save('00000000-0000-4000-8000-000000000000', {
        simbriefUsername: 'jetpilot',
        weightUnit: 'kgs',
      }),
    ).rejects.toBeInstanceOf(PilotNotFoundError);
  });
});
