import type { SignInProfile } from '@ofplens/db';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app';
import type { OAuthProvider } from '../auth/providers';
import { SESSION_COOKIE } from '../auth/sessions';
import { createInMemoryAuthRepository, testDeps } from '../testing/fakes';
import { safeRedirect } from './auth';

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const ana: SignInProfile = {
  provider: 'github',
  subject: '1001',
  email: null,
  displayName: 'Ana',
  avatarUrl: null,
};

/** A provider whose sign-in page is example.test and whose code "good" means Ana. */
function fakeGitHub(profile = ana): OAuthProvider & { exchanges: [string, string][] } {
  const exchanges: [string, string][] = [];
  return {
    id: 'github',
    label: 'GitHub',
    exchanges,
    authorizationUrl: (state) => new URL(`https://github.example.test/login?state=${state}`),
    profile: (code, verifier) => {
      exchanges.push([code, verifier]);
      return code === 'good'
        ? Promise.resolve(profile)
        : Promise.reject(new Error('bad_verification_code'));
    },
  };
}

/** The real cookie-based sign-in, not the fixed pilot of testDeps. */
async function startApp(extra: Parameters<typeof testDeps>[0] = {}) {
  const auth = createInMemoryAuthRepository();
  const provider = fakeGitHub();
  app = await buildApp(
    testDeps({ auth, authenticate: undefined, authProviders: [provider], ...extra }),
  );
  return { app, auth, provider };
}

type Cookie = { name: string; value: string; path?: string; maxAge?: number; httpOnly?: boolean };
const cookieNamed = (res: { cookies: Cookie[] }, name: string) =>
  res.cookies.find((c) => c.name === name);

/** Starts a sign-in and returns the state and flow cookie the browser would carry back. */
async function begin(a: App, redirect = '/history') {
  const res = await a.inject({
    method: 'GET',
    url: `/api/auth/github/start?redirect=${encodeURIComponent(redirect)}`,
  });
  const location = new URL(res.headers.location as string);
  const flow = cookieNamed(res, 'ofplens_oauth')!;
  return { res, state: location.searchParams.get('state')!, flow };
}

describe('GET /api/auth/session', () => {
  it('says nobody is signed in, and how one can sign in', async () => {
    const { app: a } = await startApp();

    const res = await a.inject({ method: 'GET', url: '/api/auth/session' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      pilot: null,
      providers: [{ id: 'github', label: 'GitHub' }],
      devSignIn: false,
    });
  });
});

describe('signing in with a provider', () => {
  it('goes to the provider, comes back, and leaves a session cookie', async () => {
    const { app: a, provider } = await startApp();

    const { res, state, flow } = await begin(a);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/github\.example\.test\/login\?state=/);
    expect(flow).toMatchObject({ httpOnly: true, path: '/api/auth/', maxAge: 600 });

    const back = await a.inject({
      method: 'GET',
      url: `/api/auth/github/callback?code=good&state=${state}`,
      cookies: { ofplens_oauth: flow.value },
    });

    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe('/history');
    const session = cookieNamed(back, SESSION_COOKIE)!;
    expect(session).toMatchObject({ httpOnly: true, path: '/', sameSite: 'Lax' });
    expect(session).not.toHaveProperty('secure');
    // The PKCE verifier from the flow cookie went to the token exchange.
    expect(provider.exchanges).toEqual([['good', expect.any(String)]]);

    const me = await a.inject({
      method: 'GET',
      url: '/api/auth/session',
      cookies: { [SESSION_COOKIE]: session.value },
    });
    expect(me.json()).toMatchObject({ pilot: { displayName: 'Ana' } });
    const settings = await a.inject({
      method: 'GET',
      url: '/api/pilot',
      cookies: { [SESSION_COOKIE]: session.value },
    });
    expect(settings.statusCode).toBe(200);
  });

  it('marks cookies Secure when the app is served over https', async () => {
    const { app: a } = await startApp({ secureCookies: true });
    const { state, flow } = await begin(a);
    expect(flow).toMatchObject({ secure: true });

    const back = await a.inject({
      method: 'GET',
      url: `/api/auth/github/callback?code=good&state=${state}`,
      cookies: { ofplens_oauth: flow.value },
    });
    expect(cookieNamed(back, SESSION_COOKIE)).toMatchObject({ secure: true });
  });

  it.each([
    ['a state that is not ours (forged callback)', 'wrong', true],
    ['no flow cookie (expired, or another browser)', 'ours', false],
  ])('refuses %s without asking the provider', async (_, stateKind, sendCookie) => {
    const { app: a, provider, auth } = await startApp();
    const { state, flow } = await begin(a);

    const back = await a.inject({
      method: 'GET',
      url: `/api/auth/github/callback?code=good&state=${stateKind === 'ours' ? state : 'x'}`,
      ...(sendCookie && { cookies: { ofplens_oauth: flow.value } }),
    });

    expect(back.headers.location).toBe('/sign-in?error=expired');
    expect(cookieNamed(back, SESSION_COOKIE)).toBeUndefined();
    expect(provider.exchanges).toEqual([]);
    expect(auth.signIns).toEqual([]);
  });

  it('sends a pilot who cancelled at the provider back to the sign-in page', async () => {
    const { app: a } = await startApp();
    const { flow } = await begin(a);

    const back = await a.inject({
      method: 'GET',
      url: '/api/auth/github/callback?error=access_denied',
      cookies: { ofplens_oauth: flow.value },
    });

    expect(back.headers.location).toBe('/sign-in?error=cancelled');
  });

  it('reports a code the provider refuses as a failed sign-in', async () => {
    const { app: a } = await startApp();
    const { state, flow } = await begin(a);

    const back = await a.inject({
      method: 'GET',
      url: `/api/auth/github/callback?code=stale&state=${state}`,
      cookies: { ofplens_oauth: flow.value },
    });

    expect(back.headers.location).toBe('/sign-in?error=failed');
    expect(cookieNamed(back, SESSION_COOKIE)).toBeUndefined();
  });

  it('never redirects outside the app after signing in', async () => {
    const { app: a } = await startApp();
    const { state, flow } = await begin(a, 'https://evil.example/phish');

    const back = await a.inject({
      method: 'GET',
      url: `/api/auth/github/callback?code=good&state=${state}`,
      cookies: { ofplens_oauth: flow.value },
    });

    expect(back.headers.location).toBe('/');
  });

  it('sends an unknown provider back to the sign-in page', async () => {
    const { app: a } = await startApp();
    const res = await a.inject({ method: 'GET', url: '/api/auth/google/start' });
    expect(res.headers.location).toBe('/sign-in?error=failed');
  });
});

