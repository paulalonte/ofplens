import type {
  AuthRepository,
  BriefingRepository,
  FlightPlanRepository,
  HazardRepository,
  ImportFlightPlanInput,
  PilotRepository,
  PilotSettingsRecord,
  SessionPilot,
  SignInProfile,
  WeatherRepository,
} from '@ofplens/db';
import {
  WeatherUnavailableError,
  type LiveMetar,
  type LiveTaf,
  type WeatherClient,
} from '@ofplens/weather';
import type { AppDeps } from '../app';
import type { Authenticate } from '../auth/sessions';
import type { SimbriefClient } from '../simbrief';

/** The pilot route tests run as (see testDeps), and a second one for isolation tests. */
export const TEST_PILOT: SessionPilot = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Test Pilot',
  email: null,
  avatarUrl: null,
};
export const OTHER_PILOT: SessionPilot = {
  id: '22222222-2222-4222-8222-222222222222',
  displayName: 'Other Pilot',
  email: null,
  avatarUrl: null,
};

/** In-memory stand-in for the pilot repository. `initial` = TEST_PILOT's saved settings. */
export function createInMemoryPilotRepository(
  initial: PilotSettingsRecord | null = null,
): PilotRepository & { saved: (PilotSettingsRecord & { pilotId: string })[] } {
  const settings = new Map<string, PilotSettingsRecord>();
  if (initial) settings.set(TEST_PILOT.id, initial);
  const saved: (PilotSettingsRecord & { pilotId: string })[] = [];
  return {
    saved,
    get: (pilotId) => Promise.resolve(settings.get(pilotId) ?? null),
    save: (pilotId, record) => {
      settings.set(pilotId, { ...record });
      saved.push({ pilotId, ...record });
      return Promise.resolve({ ...record });
    },
    create: () => Promise.reject(new Error('pilots.create was not expected in this test')),
  };
}

/**
 * In-memory sign-in: pilots by provider and subject, sessions by token. Postgres behaviour
 * (hashing, expiry, claiming) is covered by the integration tests.
 */
export function createInMemoryAuthRepository(): AuthRepository & {
  signIns: SignInProfile[];
  sessions: Map<string, SessionPilot>;
} {
  const pilots = new Map<string, SessionPilot>();
  const sessions = new Map<string, SessionPilot>();
  const signIns: SignInProfile[] = [];
  return {
    signIns,
    sessions,
    signIn: (profile) => {
      signIns.push(profile);
      const key = `${profile.provider}:${profile.subject}`;
      const existing = pilots.get(key);
      const pilot = {
        id: existing?.id ?? crypto.randomUUID(),
        displayName: profile.displayName,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
      };
      pilots.set(key, pilot);
      return Promise.resolve({ pilotId: pilot.id, created: !existing, claimed: false });
    },
    createSession: (pilotId, { ttlMs }) => {
      const pilot = [...pilots.values()].find((p) => p.id === pilotId);
      if (!pilot) return Promise.reject(new Error(`No pilot ${pilotId}`));
      const token = `token-${crypto.randomUUID()}`;
      sessions.set(token, pilot);
      return Promise.resolve({ token, expiresAt: new Date(Date.now() + ttlMs) });
    },
    findSession: (token) => Promise.resolve(sessions.get(token) ?? null),
    deleteSession: (token) => {
      sessions.delete(token);
      return Promise.resolve();
    },
  };
}

/**
 * In-memory stand-in for the flight plan repository: idempotent per pilot on the SimBrief request id,
 * newest first, cursor = id of the previous page's last item. The Postgres behaviour itself
 * is covered by the integration tests.
 */
export function createInMemoryFlightPlanRepository(): FlightPlanRepository & {
  imported: Map<string, ImportFlightPlanInput & { id: string }>;
} {
  const imported = new Map<string, ImportFlightPlanInput & { id: string }>();
  const importedAt = '2026-11-09T20:00:00Z';
  const byId = (id: string) => [...imported.values()].find((p) => p.id === id);
  const key = (input: ImportFlightPlanInput) => `${input.pilotId}:${input.plan.simbriefRequestId}`;

  return {
    imported,
    import: (input) => {
      const existing = imported.get(key(input));
      if (existing) return Promise.resolve({ id: existing.id, created: false });
      const id = crypto.randomUUID();
      imported.set(key(input), { ...input, id });
      return Promise.resolve({ id, created: true });
    },
    list: ({ pilotId, limit, cursor }) => {
      const all = [...imported.values()]
        .filter((p) => p.pilotId === pilotId)
        .sort(
          (a, b) =>
            b.plan.generatedAt.localeCompare(a.plan.generatedAt) || b.id.localeCompare(a.id),
        );
      const start = cursor === undefined ? 0 : all.findIndex((p) => p.id === cursor) + 1;
      const page = all.slice(start, start + limit);
      return Promise.resolve({
        items: page.map(({ id, plan }) => ({
          id,
          simbriefRequestId: plan.simbriefRequestId,
          generatedAt: plan.generatedAt,
          importedAt,
          callsign: plan.flight.callsign,
          aircraftIcao: plan.aircraft.icao,
          originIcao: plan.origin.icao,
          destinationIcao: plan.destination.icao,
          alternateIcao: plan.alternate?.icao ?? null,
          out: plan.times.out,
          blockTimeS: plan.times.blockTimeS,
          units: plan.units,
        })),
        nextCursor: start + limit < all.length ? (page.at(-1)?.id ?? null) : null,
      });
    },
    get: (id) => {
      const stored = byId(id);
      return Promise.resolve(stored ? { id, importedAt, plan: stored.plan } : null);
    },
    ownerOf: (id) => Promise.resolve(byId(id)?.pilotId ?? null),
    delete: (id) => {
      const stored = byId(id);
      if (stored) imported.delete(key(stored));
      return Promise.resolve(stored !== undefined);
    },
  };
}

