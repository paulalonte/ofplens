import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type Database = PostgresJsDatabase;

export interface DbConnection {
  db: Database;
  /** Closes the connection pool. Call on shutdown. */
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  /** Max pool size. */
  max?: number;
  /** Seconds to wait for a new connection before failing. */
  connectTimeoutS?: number;
}

export function createDb(url: string, options: CreateDbOptions = {}): DbConnection {
  const client = postgres(url, {
    max: options.max ?? 10,
    connect_timeout: options.connectTimeoutS ?? 5,
    onnotice: () => {},
  });
  const db = drizzle(client);
  return { db, close: () => client.end({ timeout: 5 }) };
}

/** Resolves when the database answers a trivial query, rejects otherwise. */
export async function pingDb(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
