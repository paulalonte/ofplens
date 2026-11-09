import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { usePilot } from './api/pilot';
import { BriefingPage } from './features/briefing/BriefingPage';
import { loadSamplePlan } from './features/briefing/samples';
import { HistoryPage } from './features/history/HistoryPage';
import { PlanPage, type ImportOutcome } from './features/plan/PlanPage';
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

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/history',
  component: HistoryPage,
});

/** A saved plan. `?imported=new|existing` is set when arriving from "Load latest plan". */
const planRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plans/$planId',
  validateSearch: (search: Record<string, unknown>): { imported?: ImportOutcome } =>
    search.imported === 'new' || search.imported === 'existing'
      ? { imported: search.imported }
      : {},
  component: function PlanRoute() {
    const { planId } = planRoute.useParams();
    const { imported } = planRoute.useSearch();
    return <PlanPage key={planId} planId={planId} imported={imported} />;
  },
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

export const routeTree = rootRoute.addChildren([
  homeRoute,
  historyRoute,
  planRoute,
  settingsRoute,
  sampleRoute,
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, defaultPreload: 'intent', ...(history && { history }) });
}

export const router = createAppRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
