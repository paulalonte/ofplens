import type { PilotRepository, PilotSettingsRecord } from '@ofplens/db';
import type { AppDeps } from '../app';

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

/** Dependencies for buildApp() in route tests: a healthy DB and empty repositories. */
export function testDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    pingDb: () => Promise.resolve(),
    pilots: createInMemoryPilotRepository(),
    ...overrides,
  };
}
