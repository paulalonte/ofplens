import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = new URL('../..', import.meta.url).pathname;

export default defineConfig(({ mode }) => {
  // Read the API's PORT from the shared root .env so the proxy follows it.
  const env = loadEnv(mode, repoRoot, '');
  const apiPort = env.PORT ?? '3000';

  return {
    plugins: [react(), tailwindcss()],
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
