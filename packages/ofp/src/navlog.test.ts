import { describe, expect, it } from 'vitest';
import { fuelUsedAt } from './navlog';
import { parseOfp } from './parseOfp';
import { FIXTURE_NAMES, loadFixture } from './testing/fixtures';

describe('fuelUsedAt', () => {
  it.each(FIXTURE_NAMES)('matches SimBrief’s fuel_totalused at every fix of %s', (name) => {
    const raw = loadFixture(name);
    const plan = parseOfp(raw);
    const navlog = raw.navlog as { fuel_totalused: string }[];

    plan.waypoints.forEach((waypoint, i) => {
      expect(fuelUsedAt(plan, waypoint)).toBe(Number(navlog[i]!.fuel_totalused));
    });
  });

  it.each(FIXTURE_NAMES)(
    'ends at the planned trip burn, and elapsed time at the air time (%s)',
    (name) => {
      const plan = parseOfp(loadFixture(name));
      const last = plan.waypoints.at(-1)!;

      expect(fuelUsedAt(plan, last)).toBe(plan.fuel.trip);
      expect(last.elapsedS).toBe(plan.times.airTimeS);
    },
  );
});