describe('safeRedirect', () => {
  it.each([
    ['/history', '/history'],
    ['/history/abc?units=lbs', '/history/abc?units=lbs'],
    [undefined, '/'],
    ['history', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['/api/auth/sign-out', '/'],
    ['/\nLocation: x', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });
});

describe('development sign-in', () => {
  it('does not exist unless switched on', async () => {
    const { app: a } = await startApp();
    const res = await a.inject({ method: 'POST', url: '/api/auth/dev', payload: { name: 'Ana' } });
    expect(res.statusCode).toBe(404);
  });

  it('signs in by name; the same name is the same pilot', async () => {
    const { app: a, auth } = await startApp({ devSignIn: true });

    const first = await a.inject({
      method: 'POST',
      url: '/api/auth/dev',
      payload: { name: 'Ana' },
    });
    const again = await a.inject({
      method: 'POST',
      url: '/api/auth/dev',
      payload: { name: 'ana' },
    });

    expect(first.statusCode).toBe(204);
    expect(cookieNamed(first, SESSION_COOKIE)).toBeDefined();
    expect(auth.signIns.map((p) => [p.provider, p.subject])).toEqual([
      ['dev', 'ana'],
      ['dev', 'ana'],
    ]);
    const ids = new Set([...auth.sessions.values()].map((p) => p.id));
    expect(ids.size).toBe(1);
    expect(
      (await a.inject({ method: 'GET', url: '/api/auth/session' })).json<{ devSignIn: boolean }>()
        .devSignIn,
    ).toBe(true);
    expect(again.statusCode).toBe(204);
  });
});

describe('POST /api/auth/sign-out', () => {
  it('ends the session: the cookie no longer works', async () => {
    const { app: a } = await startApp({ devSignIn: true });
    const signedIn = await a.inject({
      method: 'POST',
      url: '/api/auth/dev',
      payload: { name: 'Ana' },
    });
    const token = cookieNamed(signedIn, SESSION_COOKIE)!.value;

    const out = await a.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      cookies: { [SESSION_COOKIE]: token },
    });

    expect(out.statusCode).toBe(204);
    expect(cookieNamed(out, SESSION_COOKIE)).toMatchObject({ value: '' });
    const after = await a.inject({
      method: 'GET',
      url: '/api/pilot',
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe('rate limits', () => {
  it('answers 429 in the usual error shape once a pilot goes over the limit', async () => {
    app = await buildApp(testDeps({ rateLimits: { simbrief: 2 } }));

    const codes = [];
    for (let i = 0; i < 3; i++) {
      codes.push((await app.inject({ method: 'GET', url: '/api/simbrief/latest' })).statusCode);
    }
    const limited = await app.inject({ method: 'GET', url: '/api/simbrief/latest' });

    // The first two get through (400: no username saved); then the limit applies.
    expect(codes).toEqual([400, 400, 429]);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: expect.stringMatching(/^Too many requests/) },
    });
  });
});
