import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';

/**
 * The router's default error page: a loader or a suspense query failed.
 * "Try again" re-runs the route's loaders; the query error boundary is reset so cached
 * errors are retried too.
 */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const queryErrorResetBoundary = useQueryErrorResetBoundary();

  useEffect(() => {
    queryErrorResetBoundary.reset();
  }, [queryErrorResetBoundary]);

  return (
    <div role="alert" className="space-y-3">
      <h1 className="text-xl font-semibold">Could not load this page</h1>
      <p className="text-slate-600 dark:text-slate-400">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <div className="flex items-center gap-4 text-sm">
        <button
          type="button"
          onClick={() => void router.invalidate()}
          className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Try again
        </button>
        <Link to="/" className="underline">
          Home
        </Link>
      </div>
    </div>
  );
}
