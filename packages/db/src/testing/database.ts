import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { createDb, type Database } from '../client';
import { runMigrations } from '../migrate';

/**
 * Real-Postgres test databases. Each integration test file gets its own freshly migrated
 * database, so files can run in parallel and never see each other's rows.
 *
 * Uses TEST_DATABASE_URL (CI) or the docker-compose Postgres on :5433 (local, `pnpm db:up`).
 */

export const TEST_DB_PREFIX = 'ofplens_test_';
const DEFAULT_URL = 'postgres://ofplens:ofplens@localhost:5433/ofplens';

export function testDatabaseServerUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_URL;
}

export interface TestDatabase {
  db: Database;
  name: string;
  url: string;
  /** Closes connections and drops the database. */
  destroy: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const serverUrl = testDatabaseServerUrl();
  const admin = postgres(serverUrl, { max: 1, connect_timeout: 3, onnotice: () => {} });
  const name = `${TEST_DB_PREFIX}${randomBytes(4).toString('hex')}`;

  try {
    await admin.unsafe(`create database ${name}`);
  } catch (err) {
    await admin.end();
    throw unreachable(serverUrl, err);
  }

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const conn = createDb(url.toString(), { max: 5 });
  await runMigrations(conn.db);

  return {
    db: conn.db,
    name,
    url: url.toString(),
    async destroy() {
      await conn.close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}

/** Empties every app table between tests, keeping the schema. */
export async function truncateAll(db: Database): Promise<void> {
  await db.execute(sql`
    truncate table pilots, flight_plans, flight_plan_fuel, flight_plan_weights,
                   waypoints, weather_reports, briefings, advisories
    restart identity cascade
  `);
}

const APP_TABLES = [
  'pilots',
  'flight_plans',
  'flight_plan_fuel',
  'flight_plan_weights',
  'waypoints',
  'weather_reports',
  'briefings',
  'advisories',
] as const;
export type AppTable = (typeof APP_TABLES)[number];

/** Number of rows in one of the app's tables. */
export async function countRows(db: Database, table: AppTable): Promise<number> {
  if (!APP_TABLES.includes(table)) throw new Error(`Unknown table ${String(table)}`);
  const [row] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return row?.n ?? 0;
}

/** Drops test databases left behind by crashed runs. Called once before the integration tests. */
export async function dropLeftoverTestDatabases(): Promise<string[]> {
  const serverUrl = testDatabaseServerUrl();
  const admin = postgres(serverUrl, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    const rows = await admin<{ datname: string }[]>`
      select datname from pg_database where datname like ${TEST_DB_PREFIX + '%'}
    `;
    for (const { datname } of rows) {
      await admin.unsafe(`drop database if exists ${datname} with (force)`);
    }
    return rows.map((r) => r.datname);
  } catch (err) {
    throw unreachable(serverUrl, err);
  } finally {
    await admin.end();
  }
}

function unreachable(serverUrl: string, cause: unknown): Error {
  const where = new URL(serverUrl);
  where.password = '';
  return new Error(
    `Integration tests need Postgres at ${where.host} (from ${
      process.env.TEST_DATABASE_URL ? 'TEST_DATABASE_URL' : 'docker-compose'
    }). Start it with \`pnpm db:up\` and try again.`,
    { cause },
  );
}
