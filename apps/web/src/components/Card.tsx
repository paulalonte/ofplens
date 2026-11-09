import { useId, type ReactNode } from 'react';

interface CardProps {
  title: string;
  /** Extra content on the right of the title row (a unit label, a toggle, ...). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A titled panel. Rendered as a labelled region so tests and screen readers can find it by name. */
export function Card({ title, aside, children, className = '' }: CardProps) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2
          id={id}
          className="text-xs font-semibold tracking-widest text-slate-500 uppercase dark:text-slate-400"
        >
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

interface RowProps {
  label: ReactNode;
  children: ReactNode;
  /** Emphasise a total. */
  strong?: boolean;
}

/** One label/value line inside a card; values are right-aligned with tabular digits. */
export function Row({ label, children, strong = false }: RowProps) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-1 ${
        strong ? 'mt-1 border-t border-slate-200 pt-2 font-semibold dark:border-slate-700' : ''
      }`}
    >
      <dt className="text-slate-600 dark:text-slate-400">{label}</dt>
      <dd className="text-right font-mono tabular-nums">{children}</dd>
    </div>
  );
}
