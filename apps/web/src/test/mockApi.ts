import { vi } from 'vitest';
import { jsonResponse } from './render';

type Handler = (request: { body: unknown; url: URL }) => Response | Promise<Response>;

/**
 * Replaces fetch with a tiny fake API. Keys are "METHOD /path", e.g. "GET /api/pilot".
 * /api/health answers "ok" unless overridden, and a plan's weather answers "nothing to show,
 * checked just now" (so nothing auto-refreshes), its hazards "none, checked just now", and a
 * plan's latest AI briefing answers "none",
 * unless a test gives its own handler.
 * Unknown routes fail the test loudly.
 */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const all: Record<string, Handler> = {
    'GET /api/health': () => jsonResponse({ status: 'ok', db: 'up' }),
    ...handlers,
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const href = input instanceof Request ? input.url : input.toString();
      const url = new URL(href, 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const key = `${method} ${url.pathname}`;
      if (key !== 'GET /api/health') calls.push({ method, path: url.pathname + url.search, body });
      const handler =
        all[key] ??
        (QUIET_WEATHER.test(key)
          ? quietWeather
          : QUIET_HAZARDS.test(key)
            ? quietHazards
            : NO_BRIEFING.test(key)
              ? noBriefing
              : undefined);
      if (!handler) throw new Error(`mockApi: no handler for ${key}`);
      return handler({ body, url });
    }),
  );

  return { calls };
}

const QUIET_WEATHER = /^GET \/api\/flight-plans\/[^/]+\/weather$/;
const quietWeather: Handler = () =>
  jsonResponse({ stations: [], liveCheckedAt: new Date().toISOString() });

const QUIET_HAZARDS = /^GET \/api\/flight-plans\/[^/]+\/hazards$/;
const quietHazards: Handler = () =>
  jsonResponse({
    checkedAt: new Date().toISOString(),
    takeoffAt: new Date().toISOString(),
    unavailable: [],
    advisoriesChecked: 0,
    hazards: [],
  });

const NO_BRIEFING = /^GET \/api\/flight-plans\/[^/]+\/briefings\/latest$/;
const noBriefing: Handler = () => jsonResponse({ briefing: null });

export const apiError = (status: number, code: string, message: string) =>
  jsonResponse({ error: { code, message } }, status);
