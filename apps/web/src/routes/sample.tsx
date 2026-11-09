import { Link, type ErrorComponentProps } from '@tanstack/react-router';

export function SampleError({ error }: ErrorComponentProps) {
  return (
    <div role="alert" className="space-y-3">
      <h1 className="text-xl font-semibold">Could not load this sample</h1>
      <p className="text-slate-600 dark:text-slate-400">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <Link to="/" className="text-sm underline">
        Back to start
      </Link>
    </div>
  );
}

export function SamplePending() {
  return <p className="text-slate-500">Loading sample plan…</p>;
}
