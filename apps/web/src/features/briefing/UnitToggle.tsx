import { WEIGHT_UNITS, weightUnitLabel, type WeightUnit } from '@ofplens/ofp';

interface Props {
  value: WeightUnit;
  onChange: (unit: WeightUnit) => void;
}

/** Segmented kg / lb switch. Display only: stored values stay in the OFP's unit. */
export function UnitToggle({ value, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Weight unit"
      className="inline-flex rounded-lg border border-slate-300 p-0.5 text-sm dark:border-slate-700"
    >
      {WEIGHT_UNITS.map((unit) => {
        const active = unit === value;
        return (
          <button
            key={unit}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(unit)}
            className={`rounded-md px-3 py-1 font-medium transition-colors ${
              active
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            {weightUnitLabel(unit)}
          </button>
        );
      })}
    </div>
  );
}
