import {
  createRootRouteWithContext,
  Link,
  Outlet,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { sessionQuery, useSession, useSignOut } from '../api/auth';
import { HealthStatus } from '../components/HealthStatus';
import { safePath } from '../lib/safePath';
import type { RouterContext } from '../router';
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

/** Header with navigation, API status and the pilot, the page, and the simulation-only footer. */
function RootLayout() {
  const { pilot } = useSession();

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          {pilot ? (
            <nav aria-label="Main" className="flex items-center gap-5">
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
          <div className="flex items-center gap-4">
            <HealthStatus />
            {pilot && <PilotMenu name={pilot.displayName ?? pilot.email ?? 'Pilot'} />}
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

function PilotMenu({ name }: { name: string }) {
  const signOut = useSignOut();
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="max-w-40 truncate text-slate-600 dark:text-slate-400" title={name}>
        {name}
      </span>
      <button
        type="button"
        disabled={signOut.isPending}
        onClick={() =>
          signOut.mutate(undefined, { onSettled: () => void navigate({ to: '/sign-in' }) })
        }
        className="rounded-md border border-slate-300 px-2.5 py-1 font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        Sign out
      </button>
    </div>
  );
}
