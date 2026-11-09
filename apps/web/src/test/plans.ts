import { parseOfp, type FlightPlanSummary } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';

/** A captured fixture, parsed exactly as the app would parse it. */
export function fixturePlan(name: string): FlightPlanSummary {
  return parseOfp(loadFixture(name));
}
