# OFP Lens

A web app that imports a SimBrief OFP, shows a pilot briefing, and keeps a flight plan
history in Postgres. **For flight simulation (X-Plane 12) only.** The plan is in
`docs/PLAN.md`; work is tracked as tickets in `docs/TICKETS.md`.

## Setup

- Node 24 via nvm (`.nvmrc`). pnpm is installed under that Node, so run `nvm use` first
  in every new shell, or pnpm will not be found. `engineStrict` rejects other Node versions.
- `cp .env.example .env` on a fresh clone. The root `.env` is shared by the API, Vite's
  proxy and drizzle-kit.
- Postgres runs in Docker on host port **5433**, not 5432 (a native Postgres may own 5432).

## Commands

| Command                                | What it does                                                             |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`                             | Web (http://localhost:5173) and API (:3000) in parallel                  |
| `pnpm db:up` / `pnpm db:down`          | Start (and wait for) / stop the Postgres container                       |
| `pnpm db:generate` / `pnpm db:migrate` | Create a migration from the Drizzle schema / apply it                    |
| `pnpm test`                            | All Vitest tests (projects: `web` in jsdom, `node` for api and packages) |
| `pnpm test --project web`              | Only the web tests (no `--` with pnpm; it is passed on literally)        |
| `pnpm lint` / `pnpm typecheck`         | ESLint (type-aware) / `tsc --noEmit` in every workspace                  |
| `pnpm format` / `pnpm format:check`    | Prettier                                                                 |

Before saying a change is done, run `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`
(the same steps CI runs, plus `pnpm --filter @ofplens/web build`).

## Layout

```
apps/web       React + Vite + TanStack Router (code-based, src/router.tsx) + Query + Tailwind
apps/api       Fastify; buildApp() in app.ts (testable), server.ts (listens)
packages/ofp   OFP Zod schema, parseOfp(), shared domain types and formatters
packages/db    Drizzle client, schema, migrations
fixtures/ofp   Real SimBrief OFP JSON samples (OFP-05)
```

Workspace packages export their TypeScript source directly (`"exports": "./src/index.ts"`);
there is no build step between packages.

## Conventions

- **Numbers come from code, judgement comes from the agent.** Fuel, times and weights are
  parsed deterministically and rendered from the DB. An LLM never produces or rewrites them.
- **Zod at every boundary:** env, request/response schemas (via `fastify-type-provider-zod`),
  external API responses, and API responses in the web app (`apiFetch(path, schema)`).
- **API errors** are always `{ error: { code, message } }`. Throw `AppError(status, code, message)`
  for expected failures; anything else becomes a generic 500 and is logged.
- **Times** are UTC (`timestamptz`) everywhere; the UI shows Zulu first, local second.
- **Weights** are stored in the OFP's own unit; convert only for display via one shared helper.
- The browser only calls `/api`; the API proxies SimBrief, weather and the LLM.
- Imports: `import type` for types (lint-enforced), relative imports without file extensions.
- Tests sit next to the code as `*.test.ts(x)`. API routes are tested with `app.inject()` and
  injected dependencies (e.g. `pingDb`), not a live server.
- Every page shows that the app is for simulation use only.

## Workflow

- One ticket per branch (`ofp-NN-short-name`), merged to `main` when its "Done when" holds.
- Commit messages start with the ticket id, e.g. `OFP-05: ...`.
- Verify OFP field paths against `fixtures/ofp/*.json` before coding against them; the
  mapping in PLAN.md is expected, not confirmed.

## Known pins

- TypeScript stays on 6.x until typescript-eslint supports 7.
- `postgres` (postgres.js) is on 3.x.
- pnpm blocks dependency install scripts; allowed ones are listed under `allowBuilds` in
  `pnpm-workspace.yaml`.
