# OFP Lens

A pilot briefing for your [SimBrief](https://www.simbrief.com) flight plans. Generate a plan on
SimBrief, click **Load latest plan**, and OFP Lens shows times (Zulu and local), fuel, payload,
the weather printed at dispatch and the full navigation log, in kg or lb.

> **For flight simulation only** (built for X-Plane 12). Not for real-world navigation.
> OFP Lens is not affiliated with SimBrief, Navigraph or Laminar Research.

**Status:** MVP in progress. The roadmap is in [docs/PLAN.md](docs/PLAN.md); work is tracked
ticket by ticket in [docs/TICKETS.md](docs/TICKETS.md).

| Works today                                                                                                                | Coming next                                 |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Briefing page: header, times, fuel, payload, OFP weather, navigation log                                                   | Deployment to AWS (3b)                      |
| Settings: SimBrief username and kg/lb preference, saved in Postgres                                                        | AI weather and hazard briefing (phases 5–7) |
| One-click **Load latest plan**: fetched from SimBrief and saved to your history                                            | MCP server for Claude (phase 8)             |
| **History** of every plan you loaded; open or delete any of them                                                           |                                             |
| **Weather at dispatch vs now** per airport, with VFR–LIFR badges and a "changed since dispatch" flag (aviationweather.gov) |                                             |

## What you need

| Tool                                                              | Version    | Notes                                                                                    |
| ----------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| [Node.js](https://nodejs.org)                                     | 24 (LTS)   | Pinned in `.nvmrc`. Easiest with [nvm](https://github.com/nvm-sh/nvm).                   |
| [pnpm](https://pnpm.io)                                           | 12.18      | Pinned in `package.json` (`packageManager`).                                             |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | any recent | Runs Postgres 16. Must be running before `pnpm dev`.                                     |
| A [SimBrief](https://www.simbrief.com) account                    | free       | You need your SimBrief **username** (Account Settings), and at least one generated plan. |

## Quick start

```bash
git clone https://github.com/paulalonte/ofplens.git
cd ofplens
```

Install the Node version from `.nvmrc`, then pnpm under it:

```bash
nvm install
```

```bash
npm install -g pnpm@12.18.0
```

Install dependencies and create your local settings file:

```bash
pnpm install
```

```bash
cp .env.example .env
```

Start everything. This starts Postgres in Docker, applies database migrations, then runs the web
app and the API:

```bash
pnpm dev
```

Open **http://localhost:5173**, go to **Settings**, enter your SimBrief username, then press
**Load latest plan** on the home page. Every plan you load is saved under **History**.

### Every day after that

```bash
nvm use
```

```bash
pnpm dev
```

`nvm use` is needed once per terminal (pnpm lives under nvm's Node 24). To skip it, make Node 24
your default with `nvm alias default 24`.

## What runs where

| Service                | Address                                                  | Started by                 |
| ---------------------- | -------------------------------------------------------- | -------------------------- |
| Web app (Vite + React) | http://localhost:5173                                    | `pnpm dev`                 |
| API (Fastify)          | http://localhost:3000 (the web app proxies `/api` to it) | `pnpm dev`                 |
| Postgres 16 (Docker)   | `localhost:5433`, user / password / database `ofplens`   | `pnpm dev` or `pnpm db:up` |

Postgres uses port **5433**, not the usual 5432, so it does not clash with a Postgres installed
directly on your machine. Settings live in `.env` (git-ignored); see `.env.example`.

## Commands

| Command                             | What it does                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Start Postgres, apply migrations, run web and API                                                 |
| `pnpm dev:apps`                     | Run only web and API (Postgres already up and migrated)                                           |
| `pnpm db:up` / `pnpm db:down`       | Start / stop the Postgres container (your data is kept)                                           |
| `pnpm db:migrate`                   | Apply new database migrations (`pnpm dev` does this for you)                                      |
| `pnpm db:generate`                  | Create a migration after changing `packages/db/src/schema.ts`                                     |
| `pnpm db:studio`                    | Browse the database in Drizzle Studio                                                             |
| `pnpm test`                         | All tests: unit, component, and integration tests against Postgres                                |
| `pnpm test --project web`           | Only one test group: `web`, `node` or `integration`                                               |
| `pnpm e2e`                          | End-to-end tests in a real browser (Playwright); needs `pnpm db:up` and, once, `pnpm e2e:install` |
| `pnpm lint` / `pnpm typecheck`      | ESLint / TypeScript                                                                               |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                          |

## Looking at the database

The easiest way is Drizzle Studio:

```bash
pnpm db:studio
```

Or use `psql`. Inside the container (no local install needed):

```bash
docker compose exec db psql -U ofplens -d ofplens
```

Or a local `psql` / GUI (TablePlus, DBeaver, Postico) with host `localhost`, port `5433`, and
user, password and database all `ofplens`:

```bash
psql postgres://ofplens:ofplens@localhost:5433/ofplens
```

Plain `psql -U postgres` connects to a Postgres installed on your machine (port 5432), not to
this one.

To wipe the database and start fresh, run `docker compose down -v` (this **deletes all saved
data**), then `pnpm dev`.

## Tests

```bash
pnpm test
```

Three groups run together:

- **web**: React components and pages in a simulated browser (jsdom), with the API faked.
- **node**: the OFP parser, formatters and API routes, with the database and SimBrief faked.
- **integration**: `*.int.test.ts` against a real Postgres. Each test file gets its own temporary
  database, so your dev data is never touched. Needs Docker running (`pnpm db:up`).

**End-to-end** (`pnpm e2e`, Playwright): the real web app and API in Chromium against a fresh
`ofplens_e2e` database, with a fake SimBrief and a fake aviationweather.gov serving saved OFPs and weather reports. It walks through what a pilot
does: set the username, load a plan, compare its weather at dispatch with now, find it in
History, open it, delete it, and the error for an unknown SimBrief user. It uses its own ports (web 5174, API 3100), so it can run next to
`pnpm dev`. Install the browser once with `pnpm e2e:install`.

Tests never call SimBrief; they use the real OFPs saved in `fixtures/ofp/`. CI runs the same
checks, with its own Postgres, on every pull request.

## API

All errors come back as `{ "error": { "code", "message" } }`.

| Method    | Path                                     | Does                                                                                     |
| --------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET       | `/api/health`                            | API and database status                                                                  |
| GET / PUT | `/api/pilot`                             | Read / save the SimBrief username and kg/lb preference                                   |
| GET       | `/api/simbrief/latest`                   | Fetch and parse your latest SimBrief plan (nothing saved)                                |
| POST      | `/api/flight-plans/import`               | Fetch your latest plan and save it (201 new, 200 already saved)                          |
| GET       | `/api/flight-plans?cursor=&limit=`       | Your saved plans, newest first, a page at a time                                         |
| GET       | `/api/flight-plans/:id`                  | One saved plan, in the briefing's shape                                                  |
| DELETE    | `/api/flight-plans/:id`                  | Delete a saved plan                                                                      |
| GET       | `/api/flight-plans/:id/weather`          | Weather at dispatch (OFP) vs now (latest live), per airport                              |
| POST      | `/api/flight-plans/:id/weather/refresh`  | Fetch live METAR/TAF from aviationweather.gov (cached 5 min per airport)                 |
| POST      | `/api/flight-plans/:id/briefings`        | Run the AI briefing; progress streamed as Server-Sent Events (needs `ANTHROPIC_API_KEY`) |
| GET       | `/api/flight-plans/:id/briefings/latest` | The plan's latest AI briefing                                                            |

## Project layout

```
apps/
  web/          React app (Vite, TanStack file-based routes in src/routes, Query, Tailwind)
  api/          HTTP API (Fastify, Zod)
packages/
  ofp/          SimBrief OFP schema, parseOfp(), formatters, shared API schemas
  db/           Drizzle schema, migrations, repositories, test database helpers
  weather/      aviationweather.gov client for live METAR/TAF
  agent/        AI briefing: tools the agent calls, and the Briefing schema
fixtures/ofp/   Real SimBrief OFPs (personal data removed) used by tests
fixtures/weather/  Real METAR/TAF responses used by tests (`pnpm fixture:weather`)
docs/           PLAN.md (design and roadmap), TICKETS.md (MVP tickets)
scripts/        capture-ofp.ts (save your latest OFP as a fixture)
```

## Adding a test fixture

`pnpm fixture:capture <name>` saves your latest SimBrief OFP into `fixtures/ofp/<name>.json`
with your Pilot ID replaced by `0000000`. It reads `SIMBRIEF_PILOT_ID` (digits, from SimBrief
Account Settings) from `.env`.

## Troubleshooting

| Problem                                            | Fix                                                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm: command not found`                          | Run `nvm use` in this terminal (or `nvm alias default 24` once).                                    |
| `Unsupported engine` / Node version errors         | Run `nvm install` to get the Node version from `.nvmrc`.                                            |
| `pnpm dev` fails at `docker compose`               | Start Docker Desktop and try again.                                                                 |
| Header says **API unreachable**                    | The API isn't running or crashed; check the `apps/api` output in the `pnpm dev` terminal.           |
| Header says **DB down**                            | Postgres isn't running: `pnpm db:up`.                                                               |
| "Set your SimBrief username first"                 | Open **Settings** and save your SimBrief username.                                                  |
| "SimBrief has no flight plan for …"                | Check the username in your SimBrief account settings, and generate a plan there first.              |
| Integration tests say "Start it with `pnpm db:up`" | Start Docker Desktop, then `pnpm db:up`.                                                            |
| Port 5433, 3000 or 5173 already in use             | Stop the other process, or change `POSTGRES_PORT` / `PORT` in `.env` (keep `DATABASE_URL` in step). |

## Contributing

Each ticket in [docs/TICKETS.md](docs/TICKETS.md) gets its own branch (`ofp-NN-short-name`)
and pull request. `main` is protected: a PR can merge only when CI (format, lint, typecheck,
tests, web build) passes, and it is squash-merged. Conventions for code and for Claude Code are
in [CLAUDE.md](CLAUDE.md).
