# Sign-in (OFP-42)

Pilots sign in with Google or GitHub. Each pilot sees only their own plans, settings and
briefings. Locally and in tests you can also sign in by typing a name (development sign-in).

## Running locally

Add one of these to your `.env` (the API reads it on start):

```bash
# Quickest: sign in as any name, no password. Refused unless PUBLIC_URL is localhost.
DEV_SIGN_IN=true
```

or a real provider (see below). `PUBLIC_URL` defaults to `http://localhost:5173`, which is right
for `pnpm dev`. With no provider and no development sign-in, the sign-in page says so and
nobody can sign in.

The first account to sign in to a server **takes over the pilot from before sign-in existed**,
with all its plans. So on your own database, sign in first and your history is still there.
On a fresh database (AWS), the first pilot simply starts empty.

## Registering the app with GitHub

GitHub allows **one callback URL per OAuth app**, so register one app per address: one for
`pnpm dev`, one for each deployed environment.

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**.
2. Application name: `OFP Lens (dev)`. Homepage URL: `http://localhost:5173`.
3. Authorization callback URL: `http://localhost:5173/api/auth/github/callback`
   (on AWS: `https://<your domain>/api/auth/github/callback`).
4. Register, then **Generate a new client secret**.
5. Put both in `.env` yourself (never paste the secret into chat or a file in git):

   ```bash
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```

No scopes are requested: the app reads only the public profile (id, name, picture).

## Registering the app with Google

1. [Google Cloud console](https://console.cloud.google.com/) → create a project (e.g.
   `ofplens`).
2. **APIs & Services → OAuth consent screen**: External, app name OFP Lens, your email as
   support and developer contact. Scopes: `openid`, `email`, `profile` (the non-sensitive
   ones, so no review is needed). While the app is in **Testing**, add yourself (and anyone
   else) under Test users.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web
   application**.
4. Authorized redirect URIs: `http://localhost:5173/api/auth/google/callback`. Google allows
   several, so add the kind and AWS addresses to the same client later.
5. Put the client ID and secret in `.env` yourself:

   ```bash
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

Restart `pnpm dev`; the sign-in page shows a button for each configured provider.

## On Kubernetes

The chart reads the client IDs and secrets from the existing Secret (`existingSecret`), each
key optional: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`. `api.publicUrl` is required and must be the address pilots use.
`values-kind.yaml` sets `http://localhost:8088` and switches development sign-in on; the AWS
values will set the real domain and leave it off.

## How it works

```
Browser                         API                               GitHub / Google
  │  Continue with GitHub         │                                    │
  ├─ GET /api/auth/github/start ─▶│ state + PKCE verifier → cookie      │
  │◀──── 302 to provider ─────────┤ (ofplens_oauth, 10 min, httpOnly)  │
  ├──────────────── sign in, allow ───────────────────────────────────▶│
  │◀──────── 302 /api/auth/github/callback?code&state ─────────────────┤
  ├─ GET …/callback ─────────────▶│ state matches the cookie?          │
  │                               ├─ code (+ verifier, client secret) ─▶│
  │                               │◀──────────── tokens ───────────────┤
  │                               │ who is it? (ID token / GET /user)   │
  │                               │ find or create pilot, new session   │
  │◀── 302 back, ofplens_session ─┤ (random token; DB keeps its SHA-256)│
```

- **Sessions live in Postgres** (`sessions`), so any API pod can serve any request.
  The cookie is `httpOnly` (scripts cannot read it), `SameSite=Lax` (not sent on cross-site
  form posts: CSRF protection) and `Secure` when `PUBLIC_URL` is https. 30 days.
- **Every `/api` route needs a session** except `/api/health` and `/api/auth/*`
  (`apps/api/src/auth/sessions.ts`, one hook for the whole app).
- **Plan ownership:** every `/api/flight-plans/:id/...` route first checks the plan belongs to
  the signed-in pilot. Another pilot's plan answers 404, exactly like a missing one.
- **Pilots are keyed by provider and the provider's user id**, never by email.
- **Limits:** AI briefings per pilot and for everyone together per 24 hours
  (`BRIEFING_DAILY_LIMIT`, `BRIEFING_GLOBAL_DAILY_LIMIT`), counted in `briefing_usage` so
  deleting plans does not reset them. Per-minute rate limits on the endpoints that call
  SimBrief, the weather service and Claude, and on sign-in (`apps/api/src/rateLimits.ts`).
