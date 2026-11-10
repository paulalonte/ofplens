import { defineConfig, devices } from '@playwright/test';
import { API_PORT, e2eDatabaseUrl, FAKE_UPSTREAMS_PORT, WEB_PORT } from './ports';

const CI = !!process.env.CI;

/**
 * The real web app and API against a fresh Postgres database, with SimBrief and
 * aviationweather.gov faked.
 * Locally: Docker Postgres must be running (`pnpm db:up`). Run with `pnpm e2e`.
 */
export default defineConfig({
  testDir: './tests',
  // The tests share one database and walk through it in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm exec tsx fake-upstreams.ts',
      url: `http://127.0.0.1:${FAKE_UPSTREAMS_PORT}/health`,
      reuseExistingServer: false,
    },
    {
      // A fresh database on every run, then the real API pointed at the fakes.
      command: 'pnpm exec tsx prepare-db.ts && pnpm --filter @ofplens/api start',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: e2eDatabaseUrl(),
        PORT: String(API_PORT),
        SIMBRIEF_URL: `http://127.0.0.1:${FAKE_UPSTREAMS_PORT}/api/xml.fetcher.php`,
        AVIATION_WEATHER_URL: `http://127.0.0.1:${FAKE_UPSTREAMS_PORT}/api/data`,
        LOG_LEVEL: 'warn',
      },
      timeout: 60_000,
    },
    {
      // PORT tells Vite's /api proxy where this run's API listens.
      command: `pnpm --filter @ofplens/web exec vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { PORT: String(API_PORT) },
      timeout: 60_000,
    },
  ],
});
