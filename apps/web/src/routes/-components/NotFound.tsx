import { Link } from '@tanstack/react-router';

/** Shown for any URL that is not a page (for example an old /plans/… link). */
export function NotFound() {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-slate-600 dark:text-slate-400">There is nothing at this address.</p>
      <p className="flex gap-4 text-sm">
        <Link to="/" className="underline">
          Home
        </Link>
        <Link to="/history" className="underline">
          History
        </Link>
      </p>
    </div>
  );
}
