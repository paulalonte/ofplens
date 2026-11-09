import type {
  FlightPlanRepository,
  ImportFlightPlanInput,
  PilotRepository,
  PilotSettingsRecord,
} from '@ofplens/db';
import type { AppDeps } from '../app';
import type { SimbriefClient } from '../simbrief';

/** In-memory stand-in for the Postgres-backed pilot repository. */
export function createInMemoryPilotRepository(
  initial: PilotSettingsRecord | null = null,
): PilotRepository & { saved: PilotSettingsRecord[] } {
  let current = initial;
  const saved: PilotSettingsRecord[] = [];
  return {
    saved,
    get: () => Promise.resolve(current),
    save: (settings) => {
      current = { ...settings };
      saved.push(current);
      return Promise.resolve(current);
    },
  };
}

/**
 * In-memory stand-in for the flight plan repository: idempotent on the SimBrief request id,
 * newest first, cursor = id of the previous page's last item. The Postgres behaviour itself
 * is covered by the integration tests.
 */
export function createInMemoryFlightPlanRepository(): FlightPlanRepository & {
  imported: Map<string, ImportFlightPlanInput & { id: string }>;
} {
  const imported = new Map<string, ImportFlightPlanInput & { id: string }>();
  const importedAt = '2026-11-09T20:00:00Z';
  const byId = (id: string) => [...imported.values()].find((p) => p.id === id);

  return {
    imported,
    import: (input) => {
      const existing = imported.get(input.plan.simbriefRequestId);
      if (existing) return Promise.resolve({ id: existing.id, created: false });
      const id = crypto.randomUUID();
      imported.set(input.plan.simbriefRequestId, { ...input, id });
      return Promise.resolve({ id, created: true });
    },
    list: ({ simbriefUsername, limit, cursor }) => {
      const all = [...imported.values()]
        .filter((p) => p.simbriefUsername === simbriefUsername)
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
    delete: (id) => {
      const stored = byId(id);
      if (stored) imported.delete(stored.plan.simbriefRequestId);
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

/** Dependencies for buildApp() in route tests: a healthy DB, empty repositories, no SimBrief. */
export function testDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    pingDb: () => Promise.resolve(),
    pilots: createInMemoryPilotRepository(),
    flightPlans: createInMemoryFlightPlanRepository(),
    simbrief: createFakeSimbrief(),
    ...overrides,
  };
}
