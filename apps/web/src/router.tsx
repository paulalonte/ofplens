import { createRouter, type RouterHistory } from '@tanstack/react-router';
// Generated from the files in src/routes by @tanstack/router-plugin (see vite.config.ts).
import { routeTree } from './routeTree.gen';

/** Pass a memory history in tests; the browser history is used otherwise. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, defaultPreload: 'intent', ...(history && { history }) });
}

export const router = createAppRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
