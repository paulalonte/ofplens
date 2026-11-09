import { parseOfp, type FlightPlanSummary } from '@ofplens/ofp';

/**
 * Sample briefings from the captured OFPs in fixtures/ofp, so the page can be built and checked
 * before the API serves real plans (OFP-12). Development only: in a production build
 * `import.meta.env.DEV` is false, so the fixtures are not bundled.
 */
const modules: Record<string, () => Promise<{ default: unknown }>> = import.meta.env.DEV
  ? import.meta.glob<{ default: unknown }>('../../../../../fixtures/ofp/*.json')
  : {};

const byName = new Map(
  Object.entries(modules).map(([path, load]) => [
    path.replace(/^.*\//, '').replace(/\.json$/, ''),
    load,
  ]),
);

export const SAMPLE_NAMES = [...byName.keys()].sort();

export class SampleNotFoundError extends Error {
  constructor(name: string) {
    super(`No sample plan called "${name}"`);
    this.name = 'SampleNotFoundError';
  }
}

export async function loadSamplePlan(name: string): Promise<FlightPlanSummary> {
  const load = byName.get(name);
  if (!load) throw new SampleNotFoundError(name);
  const { default: raw } = await load();
  return parseOfp(raw);
}
