import {
  formatDuration,
  formatLocal,
  formatUtcOffset,
  formatZulu,
  localDayOffset,
  type FlightPlanSummary,
} from '@ofplens/ofp';
import { useEffect, useState } from 'react';
import { Card, Row } from '../Card';
import { COUNTDOWN_SOON_MS, countdownAt, formatCountdown, type CountdownStage } from './countdown';

export function TimesCard({ plan }: { plan: FlightPlanSummary }) {
  const { times, origin, destination } = plan;

  return (
    <Card title="Times">
      <CountdownPanel plan={plan} />
      <dl>
        <TimeRow label="Out" iso={times.out} utcOffsetMin={origin.utcOffsetMin} />
        <TimeRow label="Off" iso={times.off} utcOffsetMin={origin.utcOffsetMin} />
        <TimeRow label="On" iso={times.on} utcOffsetMin={destination.utcOffsetMin} />
        <TimeRow label="In" iso={times.in} utcOffsetMin={destination.utcOffsetMin} />
        <Row label="Block time" strong>
          {formatDuration(times.blockTimeS)}
        </Row>
        <Row label="Air time">{formatDuration(times.airTimeS)}</Row>
      </dl>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Local: {origin.icao} {formatUtcOffset(origin.utcOffsetMin)}, {destination.icao}{' '}
        {formatUtcOffset(destination.utcOffsetMin)}
      </p>
    </Card>
  );
}

function TimeRow({
  label,
  iso,
  utcOffsetMin,
}: {
  label: string;
  iso: string;
  utcOffsetMin: number;
}) {
  const dayOffset = localDayOffset(iso, utcOffsetMin);
  return (
    <Row label={label}>
      <span className="font-semibold">{formatZulu(iso)}</span>
      <span className="ml-3 text-slate-500 dark:text-slate-400">
        {formatLocal(iso, utcOffsetMin)}L
        {dayOffset !== 0 && (
          <sup
            className="ml-0.5 text-amber-600 dark:text-amber-400"
            title={dayOffset < 0 ? 'Previous day local' : 'Next day local'}
          >
            {dayOffset > 0 ? `+${dayOffset}` : `−${-dayOffset}`}
          </sup>
        )}
      </span>
    </Row>
  );
}

const STAGE_LABEL: Record<CountdownStage, string> = {
  pushback: 'Pushback in',
  takeoff: 'Takeoff in',
  landing: 'Landing in',
};

/** The current time, updated every second. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Time left to pushback, then takeoff, then landing, by this computer's clock. Hidden for a
 * plan more than a day ahead or already flown. Its own component, so only it re-renders.
 */
function CountdownPanel({ plan }: { plan: FlightPlanSummary }) {
  const now = useNow();
  const countdown = countdownAt(plan.times, now);
  if (!countdown) return null;

  const { stage, target, remainingMs, sincePushbackMs } = countdown;
  const utcOffsetMin =
    stage === 'landing' ? plan.destination.utcOffsetMin : plan.origin.utcOffsetMin;
  const soon = stage !== 'landing' && remainingMs <= COUNTDOWN_SOON_MS;

  return (
    <div
      className={`mb-3 rounded-lg px-3 py-2 ${
        soon
          ? 'bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
          : 'bg-slate-50 dark:bg-slate-800/60'
      }`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium">{STAGE_LABEL[stage]}</span>
        <span
          role="timer"
          aria-label={STAGE_LABEL[stage]}
          className="font-mono text-2xl font-semibold tabular-nums"
        >
          {formatCountdown(remainingMs)}
        </span>
      </div>
      <p className="mt-0.5 text-xs opacity-75">
        at {formatZulu(target)} · {formatLocal(target, utcOffsetMin)}L
        {sincePushbackMs !== null && (
          <> · planned pushback was {formatCountdown(sincePushbackMs)} ago</>
        )}
      </p>
    </div>
  );
}
