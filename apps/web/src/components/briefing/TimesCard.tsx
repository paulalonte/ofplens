import {
  formatDuration,
  formatLocal,
  formatUtcOffset,
  formatZulu,
  localDayOffset,
  type FlightPlanSummary,
} from '@ofplens/ofp';
import { Card, Row } from '../Card';

export function TimesCard({ plan }: { plan: FlightPlanSummary }) {
  const { times, origin, destination } = plan;

  return (
    <Card title="Times">
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
