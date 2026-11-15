import type { AuthRepository, SignInProfile } from '@ofplens/db';
import { AuthSessionResponse, DevSignInRequest, type SignInError } from '@ofplens/ofp';
import { generateCodeVerifier, generateState } from 'arctic';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { OAuthProvider } from '../auth/providers';
import { SESSION_COOKIE } from '../auth/sessions';
import { perMinute } from '../rateLimits';

export interface AuthRouteOptions {
  auth: AuthRepository;
  providers: OAuthProvider[];
  /** Sign in by name without a password (development and end-to-end tests only). */
  devSignIn: boolean;
  /** Mark cookies Secure (sent over https only): true whenever PUBLIC_URL is https. */
  secureCookies: boolean;
  sessionTtlMs: number;
  /** Sign-in attempts per minute per address. */
  rateLimit?: number | undefined;
}

/** The short-lived cookie that carries a started sign-in from /start to /callback. */
const FLOW_COOKIE = 'ofplens_oauth';
const FLOW_TTL_S = 10 * 60;
const Flow = z.object({
  provider: z.string(),
  state: z.string(),
  codeVerifier: z.string(),
  redirect: z.string(),
});

const ProviderParams = z.object({ provider: z.string() });
const RedirectQuery = z.object({ redirect: z.string().max(2000).optional() });

/**
 * Only paths inside this app, so a link like /api/auth/github/start?redirect=https://evil.example
 * cannot send a pilot elsewhere after signing in (an "open redirect").
 */
export function safeRedirect(value: string | undefined): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\') ||
    value.startsWith('/api/') ||
    [...value].some((char) => char.charCodeAt(0) < 0x20)
  ) {
    return '/';
  }
  return value;
}

/**
 * Sign-in with Google and GitHub (OAuth 2.0 authorization code flow), development sign-in,
 * the current session, and sign-out. Starting and finishing a sign-in are browser navigations,
 * so they answer with redirects, not JSON.
 */
export const authRoutes: FastifyPluginCallbackZod<AuthRouteOptions> = (
  app,
  { auth, providers, devSignIn, secureCookies, sessionTtlMs, rateLimit },
  done,
) => {
  const byId = new Map(providers.map((p) => [p.id as string, p]));

  async function startSession(reply: FastifyReply, profile: SignInProfile) {
    const { pilotId, created, claimed } = await auth.signIn(profile);
    const { token, expiresAt } = await auth.createSession(pilotId, { ttlMs: sessionTtlMs });
    reply.log.info({ pilotId, provider: profile.provider, created, claimed }, 'Signed in');
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      expires: expiresAt,
    });
  }

  app.get(
    '/api/auth/session',
    { schema: { response: { 200: AuthSessionResponse } } },
    async (request, reply) => {
      // Who is signed in must never come from a cache.
      void reply.header('cache-control', 'no-store');
      return {
        pilot: request.pilot,
        providers: providers.map(({ id, label }) => ({ id, label })),
        devSignIn,
      };
    },
  );

  /** Sends the browser to the provider, remembering state and PKCE verifier in a cookie. */
  app.get(
    '/api/auth/:provider/start',
    {
      schema: { params: ProviderParams, querystring: RedirectQuery },
      config: perMinute(rateLimit),
    },
    async (request, reply) => {
      const provider = byId.get(request.params.provider);
      if (!provider) return reply.redirect('/sign-in?error=failed');

      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      const flow = {
        provider: provider.id,
        state,
        codeVerifier,
        redirect: safeRedirect(request.query.redirect),
      };
      reply.setCookie(FLOW_COOKIE, JSON.stringify(flow), {
        path: '/api/auth/',
        httpOnly: true,
        // Lax: sent on the provider's top-level redirect back to us, not on cross-site posts.
        sameSite: 'lax',
        secure: secureCookies,
        maxAge: FLOW_TTL_S,
      });
      return reply.redirect(provider.authorizationUrl(state, codeVerifier).toString());
    },
  );

  /** Where the provider sends the browser back: check state, exchange the code, sign in. */
  app.get(
    '/api/auth/:provider/callback',
    {
      schema: {
        params: ProviderParams,
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      },
      config: perMinute(rateLimit),
    },
    async (request, reply) => {
      const fail = (error: SignInError) => reply.redirect(`/sign-in?error=${error}`);
      const cookie = request.cookies[FLOW_COOKIE];
      reply.clearCookie(FLOW_COOKIE, { path: '/api/auth/' });

      // The pilot pressed "Cancel" at the provider.
      if (request.query.error) return fail('cancelled');

      const flow = Flow.safeParse(parseJson(cookie));
      const provider = byId.get(request.params.provider);
      // No cookie (expired, another browser) or a state that is not ours: possibly forged.
      if (
        !flow.success ||
        !provider ||
        flow.data.provider !== provider.id ||
        !request.query.state ||
        request.query.state !== flow.data.state ||
        !request.query.code
      ) {
        return fail('expired');
      }

      let profile: SignInProfile;
      try {
        profile = await provider.profile(request.query.code, flow.data.codeVerifier);
      } catch (err) {
        request.log.warn({ err, provider: provider.id }, 'Sign-in with provider failed');
        return fail('failed');
      }
      await startSession(reply, profile);
      return reply.redirect(safeRedirect(flow.data.redirect));
    },
  );

  if (devSignIn) {
    /** Development only: sign in as whoever you type. The same name is the same pilot. */
    app.post(
      '/api/auth/dev',
      { schema: { body: DevSignInRequest }, config: perMinute(rateLimit) },
      async (request, reply) => {
        const { name } = request.body;
        await startSession(reply, {
          provider: 'dev',
          subject: name.toLowerCase(),
          email: null,
          displayName: name,
          avatarUrl: null,
        });
        return reply.status(204).send();
      },
    );
  }

  app.post('/api/auth/sign-out', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await auth.deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  done();
};

function parseJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
