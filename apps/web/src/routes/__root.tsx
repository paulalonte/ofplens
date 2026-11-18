import { createRootRouteWithContext, Link, Outlet, redirect } from '@tanstack/react-router';
import { sessionQuery, useSession } from '../api/auth';
import { HealthStatus } from '../components/HealthStatus';
import { safePath } from '../lib/safePath';
import type { RouterContext } from '../router';
import { AccountMenu } from './-components/AccountMenu';
import { Brand } from './-components/Brand';
import { NotFound } from './-components/NotFound';

export const Route = createRootRouteWithContext<RouterContext>()({
  /**
   * Every page but /sign-in needs a signed-in pilot. Runs before any loader, so no page asks
   * the API for a pilot's data before we know there is one.
   */
  beforeLoad: async ({ context: { queryClient }, location }) => {
    const session = await queryClient.ensureQueryData(sessionQuery);
    const onSignIn = location.pathname === '/sign-in';
    if (!session.pilot && !onSignIn) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } });
    }
    if (session.pilot && onSignIn) {
      const search = location.search as { redirect?: unknown };
      throw redirect({ href: safePath(search.redirect) ?? '/' });
    }
  },
  component: RootLayout,
  notFoundComponent: NotFound,
});

const navLink =
  'text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100';
const activeNavLink = { className: 'font-semibold text-slate-900 dark:text-slate-100' };

/**
 * Header with navigation on the left, the API status and the pilot's account menu on the
 * right (one row, also on a phone), the page, and the simulation-only footer.
 */
function RootLayout() {
  const { pilot } = useSession();

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          {pilot ? (
            <nav aria-label="Main" className="flex min-w-0 items-center gap-4 sm:gap-5">
              <Link to="/">
                <Brand />
              </Link>
              <Link to="/history" className={navLink} activeProps={activeNavLink}>
                History
              </Link>
              <Link to="/settings" className={navLink} activeProps={activeNavLink}>
                Settings
              </Link>
            </nav>
          ) : (
            <Brand />
          )}
          <div className="flex shrink-0 items-center gap-3 sm:gap-4">
            <HealthStatus />
            {pilot && (
              <AccountMenu
                name={pilot.displayName ?? pilot.email ?? 'Pilot'}
                avatarUrl={pilot.avatarUrl}
              />
            )}
          </div>
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
