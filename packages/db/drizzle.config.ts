import { defineConfig } from 'drizzle-kit';

// Scripts run from packages/db; the .env lives at the repo root.
try {
  process.loadEnvFile('../../.env');
} catch {
  // No .env file: rely on the real environment (CI, deploys).
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
