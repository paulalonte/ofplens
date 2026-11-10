import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import { HealthStatus } from '../components/HealthStatus';
import { NotFound } from './-components/NotFound';

export const Route = createRootRoute({ component: RootLayout, notFoundComponent: NotFound });

/** Header with navigation and API status, the page, and the simulation-only footer. */
function RootLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <nav aria-label="Main" className="flex items-center gap-5">
            <Link to="/" className="font-semibold tracking-tight">
              OFP Lens
            </Link>
            <Link
              to="/history"
              className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              activeProps={{ className: 'font-semibold text-slate-900 dark:text-slate-100' }}
            >
              History
            </Link>
            <Link
              to="/settings"
              className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              activeProps={{ className: 'font-semibold text-slate-900 dark:text-slate-100' }}
            >
              Settings
            </Link>
          </nav>
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
