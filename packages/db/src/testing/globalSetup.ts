import { dropLeftoverTestDatabases } from './database';

/** Vitest globalSetup for the integration project: fail fast if Postgres is down, tidy up. */
export default async function setup(): Promise<void> {
  const dropped = await dropLeftoverTestDatabases();
  if (dropped.length > 0) {
    console.log(`Dropped ${dropped.length} leftover test database(s).`);
  }
}
