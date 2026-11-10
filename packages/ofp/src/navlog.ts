import type { FlightPlanSummary, Waypoint } from './summary';

/**
 * Planned fuel burned from takeoff to a fix, in the plan's unit.
 *
 * SimBrief's navlog `fuel_totalused` is exactly takeoff fuel (ramp minus taxi) minus fuel on
 * board at the fix, for every fix in the captured OFPs, ending at the planned trip burn. So it
 * is derived here rather than stored twice.
 */
export function fuelUsedAt(
  plan: Pick<FlightPlanSummary, 'fuel'>,
  waypoint: Pick<Waypoint, 'fuelOnBoard'>,
): number {
  return plan.fuel.ramp - plan.fuel.taxi - waypoint.fuelOnBoard;
}
