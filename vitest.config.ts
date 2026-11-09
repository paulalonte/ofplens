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
        },
      },
    ],
  },
});
