import type { FlightPlanSummary } from '@ofplens/ofp';
import type { RouteHazardView } from '@ofplens/weather';
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Card } from '../../Card';
import { describeHazard, HAZARD_COLOR, HAZARD_LABEL } from '../hazardStyle';
import { buildRouteMapData } from './mapData';

const RouteMap = lazy(() => import('./RouteMap'));

interface Props {
  plan: FlightPlanSummary;
  /** Hazards along the route (saved plans); none on sample pages. */
  hazards?: readonly RouteHazardView[];
}

/**
 * The route on a map, with the hazard areas that touch it and the affected stretches in the
 * hazard's colour. The map library only loads once the card scrolls into view.
 */
export function RouteMapCard({ plan, hazards = [] }: Props) {
  const data = useMemo(() => buildRouteMapData(plan, hazards, describeHazard), [plan, hazards]);
  const [ref, visible] = useVisible<HTMLDivElement>();
  const dark = useDarkMode();
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);
  if (!data) return null;

  const unavailable = (
    <p className="flex h-80 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500 sm:h-96 dark:bg-slate-800 dark:text-slate-400">
      Map unavailable right now.
    </p>
  );

  return (
    <Card
      title="Route map"
      aside={
        <span className="text-xs text-slate-500 dark:text-slate-400">Tap an area for details</span>
      }
    >
      <div ref={ref}>
        {failed ? (
          unavailable
        ) : visible ? (
          <MapErrorBoundary fallback={unavailable}>
            <Suspense fallback={<MapPlaceholder text="Loading map…" />}>
              <RouteMap data={data} dark={dark} onError={onError} />
            </Suspense>
          </MapErrorBoundary>
        ) : (
          <MapPlaceholder text="The map loads when you scroll to it." />
        )}
      </div>
      {data.kinds.length > 0 && (
        <ul aria-label="Map legend" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {data.kinds.map((kind) => (
            <li key={kind} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: HAZARD_COLOR[kind] }}
              />
              {HAZARD_LABEL[kind]}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Route from the first navlog fix, along great circles. Not for navigation; for flight
        simulation only.
      </p>
    </Card>
  );
}

function MapPlaceholder({ text }: { text: string }) {
  return (
    <p className="flex h-80 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500 sm:h-96 dark:bg-slate-800 dark:text-slate-400">
      {text}
    </p>
  );
}

/** True once the element has come near the viewport. Never true without IntersectionObserver. */
function useVisible<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || visible || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible] as const;
}

/** Follows the system light/dark setting, like the rest of the app. */
function useDarkMode(): boolean {
  const query = useMemo(
    () => (typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-color-scheme: dark)')),
    [],
  );
  const [dark, setDark] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const update = () => setDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [query]);
  return dark;
}

/** The map chunk failed to load (offline, new deploy): show the fallback, keep the page. */
class MapErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { error: boolean }
> {
  override state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  override render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}
