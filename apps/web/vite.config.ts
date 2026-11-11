import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = new URL('../..', import.meta.url).pathname;

export default defineConfig(({ mode }) => {
  // Read the API's PORT from the shared root .env so the proxy follows it.
  const env = loadEnv(mode, repoRoot, '');
  const apiPort = env.PORT ?? '3000';

  return {
    plugins: [
      // File-based routing: generates src/routeTree.gen.ts from src/routes. Must run before react().
      // Files and folders starting with "-" (e.g. -components/) and *.test.* files are not routes.
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routeFileIgnorePattern: '\\.test\\.',
      }),
      react(),
      tailwindcss(),
    ],
    build: {
      // The route map's MapLibre chunk (~1.1 MB, 290 kB gzipped) loads only when the map is
      // shown; anything else this large would still warn.
      chunkSizeWarningLimit: 1200,
    },
    server: {
      port: 5173,
      strictPort: true,
      // The browser only ever talks to /api on its own origin; Vite forwards it to Fastify.
      proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    },
    test: {
      name: 'web',
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['src/test/setup.ts'],
    },
  };
});
