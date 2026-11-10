/** Recreates the end-to-end database empty and migrated, so every run starts from scratch. */
import { createDb, runMigrations } from '@ofplens/db';
import postgres from 'postgres';
import { E2E_DATABASE, e2eDatabaseUrl, POSTGRES_SERVER_URL } from './ports';

const admin = postgres(POSTGRES_SERVER_URL, { max: 1, onnotice: () => {} });
try {
  await admin.unsafe(`drop database if exists ${E2E_DATABASE} with (force)`);
  await admin.unsafe(`create database ${E2E_DATABASE}`);
} finally {
  await admin.end();
}

const { db, close } = createDb(e2eDatabaseUrl());
await runMigrations(db);
await close();
console.log(`Prepared an empty, migrated ${E2E_DATABASE} database`);
