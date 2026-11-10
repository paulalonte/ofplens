import type { FlightCategory, MetarView } from '@ofplens/weather';

/** The usual aviation colours, always with the category written out too. */
const STYLE: Record<FlightCategory, string> = {
  VFR: 'bg-emerald-600 text-white',
  MVFR: 'bg-blue-600 text-white',
  IFR: 'bg-red-600 text-white',
  LIFR: 'bg-fuchsia-700 text-white',
};

export function CategoryBadge({ metar }: { metar: MetarView | null }) {
  return (
    <FlightCategoryBadge
      category={metar?.category ?? null}
      {...(metar && { title: describe(metar) })}
    />
  );
}

/** A flight category on its own, e.g. from an AI briefing; "N/A" when unknown. */
export function FlightCategoryBadge({
  category,
  title,
}: {
  category: FlightCategory | null;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-block rounded px-1.5 py-0.5 font-mono text-xs font-bold tracking-wide ${
        category
          ? STYLE[category]
          : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
      }`}
    >
      {category ?? 'N/A'}
    </span>
  );
}

/** "Ceiling 900 ft · visibility 6.2+ SM" for the badge's tooltip. */
function describe(metar: MetarView): string {
  const ceiling =
    metar.ceilingFt === null
      ? 'No ceiling'
      : `Ceiling ${metar.ceilingFt.toLocaleString('en-US')} ft`;
  const visibility =
    metar.visibilitySm === null
      ? 'visibility unknown'
      : `visibility ${metar.visibilitySm}${metar.visibilityOrMore ? '+' : ''} SM`;
  return `${ceiling} · ${visibility}`;
}
