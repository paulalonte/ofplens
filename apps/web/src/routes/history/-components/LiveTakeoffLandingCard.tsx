import type { FlightPlanSummary } from '@ofplens/ofp';
import { decodeMetar, type StationRole } from '@ofplens/weather';
import { usePlanWeather } from '../../../api/weather';
import {
  TakeoffLandingCard,
  type LiveConditions,
} from '../../../components/briefing/TakeoffLandingCard';

/**
 * The takeoff & landing card with the wind, temperature and QNH now: the latest live METAR at
 * the departure and destination, from the same weather the page refreshes (so it updates
 * with it).
 */
export function LiveTakeoffLandingCard({
  planId,
  plan,
}: {
  planId: string;
  plan: FlightPlanSummary;
}) {
  const weather = usePlanWeather(planId);

  const liveConditions = (role: StationRole): LiveConditions | null => {
    const metar = weather.stations.find((s) => s.role === role)?.live.metar;
    if (!metar?.observedAt) return null;
    const decoded = decodeMetar(metar.raw, metar.observedAt);
    return {
      observedAt: metar.observedAt,
      wind: decoded.wind,
      temperatureC: decoded.temperatureC,
      altimeterInHg: decoded.altimeterInHg,
    };
  };

  return (
    <TakeoffLandingCard
      plan={plan}
      live={{ takeoff: liveConditions('origin'), landing: liveConditions('destination') }}
    />
  );
}
