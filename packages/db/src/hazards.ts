import type { HazardKind, HazardSource, PlanHazards, PlanHazardStore } from '@ofplens/weather';
import { asc, eq } from 'drizzle-orm';
import type { Database } from './client';
import { advisories, flightPlans, waypoints } from './schema';

export type { PlanHazards } from '@ofplens/weather';

/** Storage for a plan's route hazards; the shapes and logic live in @ofplens/weather. */
export type HazardRepository = PlanHazardStore;

export function createHazardRepository(db: Database): HazardRepository {
  return {
    async route(flightPlanId) {
      const [plan] = await db
        .select({ estOff: flightPlans.estOff })
        .from(flightPlans)
        .where(eq(flightPlans.id, flightPlanId));
      if (!plan) return null;
      const fixes = await db
        .select({
          seq: waypoints.seq,
          ident: waypoints.ident,
          lat: waypoints.lat,
          lon: waypoints.lon,
          altitudeFt: waypoints.altitudeFt,
          elapsedS: waypoints.elapsedS,
        })
        .from(waypoints)
        .where(eq(waypoints.flightPlanId, flightPlanId))
        .orderBy(asc(waypoints.seq));
      return { waypoints: fixes, plannedTakeoffAt: plan.estOff.toISOString() };
    },

    async read(flightPlanId) {
      const [plan] = await db
        .select({
          checkedAt: flightPlans.hazardsCheckedAt,
          takeoffAt: flightPlans.hazardsTakeoffAt,
          unavailable: flightPlans.hazardsUnavailable,
          advisoriesChecked: flightPlans.hazardsAdvisoriesChecked,
        })
        .from(flightPlans)
        .where(eq(flightPlans.id, flightPlanId));
      if (!plan) return null;
      if (!plan.checkedAt || !plan.takeoffAt) return { checked: null };

      const rows = await db
        .select()
        .from(advisories)
        .where(eq(advisories.flightPlanId, flightPlanId))
        .orderBy(asc(advisories.firstWaypointSeq), asc(advisories.advisoryId));
      return {
        checked: {
          checkedAt: plan.checkedAt.toISOString(),
          takeoffAt: plan.takeoffAt.toISOString(),
          unavailable: plan.unavailable as HazardSource[],
          advisoriesChecked: plan.advisoriesChecked,
          hazards: rows.map((row) => ({
            advisory: {
              id: row.advisoryId,
              source: row.source,
              hazard: row.hazard as HazardKind,
              code: row.code,
              severity: row.severity,
              detail: row.detail,
              validFrom: row.validFrom.toISOString(),
              validTo: row.validTo.toISOString(),
              baseFt: row.baseFt,
              topFt: row.topFt,
              polygons: row.polygons,
              fir: row.fir,
              firName: row.firName,
              rawText: row.rawText,
            },
            segments: row.segments,
          })),
        },
      };
    },

    replace: (flightPlanId, checked: PlanHazards) =>
      db.transaction(async (tx) => {
        await tx.delete(advisories).where(eq(advisories.flightPlanId, flightPlanId));
        if (checked.hazards.length > 0) {
          await tx.insert(advisories).values(
            checked.hazards.map(({ advisory: a, segments }) => ({
              flightPlanId,
              advisoryId: a.id,
              source: a.source,
              hazard: a.hazard,
              code: a.code,
              severity: a.severity,
              detail: a.detail,
              validFrom: new Date(a.validFrom),
              validTo: new Date(a.validTo),
              baseFt: a.baseFt,
              topFt: a.topFt,
              polygons: a.polygons,
              segments,
              firstWaypointSeq: segments[0]!.fromSeq,
              fir: a.fir,
              firName: a.firName,
              rawText: a.rawText,
            })),
          );
        }
        await tx
          .update(flightPlans)
          .set({
            hazardsCheckedAt: new Date(checked.checkedAt),
            hazardsTakeoffAt: new Date(checked.takeoffAt),
            hazardsUnavailable: checked.unavailable,
            hazardsAdvisoriesChecked: checked.advisoriesChecked,
          })
          .where(eq(flightPlans.id, flightPlanId));
      }),
  };
}
