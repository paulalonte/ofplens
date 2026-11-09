import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Database } from './client';

export const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../migrations');

/**
 * Applies pending SQL migrations from packages/db/migrations. Same journal as `pnpm db:migrate`
 * (drizzle-kit), so the two can be mixed. Used by tests and, later, the deploy task.
 */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
