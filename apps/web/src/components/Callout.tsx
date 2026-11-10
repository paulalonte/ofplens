import type { ReactNode } from 'react';

/** A highlighted note: blue for information, red (and announced as an alert) for errors. */
export function Callout({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'error';
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'note'}
      className={`space-y-1 rounded-lg border p-4 ${
        tone === 'error'
          ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200'
          : 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200'
      }`}
    >
      {children}
    </div>
  );
}
