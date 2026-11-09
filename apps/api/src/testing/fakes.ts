import type { PilotRepository, PilotSettingsRecord } from '@ofplens/db';
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
    simbrief: createFakeSimbrief(),
    ...overrides,
  };
}