/** A SimBrief client that answers with `respond` and records every username it was asked for. */
export function createFakeSimbrief(
  respond: (username: string) => unknown = () => {
    throw new Error('SimBrief was called but this test did not expect it');
  },
): SimbriefClient & { requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    fetchLatestOfp: (username) => {
      requests.push(username);
      try {
        return Promise.resolve(respond(username));
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    },
  };
}

/** Briefings are tested on Postgres; route unit tests only need a stub that has none. */
export function createNoBriefingsRepository(): BriefingRepository {
  return {
    start: () => Promise.reject(new Error('briefings.start was not expected in this test')),
    finish: () => Promise.reject(new Error('briefings.finish was not expected in this test')),
    latest: () => Promise.resolve(null),
    countSince: () => Promise.resolve(0),
  };
}

/** Weather reads go to Postgres in the integration tests; route unit tests only need a stub. */
export function createNoWeatherRepository(): WeatherRepository {
  return {
    forPlan: () => Promise.resolve(null),
    saveLive: () => Promise.reject(new Error('saveLive was not expected in this test')),
  };
}

/** Hazard reads go to Postgres in the integration tests; route unit tests only need a stub. */
export function createNoHazardRepository(): HazardRepository {
  return {
    route: () => Promise.resolve(null),
    read: () => Promise.resolve(null),
    replace: () => Promise.reject(new Error('replace was not expected in this test')),
  };
}

/** A weather client answering from fixed reports, counting how often each kind is fetched. */
export function createFakeWeatherClient(
  metars: LiveMetar[] = [],
  tafs: LiveTaf[] = [],
): WeatherClient & { calls: { metar: string[][]; taf: string[][] }; fail: boolean } {
  const pick = <R extends { icao: string }>(all: R[], icaos: readonly string[]) =>
    new Map(all.filter((r) => icaos.includes(r.icao)).map((r) => [r.icao, r]));
  const fake = {
    calls: { metar: [] as string[][], taf: [] as string[][] },
    fail: false,
    fetchMetars(icaos: readonly string[]) {
      fake.calls.metar.push([...icaos]);
      return fake.fail ? Promise.reject(unavailable()) : Promise.resolve(pick(metars, icaos));
    },
    fetchTafs(icaos: readonly string[]) {
      fake.calls.taf.push([...icaos]);
      return fake.fail ? Promise.reject(unavailable()) : Promise.resolve(pick(tafs, icaos));
    },
  };
  return fake;
}

const unavailable = () =>
  new WeatherUnavailableError('aviationweather.gov returned HTTP 503 (after one retry)');

/**
 * Dependencies for buildApp() in route tests: a healthy DB, empty repositories, no SimBrief,
 * signed in as TEST_PILOT, and no rate limits.
 */
export function testDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    pingDb: () => Promise.resolve(),
    auth: createInMemoryAuthRepository(),
    authenticate: () => Promise.resolve(TEST_PILOT),
    rateLimits: false,
    pilots: createInMemoryPilotRepository(),
    flightPlans: createInMemoryFlightPlanRepository(),
    weatherReports: createNoWeatherRepository(),
    briefings: createNoBriefingsRepository(),
    hazards: createNoHazardRepository(),
    weather: createFakeWeatherClient(),
    hazardFeeds: { fetchAdvisories: () => Promise.resolve({ advisories: [], unavailable: [] }) },
    simbrief: createFakeSimbrief(),
    ...overrides,
  };
}

/** Signs every request in as the pilot with this id (integration tests on a real database). */
export const asPilot =
  (id: string): Authenticate =>
  () =>
    Promise.resolve({ id, displayName: null, email: null, avatarUrl: null });
