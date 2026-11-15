import type { AuthRepository, FlightPlanRepository, SessionPilot } from '@ofplens/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors';

export const SESSION_COOKIE = 'ofplens_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in pilot, or null. Set for every request before its handler runs. */
    pilot: SessionPilot | null;
  }
}

/** Finds who is behind a request. Real: the session cookie. Route tests inject a fixed pilot. */
export type Authenticate = (request: FastifyRequest) => Promise<SessionPilot | null>;

export function cookieAuthenticate(auth: AuthRepository): Authenticate {
  return async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    return token ? auth.findSession(token) : null;
  };
}

/** Routes anyone may call: health checks and the sign-in flow itself. Everything else under /api needs a pilot. */
const isPublic = (url: string) => url === '/api/health' || url.startsWith('/api/auth/');

/**
 * Sign-in for every route, in two hooks on the root instance (so a new route cannot forget it):
 *
 * 1. onRequest: who is this? Then 401 for any /api route that is not public.
 * 2. preHandler: for /api/flight-plans/:id/..., is the plan theirs? Another pilot's plan answers
 *    404 exactly like a missing one, so ids of other pilots' plans cannot even be confirmed.
 */
export function registerSessions(
  app: FastifyInstance,
  {
    authenticate,
    flightPlans,
  }: { authenticate: Authenticate; flightPlans: Pick<FlightPlanRepository, 'ownerOf'> },
): void {
  app.decorateRequest('pilot', null);

  app.addHook('onRequest', async (request) => {
    const url = request.routeOptions.url;
    // Unknown routes go on to the 404 handler; health probes skip the database.
    if (url === undefined || url === '/api/health') return;
    request.pilot = await authenticate(request);
    if (!request.pilot && url.startsWith('/api/') && !isPublic(url)) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to use OFP Lens.');
    }
  });

  app.addHook('preHandler', async (request) => {
    if (!request.routeOptions.url?.startsWith('/api/flight-plans/:id')) return;
    const { id } = request.params as { id: string };
    if ((await flightPlans.ownerOf(id)) !== signedIn(request).id) throw planNotFound();
  });
}

/** The signed-in pilot in a route that registerSessions protects. */
export function signedIn(request: FastifyRequest): SessionPilot {
  if (!request.pilot) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to use OFP Lens.');
  return request.pilot;
}

export const planNotFound = () =>
  new AppError(
    404,
    'FLIGHT_PLAN_NOT_FOUND',
    'That flight plan does not exist (it may have been deleted).',
  );
