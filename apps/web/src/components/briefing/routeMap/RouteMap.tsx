import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre looks for its worker next to its own module, which bundling moves; point it at the
// copy Vite emits instead.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef } from 'react';
import type { HazardProps, RouteMapData } from './mapData';

setWorkerUrl(workerUrl);

/** Free vector tiles without a key (OpenStreetMap data); overridable for end-to-end tests. */
const STYLE_BASE = import.meta.env.VITE_MAP_STYLE_BASE ?? 'https://tiles.openfreemap.org/styles';

interface Props {
  data: RouteMapData;
  dark: boolean;
  /** The map or its style could not load. */
  onError: () => void;
}

/**
 * The MapLibre map itself. Loaded on demand (it is large), so it lives in its own chunk; see
 * RouteMapCard. Text from the feeds goes into popups as text, never as HTML.
 */
export default function RouteMap({ data, dark, onError }: Props) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const ink = dark ? '#f8fafc' : '#0f172a';
    const halo = dark ? '#0f172a' : '#ffffff';

    const map = new MapLibreMap({
      container: container.current,
      style: `${STYLE_BASE}/${dark ? 'dark' : 'positron'}`,
      bounds: data.bounds,
      fitBoundsOptions: { padding: 40, maxZoom: 8 },
      // On a phone, one finger scrolls the page; two move the map.
      cooperativeGestures: true,
      attributionControl: { compact: true },
      renderWorldCopies: true,
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    let loaded = false;
    map.on('error', () => {
      if (!loaded) onError();
    });

    map.on('load', () => {
      loaded = true;
      map.addSource('hazards', { type: 'geojson', data: data.hazards });
      map.addSource('route', { type: 'geojson', data: data.route });
      map.addSource('affected', { type: 'geojson', data: data.affected });
      map.addSource('fixes', { type: 'geojson', data: data.fixes });

      map.addLayer({
        id: 'hazard-fill',
        type: 'fill',
        source: 'hazards',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 },
      });
      map.addLayer({
        id: 'hazard-outline',
        type: 'line',
        source: 'hazards',
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 },
      });
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ink, 'line-width': 2 },
      });
      map.addLayer({
        id: 'affected',
        type: 'line',
        source: 'affected',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 5 },
      });
      map.addLayer({
        id: 'fixes',
        type: 'circle',
        source: 'fixes',
        paint: {
          'circle-radius': ['case', ['get', 'airport'], 5, 2.5],
          'circle-color': ink,
          'circle-stroke-color': halo,
          'circle-stroke-width': 1,
        },
      });
      map.addLayer({
        id: 'fix-labels',
        type: 'symbol',
        source: 'fixes',
        layout: {
          'text-field': ['get', 'ident'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['case', ['get', 'airport'], 13, 11],
          'text-offset': [0, 0.9],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.5 },
      });

      const showHazard = (event: MapLayerMouseEvent) => {
        const props = event.features?.[0]?.properties as HazardProps | undefined;
        if (!props) return;
        const content = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = props.title;
        const detail = document.createElement('div');
        detail.textContent = props.detail;
        content.append(title, detail);
        new Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(event.lngLat)
          .setDOMContent(content)
          .addTo(map);
      };
      map.on('click', 'hazard-fill', showHazard);
      map.on('mouseenter', 'hazard-fill', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'hazard-fill', () => (map.getCanvas().style.cursor = ''));
    });

    return () => map.remove();
  }, [data, dark, onError]);

  return (
    <div
      ref={container}
      role="img"
      aria-label="Map of the route with the hazards along it"
      className="h-80 w-full overflow-hidden rounded-lg text-slate-900 sm:h-96"
    />
  );
}
