import { AuthSessionResponse, type DevSignInRequest } from '@ofplens/ofp';
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
  type QueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from './client';

/** Who is signed in, and the ways to sign in. The root route loads it before every page. */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: () => apiFetch('/api/auth/session', AuthSessionResponse),
  // Changes only when we sign in or out, and both reset the cache.
  staleTime: Infinity,
});

export function useSession() {
  return useSuspenseQuery(sessionQuery).data;
}

/** Where "Continue with GitHub" goes: a full-page navigation to the API, then the provider. */
export const signInUrl = (provider: string, redirect: string) =>
  `/api/auth/${provider}/start?redirect=${encodeURIComponent(redirect)}`;

const NoContent = z.unknown();

/**
 * After signing in or out: drop every pilot's cached data (plans, settings, briefings), then
 * ask who is signed in now. The session query itself is kept, not removed, so the mounted
 * layout follows the change instead of holding on to a removed query.
 */
export async function forgetPilotData(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
  await queryClient.refetchQueries({ queryKey: sessionQuery.queryKey });
}

/** Development sign-in by name. Afterwards nothing cached belongs to anyone else. */
export function useDevSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DevSignInRequest) =>
      apiFetch('/api/auth/dev', NoContent, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => forgetPilotData(queryClient),
  });
}

/**
 * Ends the session. Everything cached is dropped, so the next pilot on this browser never sees
 * the last one's plans, settings or briefings.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/api/auth/sign-out', NoContent, { method: 'POST' }),
    onSettled: () => forgetPilotData(queryClient),
  });
}
