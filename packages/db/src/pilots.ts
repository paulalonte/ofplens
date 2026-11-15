import { eq } from 'drizzle-orm';
import type { Database } from './client';
import { pilots, type PilotRow } from './schema';

export interface PilotSettingsRecord {
  simbriefUsername: string;
  weightUnit: PilotRow['weightUnit'];
}

/** A signed-in pilot's settings. Swappable with an in-memory fake in route tests. */
export interface PilotRepository {
  /** The pilot's settings; null until they have saved a SimBrief username. */
  get(pilotId: string): Promise<PilotSettingsRecord | null>;
  save(pilotId: string, settings: PilotSettingsRecord): Promise<PilotSettingsRecord>;
  /**
   * Creates a pilot without a sign-in (scripts, evals and tests). Pilots of the web app are
   * created by AuthRepository.signIn.
   */
  create(settings?: Partial<PilotSettingsRecord>): Promise<{ id: string }>;
}

const toRecord = (row: Pick<PilotRow, 'simbriefUsername' | 'weightUnit'>) =>
  row.simbriefUsername === null
    ? null
    : { simbriefUsername: row.simbriefUsername, weightUnit: row.weightUnit };

export class PilotNotFoundError extends Error {
  constructor(pilotId: string) {
    super(`No pilot with id ${pilotId}`);
    this.name = 'PilotNotFoundError';
  }
}

export function createPilotRepository(db: Database): PilotRepository {
  return {
    async get(pilotId) {
      const [row] = await db.select().from(pilots).where(eq(pilots.id, pilotId));
      return row ? toRecord(row) : null;
    },

    async save(pilotId, settings) {
      const [row] = await db.update(pilots).set(settings).where(eq(pilots.id, pilotId)).returning();
      const record = row && toRecord(row);
      if (!record) throw new PilotNotFoundError(pilotId);
      return record;
    },

    async create(settings = {}) {
      const [row] = await db.insert(pilots).values(settings).returning({ id: pilots.id });
      if (!row) throw new Error('Creating the pilot returned no row');
      return row;
    },
  };
}
