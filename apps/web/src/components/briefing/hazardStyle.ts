import { formatFlightLevel, formatZulu } from '@ofplens/ofp';
import type { HazardKind, RouteHazardView } from '@ofplens/weather';

/** Hazard types in words, for the hazards card, the map and its legend. */
export const HAZARD_LABEL: Record<HazardKind, string> = {
  thunderstorm: 'Thunderstorms',
  turbulence: 'Turbulence',
  icing: 'Icing',
  volcanic_ash: 'Volcanic ash',
  tropical_cyclone: 'Tropical cyclone',
  mountain_wave: 'Mountain waves',
  low_visibility: 'Low ceilings / visibility',
  other: 'Other hazard',
};

/** One colour per hazard type on the map; mid tones that read on light and dark maps. */
export const HAZARD_COLOR: Record<HazardKind, string> = {
  thunderstorm: '#dc2626',
  turbulence: '#d97706',
  icing: '#0284c7',
  volcanic_ash: '#78716c',
  tropical_cyclone: '#9333ea',
  mountain_wave: '#0d9488',
  low_visibility: '#64748b',
  other: '#db2777',
};

/** "SFC–FL380", "FL300–FL420", "Up to FL380", "FL240 and above", "Not given". */
export function hazardLevels({ baseFt, topFt }: Pick<RouteHazardView, 'baseFt' | 'topFt'>): string {
  const level = (ft: number) => (ft === 0 ? 'SFC' : formatFlightLevel(ft));
  if (baseFt === null && topFt === null) return 'Not given';
  if (baseFt === null) return `Up to ${level(topFt!)}`;
  if (topFt === null) return `${level(baseFt)} and above`;
  return `${level(baseFt)}–${level(topFt)}`;
}

/** For the map's popup: "Turbulence · severe" and "FL300–FL400 · until 17:00Z · LCU → KATES". */
export function describeHazard(hazard: RouteHazardView): { title: string; detail: string } {
  return {
    title: [HAZARD_LABEL[hazard.hazard], hazard.severity].filter(Boolean).join(' · '),
    detail: [
      hazardLevels(hazard),
      `until ${formatZulu(hazard.validTo)}`,
      hazard.segments.map((s) => `${s.fromIdent} → ${s.toIdent}`).join(', '),
    ].join(' · '),
  };
}
