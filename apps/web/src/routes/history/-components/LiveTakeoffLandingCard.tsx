import type { FlightPlanSummary } from '@ofplens/ofp';
import { decodeMetar, type StationRole } from '@ofplens/weather';
import { usePlanWeather } from '../../../api/weather';
import { TakeoffLandingCard, type LiveWind } from '../../../components/briefing/TakeoffLandingCard';

/**
 * The takeoff & landing card with the wind now: the latest live METAR at the departure and
 * destination, from the same weather the page refreshes (so it updates with it).
 */
export function LiveTakeoffLandingCard({
  planId,
  plan,
}: {
  planId: string;
  plan: FlightPlanSummary;
}) {
  const weather = usePlanWeather(planId);

  const liveWind = (role: StationRole): LiveWind | null => {
    const metar = weather.stations.find((s) => s.role === role)?.live.metar;
    if (!metar?.observedAt) return null;
    return { observedAt: metar.observedAt, wind: decodeMetar(metar.raw, metar.observedAt).wind };
  };

  return (
    <TakeoffLandingCard
      plan={plan}
      live={{ takeoff: liveWind('origin'), landing: liveWind('destination') }}
    />
  );
}
