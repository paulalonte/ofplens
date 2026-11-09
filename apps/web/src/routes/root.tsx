import { Link, Outlet } from '@tanstack/react-router';
import { HealthStatus } from '../features/health/HealthStatus';

export function RootLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="font-semibold tracking-tight">
            OFP Lens
          </Link>
          <HealthStatus />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 py-3 text-center text-xs text-slate-500 dark:border-slate-800">
        For flight simulation use only. Not for real-world navigation.
      </footer>
    </div>
  );
}
