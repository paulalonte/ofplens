import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { PageSpinner } from './components/PageSpinner';
import { RouteError } from './components/RouteError';
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
