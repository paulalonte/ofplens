/**
 * Bundles the API and the migration command into plain JavaScript in apps/api/dist, for the
 * container image. Workspace packages export TypeScript source, so they are bundled in; the
 * image then needs neither TypeScript nor node_modules.
 *
 *   pnpm --filter @ofplens/api build
 */
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
await rm(resolve(root, 'dist'), { recursive: true, force: true });

await build({
  entryPoints: [resolve(root, 'src/server.ts'), resolve(root, 'src/migrate.ts')],
  outdir: resolve(root, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  // Some dependencies are CommonJS and call require(); give the ES module bundle one.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
