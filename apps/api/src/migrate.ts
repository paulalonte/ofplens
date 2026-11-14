import { createDb, runMigrations } from '@ofplens/db';
import { z } from 'zod';

/**
 * Applies pending database migrations, then exits. Runs once per deploy as its own container
 * (a Kubernetes Job), never inside the API pods: with several API pods starting together, each
 * would try to migrate at the same time.
 */
const { DATABASE_URL } = z
  .object({ DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) })
  .parse(process.env);

const { db, close } = createDb(DATABASE_URL);
try {
  await runMigrations(db);
  console.log('Migrations applied');
} finally {
  await close();
}
