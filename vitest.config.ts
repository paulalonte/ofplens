import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      // Browser-like tests (jsdom) are configured in the web app's own vite.config.ts.
      'apps/web',
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['apps/api/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
          exclude: ['**/*.int.test.ts'],
        },
      },
      {
        // Against a real Postgres: `pnpm db:up` locally, a service container in CI.
        test: {
          name: 'integration',
          environment: 'node',
          include: ['apps/api/src/**/*.int.test.ts', 'packages/*/src/**/*.int.test.ts'],
          globalSetup: ['packages/db/src/testing/globalSetup.ts'],
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
