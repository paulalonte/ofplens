/** Ports for the end-to-end stack, chosen so it can run next to `pnpm dev` (5173 / 3000). */
export const FAKE_SIMBRIEF_PORT = 4010;
export const API_PORT = 3100;
export const WEB_PORT = 5174;

/** Postgres server: CI's service container, or the docker-compose one locally. */
export const POSTGRES_SERVER_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://ofplens:ofplens@localhost:5433/ofplens';

/** The end-to-end database, recreated empty before every run. Never the dev database. */
export const E2E_DATABASE = 'ofplens_e2e';

export function e2eDatabaseUrl(): string {
  const url = new URL(POSTGRES_SERVER_URL);
  url.pathname = `/${E2E_DATABASE}`;
  return url.toString();
}
