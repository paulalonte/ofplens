import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { BriefingPage } from './features/briefing/BriefingPage';
import { loadSamplePlan } from './features/briefing/samples';
import { HomePage } from './routes/home';
import { RootLayout } from './routes/root';
import { SampleError, SamplePending } from './routes/sample';

const rootRoute = createRootRoute({ component: RootLayout });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});

/** Development-only briefing built from a captured OFP in fixtures/ofp. */
const sampleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sample/$name',
  loader: ({ params }) => loadSamplePlan(params.name),
  component: function SamplePage() {
    return <BriefingPage plan={sampleRoute.useLoaderData()} />;
  },
  pendingComponent: SamplePending,
  errorComponent: SampleError,
});

const routeTree = rootRoute.addChildren([homeRoute, sampleRoute]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
