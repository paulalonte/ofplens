import type { PlanWeatherStore } from '@ofplens/weather';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from './client';
import { flightPlans, weatherReports } from './schema';

export type { NewLiveReport, PlanWeather, StoredReport } from '@ofplens/weather';

/** Storage for plan weather; the shapes are defined next to their logic in @ofplens/weather. */
export type WeatherRepository = PlanWeatherStore;

export function createWeatherRepository(db: Database): WeatherRepository {
  const reportColumns = {
    stationIcao: weatherReports.stationIcao,
    role: weatherReports.role,
    kind: weatherReports.kind,
    rawText: weatherReports.rawText,
    flightCategory: weatherReports.flightCategory,
    parsed: weatherReports.parsed,
    observedAt: weatherReports.observedAt,
    fetchedAt: weatherReports.fetchedAt,
  };

  return {
    async forPlan(flightPlanId) {
      const [plan] = await db
        .select({
          generatedAt: flightPlans.generatedAt,
          origin: flightPlans.originIcao,
          destination: flightPlans.destinationIcao,
          alternate: flightPlans.alternateIcao,
          liveCheckedAt: flightPlans.liveWeatherCheckedAt,
        })
        .from(flightPlans)
        .where(eq(flightPlans.id, flightPlanId));
      if (!plan) return null;

      const [ofp, live] = await Promise.all([
        db
          .select(reportColumns)
          .from(weatherReports)
          .where(
            and(eq(weatherReports.flightPlanId, flightPlanId), eq(weatherReports.source, 'ofp')),
          ),
        // Latest live report per station, role and kind.
        db
          .selectDistinctOn(
            [weatherReports.stationIcao, weatherReports.role, weatherReports.kind],
            reportColumns,
          )
          .from(weatherReports)
          .where(
            and(eq(weatherReports.flightPlanId, flightPlanId), eq(weatherReports.source, 'live')),
          )
          .orderBy(
            weatherReports.stationIcao,
            weatherReports.role,
            weatherReports.kind,
            desc(weatherReports.observedAt),
          ),
      ]);

      const { liveCheckedAt, ...airports } = plan;
      return { plan: airports, ofp, live, liveCheckedAt };
    },

    saveLive: (flightPlanId, reports, checkedAt) =>
      db.transaction(async (tx) => {
        let added = 0;
        if (reports.length > 0) {
          const inserted = await tx
            .insert(weatherReports)
            .values(reports.map((r) => ({ ...r, flightPlanId, source: 'live' as const })))
            .onConflictDoNothing({
              target: [
                weatherReports.flightPlanId,
                weatherReports.stationIcao,
                weatherReports.role,
                weatherReports.kind,
                weatherReports.observedAt,
              ],
              where: sql`${weatherReports.source} = 'live'`,
            })
            .returning({ id: weatherReports.id });
          added = inserted.length;
        }
        await tx
          .update(flightPlans)
          .set({ liveWeatherCheckedAt: checkedAt })
          .where(eq(flightPlans.id, flightPlanId));
        return added;
      }),
  };
}
