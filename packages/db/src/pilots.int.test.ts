import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPilotRepository } from './pilots';
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
  it('returns null before anything is saved', async () => {
    await expect(createPilotRepository(testDb.db).get()).resolves.toBeNull();
  });

  it('creates the pilot on first save and reads it back', async () => {
    const repo = createPilotRepository(testDb.db);

    await expect(repo.save({ simbriefUsername: 'jetpilot', weightUnit: 'lbs' })).resolves.toEqual({
      simbriefUsername: 'jetpilot',
      weightUnit: 'lbs',
    });
    await expect(repo.get()).resolves.toEqual({ simbriefUsername: 'jetpilot', weightUnit: 'lbs' });
  });

  it('updates the same row on later saves', async () => {
    const repo = createPilotRepository(testDb.db);
    await repo.save({ simbriefUsername: 'jetpilot', weightUnit: 'kgs' });
    const [before] = await testDb.db.select().from(pilots);

    await repo.save({ simbriefUsername: 'otherpilot', weightUnit: 'lbs' });

    const rows = await testDb.db.select().from(pilots);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: before!.id,
      simbriefUsername: 'otherpilot',
      weightUnit: 'lbs',
    });
    expect(rows[0]!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });
});
