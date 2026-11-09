import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { usePilot } from './api/pilot';
import { BriefingPage } from './features/briefing/BriefingPage';
import { loadSamplePlan } from './features/briefing/samples';
import { SettingsPage } from './features/settings/SettingsPage';
import { HomePage } from './routes/home';
import { RootLayout } from './routes/root';
import { SampleError, SamplePending } from './routes/sample';

const rootRoute = createRootRoute({ component: RootLayout });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

/** Development-only briefing built from a captured OFP in fixtures/ofp. */
const sampleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sample/$name',
  loader: ({ params }) => loadSamplePlan(params.name),
  component: function SamplePage() {
    const plan = sampleRoute.useLoaderData();
    const pilot = usePilot();
    return (
      <BriefingPage plan={plan} {...(pilot.data && { preferredUnit: pilot.data.weightUnit })} />
    );
  },
  pendingComponent: SamplePending,
  errorComponent: SampleError,
});

export const routeTree = rootRoute.addChildren([homeRoute, settingsRoute, sampleRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, defaultPreload: 'intent', ...(history && { history }) });
}

export const router = createAppRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
