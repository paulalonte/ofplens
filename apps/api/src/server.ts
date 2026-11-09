import { createDb, createPilotRepository, pingDb } from '@ofplens/db';
import { buildApp } from './app';
import { loadEnv } from './env';

const env = loadEnv();
const { db, close: closeDb } = createDb(env.DATABASE_URL);

const app = await buildApp({
  pingDb: () => pingDb(db),
  pilots: createPilotRepository(db),
  logger: { level: env.LOG_LEVEL },
});
app.addHook('onClose', closeDb);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.error(err);
  await closeDb();
  process.exit(1);
}
