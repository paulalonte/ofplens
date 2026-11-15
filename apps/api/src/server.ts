import Anthropic from '@anthropic-ai/sdk';
import {
  createAuthRepository,
  createBriefingRepository,
  createDb,
  createFlightPlanRepository,
  createPilotRepository,
  createHazardRepository,
  createWeatherRepository,
  pingDb,
} from '@ofplens/db';
import { buildApp } from './app';
import { createProviders } from './auth/providers';
import { isLocalUrl, loadEnv } from './env';

const env = loadEnv();
const { db, close: closeDb } = createDb(env.DATABASE_URL);

const authProviders = createProviders(env);
const app = await buildApp({
  pingDb: () => pingDb(db),
  auth: createAuthRepository(db),
  authProviders,
  devSignIn: env.DEV_SIGN_IN,
  secureCookies: env.PUBLIC_URL.startsWith('https://'),
  trustProxy: env.TRUST_PROXY,
  pilots: createPilotRepository(db),
  flightPlans: createFlightPlanRepository(db),
  weatherReports: createWeatherRepository(db),
  hazards: createHazardRepository(db),
  briefings: createBriefingRepository(db),
  // The SDK also reads ANTHROPIC_BASE_URL, which end-to-end tests point at a fake Claude.
  anthropic: env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null,
  briefingConfig: { model: env.BRIEFING_MODEL },
  briefingDailyLimit: env.BRIEFING_DAILY_LIMIT,
  briefingGlobalDailyLimit: env.BRIEFING_GLOBAL_DAILY_LIMIT,
  simbriefUrl: env.SIMBRIEF_URL,
  aviationWeatherUrl: env.AVIATION_WEATHER_URL,
  logger: { level: env.LOG_LEVEL },
});
app.addHook('onClose', closeDb);

app.log.info(
  {
    publicUrl: env.PUBLIC_URL,
    providers: authProviders.map((p) => p.id),
    devSignIn: env.DEV_SIGN_IN,
  },
  'Sign-in',
);
if (authProviders.length === 0 && !env.DEV_SIGN_IN) {
  app.log.warn(
    isLocalUrl(env.PUBLIC_URL)
      ? 'No way to sign in: set DEV_SIGN_IN=true or a GitHub/Google client in .env'
      : 'No way to sign in: set GITHUB_CLIENT_ID/SECRET or GOOGLE_CLIENT_ID/SECRET',
  );
}

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
