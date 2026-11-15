import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { PageSpinner } from './components/PageSpinner';
import { RouteError } from './components/RouteError';
import { forgetPilotData } from './api/auth';
import { createQueryClient } from './queryClient';
// Generated from the files in src/routes by @tanstack/router-plugin (see vite.config.ts).
import { routeTree } from './routeTree.gen';

/** What every route's loader receives as `context`. */
export interface RouterContext {
  queryClient: QueryClient;
}

/**
 * Route loaders fill the TanStack Query cache (`ensureQueryData`); pages read it back with
 * `useSuspenseQuery`. Pass a memory history in tests; the browser history is used otherwise.
 */
export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient } satisfies RouterContext,
    // Hovering a link runs that route's loader, so the next page's data is usually ready.
    defaultPreload: 'intent',
    // Let Query's staleTime decide what to refetch, not the router's own loader cache.
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: PageSpinner,
    // Show the spinner only for loads slower than 300 ms, and then for at least 300 ms.
    defaultPendingMs: 300,
    defaultPendingMinMs: 300,
    defaultErrorComponent: RouteError,
    ...(history && { history }),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

/**
 * The query client and router together, wired so that any 401 (session expired, signed out
 * in another tab) empties the cache and goes to the sign-in page, then back to where the
 * pilot was. `retry: false` for tests.
 */
export function createApp({ history, retry }: { history?: RouterHistory; retry?: boolean } = {}) {
  const queryClient = createQueryClient({
    ...(retry !== undefined && { retry }),
    onUnauthenticated: () => {
      const { pathname, href } = router.state.location;
      if (pathname === '/sign-in') return;
      void forgetPilotData(queryClient).finally(
        () => void router.navigate({ to: '/sign-in', search: { redirect: href } }),
      );
    },
  });
  const router = createAppRouter(queryClient, history);
  return { queryClient, router };
}
