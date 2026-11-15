import type { SignInProfile } from '@ofplens/db';
import { decodeIdToken, GitHub, Google } from 'arctic';
import { z } from 'zod';

/**
 * A "Sign in with ..." provider: where to send the browser, and how to turn the code it comes
 * back with into who signed in. The OAuth protocol itself is done by `arctic`; route tests
 * use a fake.
 */
export interface OAuthProvider {
  id: 'google' | 'github';
  label: string;
  /**
   * The provider's sign-in page. `state` comes back unchanged (it proves the callback belongs
   * to a sign-in this browser started); `codeVerifier` is PKCE (RFC 7636), for providers that
   * support it.
   */
  authorizationUrl(state: string, codeVerifier: string): URL;
  /** Exchanges the callback's code for tokens, server to server, and reads the profile. */
  profile(code: string, codeVerifier: string): Promise<SignInProfile>;
}

export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  /** <PUBLIC_URL>/api/auth/<id>/callback, registered with the provider exactly like this. */
  redirectUri: string;
}

/** The claims we use from Google's ID token (OpenID Connect). */
const GoogleClaims = z.object({
  sub: z.string().min(1),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

/**
 * Google speaks OpenID Connect: the token response carries an ID token saying who signed in.
 * It came straight from Google over TLS in exchange for our client secret, so we read it
 * without checking its signature (OIDC Core 3.1.3.7 allows this for the token endpoint).
 */
export function createGoogleProvider({
  clientId,
  clientSecret,
  redirectUri,
}: ProviderConfig): OAuthProvider {
  const google = new Google(clientId, clientSecret, redirectUri);
  return {
    id: 'google',
    label: 'Google',
    authorizationUrl: (state, codeVerifier) =>
      google.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']),
    async profile(code, codeVerifier) {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      const claims = GoogleClaims.parse(decodeIdToken(tokens.idToken()));
      return {
        provider: 'google',
        subject: claims.sub,
        email: claims.email_verified ? (claims.email ?? null) : null,
        displayName: claims.name ?? null,
        avatarUrl: claims.picture ?? null,
      };
    },
  };
}

const GitHubUser = z.object({
  id: z.number().int(),
  login: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  avatar_url: z.string().nullable(),
});

/**
 * GitHub is plain OAuth 2.0 (no ID token): the access token is used once to read the public
 * profile, then forgotten. No scopes: we only need the public profile.
 */
export function createGitHubProvider(
  { clientId, clientSecret, redirectUri }: ProviderConfig,
  apiUrl = 'https://api.github.com',
): OAuthProvider {
  const github = new GitHub(clientId, clientSecret, redirectUri);
  return {
    id: 'github',
    label: 'GitHub',
    authorizationUrl: (state) => github.createAuthorizationURL(state, []),
    async profile(code) {
      const tokens = await github.validateAuthorizationCode(code);
      const res = await fetch(`${apiUrl}/user`, {
        headers: {
          authorization: `Bearer ${tokens.accessToken()}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'ofplens',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`GitHub /user answered HTTP ${res.status}`);
      const user = GitHubUser.parse(await res.json());
      return {
        provider: 'github',
        subject: String(user.id),
        email: user.email,
        displayName: user.name ?? user.login,
        avatarUrl: user.avatar_url,
      };
    },
  };
}

/** The providers that have a client id and secret configured, in button order. */
export function createProviders(env: {
  PUBLIC_URL: string;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  GITHUB_CLIENT_ID?: string | undefined;
  GITHUB_CLIENT_SECRET?: string | undefined;
}): OAuthProvider[] {
  const redirectUri = (id: string) => `${env.PUBLIC_URL}/api/auth/${id}/callback`;
  const providers: OAuthProvider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      createGoogleProvider({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: redirectUri('google'),
      }),
    );
  }
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.push(
      createGitHubProvider({
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        redirectUri: redirectUri('github'),
      }),
    );
  }
  return providers;
}
