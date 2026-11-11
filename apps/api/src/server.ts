import Anthropic from '@anthropic-ai/sdk';
import {
  createBriefingRepository,
  createDb,
  createFlightPlanRepository,
  createPilotRepository,
  createHazardRepository,
  createWeatherRepository,
  pingDb,
} from '@ofplens/db';
import { buildApp } from './app';
import { loadEnv } from './env';

const env = loadEnv();
const { db, close: closeDb } = createDb(env.DATABASE_URL);

const app = await buildApp({
  pingDb: () => pingDb(db),
  pilots: createPilotRepository(db),
  flightPlans: createFlightPlanRepository(db),
  weatherReports: createWeatherRepository(db),
  hazards: createHazardRepository(db),
  briefings: createBriefingRepository(db),
  // The SDK also reads ANTHROPIC_BASE_URL, which end-to-end tests point at a fake Claude.
  anthropic: env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null,
  briefingConfig: { model: env.BRIEFING_MODEL },
  briefingDailyLimit: env.BRIEFING_DAILY_LIMIT,
  simbriefUrl: env.SIMBRIEF_URL,
  aviationWeatherUrl: env.AVIATION_WEATHER_URL,
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
