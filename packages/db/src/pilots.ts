import { asc, eq } from 'drizzle-orm';
import type { Database } from './client';
import { pilots, type PilotRow } from './schema';

export interface PilotSettingsRecord {
  simbriefUsername: string;
  weightUnit: PilotRow['weightUnit'];
}

/** Reads and writes the app's single pilot. Swappable with an in-memory fake in route tests. */
export interface PilotRepository {
  get(): Promise<PilotSettingsRecord | null>;
  /** Creates the pilot on first save, updates it afterwards. */
  save(settings: PilotSettingsRecord): Promise<PilotSettingsRecord>;
}

const toRecord = (row: PilotRow): PilotSettingsRecord => ({
  simbriefUsername: row.simbriefUsername,
  weightUnit: row.weightUnit,
});

export function createPilotRepository(db: Database): PilotRepository {
  return {
    async get() {
      const [row] = await db.select().from(pilots).orderBy(asc(pilots.createdAt)).limit(1);
      return row ? toRecord(row) : null;
    },

    async save(settings) {
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: pilots.id })
          .from(pilots)
          .orderBy(asc(pilots.createdAt))
          .limit(1)
          .for('update');

        const [row] = existing
          ? await tx.update(pilots).set(settings).where(eq(pilots.id, existing.id)).returning()
          : await tx.insert(pilots).values(settings).returning();

        if (!row) throw new Error('Saving the pilot returned no row');
        return toRecord(row);
      });
    },
  };
}
