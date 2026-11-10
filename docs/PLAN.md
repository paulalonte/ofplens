# OFP Lens — Project Proposal

Nov 9, 2026 · @Paul

## Overview and goals

OFP Lens is a web app that imports my latest SimBrief OFP, shows a clean pilot briefing (times, fuel, payload, weather, route), keeps a history of every flight plan in Postgres, and later adds an AI agent that writes a short weather and hazard briefing using live data.

The core design rule: **numbers come from code, judgement comes from the agent.** Fuel, times and weights are parsed deterministically and never rewritten by an LLM. The agent only interprets weather and hazards, and every claim it makes must point back to data it fetched.

**Learning goals**

- Backend: external API ingestion, typed parsing, relational data modeling, migrations, idempotent imports, background jobs, caching.
- Agentic AI: tool use, structured outputs, streaming UI, guardrails against hallucinated numbers, evals, tracing.
- MCP: expose the same tools as an MCP server usable from Claude Desktop or Claude Code.
- Product: ship small vertical slices, each usable on its own.

**Non-goals (for now)**

- Multi-user SaaS, payments, or public sign-up. Single user first; auth comes later if it is ever shared.
- Generating SimBrief plans. The app only reads plans I generate on SimBrief.
- Real-world use. This is for flight simulation only and must say so in the UI.

## Tech stack and repo structure

A TypeScript monorepo, so the OFP types and parser are shared between frontend, API, agent and MCP server.

| Area | Choice | Why |
| --- | --- | --- |
| Monorepo | pnpm workspaces | Simple, shared packages without extra tooling |
| Frontend | React, Vite, TanStack Router, TanStack Query, Tailwind | Familiar stack, focus effort on the backend |
| API | Node + Fastify | Mature, plugin-based, schema validation built in |
| Validation | Zod | One schema for parsing OFP, API input and agent output |
| Database | Postgres 16 in Docker Compose | Local first, deploy later |
| ORM and migrations | Drizzle ORM + drizzle-kit | SQL-like, explicit migrations you can read |
| Testing | Vitest (unit), Playwright (e2e) | Same tools as at work |
| AI (phase 5+) | Anthropic SDK, tool use, structured output | Agent layer |
| Tracing and evals (phase 7) | Langfuse or a small custom harness | See what the agent did and measure it |
| MCP (phase 8) | MCP TypeScript SDK | Expose tools to Claude Desktop and Claude Code |

```
ofplens/
├── apps/
│   ├── web/            # React app
│   ├── api/            # HTTP API (Fastify)
│   └── mcp/            # MCP server (phase 8)
├── packages/
│   ├── ofp/            # Zod schema, parseOfp(), domain types
│   ├── db/             # Drizzle schema, migrations, repositories
│   ├── weather/        # aviationweather.gov client (phase 4)
│   └── agent/          # tools, prompts, briefing schema (phase 5)
├── fixtures/ofp/       # real OFP JSON samples for tests and evals
├── docker-compose.yml  # Postgres
├── CLAUDE.md
└── docs/PLAN.md        # this proposal
```

**Deployment:** AWS in eu-central-1 from phase 3b, defined with AWS CDK (TypeScript). Locally everything runs in Docker Compose.

## Architecture

The API is the only component that talks to SimBrief, the weather source and the LLM. Inside it, a deterministic layer owns every number, and an agentic layer only interprets weather and hazards.

```
Web app (React)  --REST/SSE-->  API (Node + Fastify)
                                  ├─ Deterministic layer: parseOfp, import, history (fuel, times, weights)
                                  └─ Agentic layer: agent loop + tools -> validated Briefing JSON
API --> SimBrief API (latest OFP, JSON v2)
API --> aviationweather.gov (METAR, TAF, SIGMET)
API --> Claude API (tool use, structured output)
API --> Postgres (via Drizzle): plans, weather, briefings
MCP server (phase 8) --> reuses the same tool functions
```

The agentic layer reads the same database as the deterministic layer but never writes plan data; it only writes `briefings`.

**Main flows**

1. **Import:** web → API → SimBrief → `parseOfp` → Postgres, in one transaction.
2. **View:** web → API → Postgres; fuel, times and weights are rendered straight from the DB.
3. **Weather refresh:** API → aviationweather.gov → `weather_reports` (cached per station).
4. **Briefing:** API runs the agent loop; the agent calls tools (DB, weather) and the LLM, the result is validated, stored in `briefings`, and streamed to the web app.
5. **MCP:** Claude Desktop or Claude Code → MCP server → the same tool functions.

## Phased roadmap

Nine phases plus a deploy step (3b), each a usable vertical slice that ends with tests green and its acceptance criteria shown working. Phases 0–3 are pure frontend and backend work; AI starts only in phase 5, once the data is solid.

```
Foundation:   0 Setup · 1 Fixture briefing UI · 2 Load latest OFP · 3 Postgres + history · 3b Deploy to AWS
Live data:    4 Live weather
   ── Gate: import and history solid, then start AI ──
Agent:        5 AI briefing · 6 Route hazards · 7 Evals + tracing
Distribution: 8 MCP server · Stretch: X-Plane live tracking
```

### Phase 0 — Project setup

- pnpm monorepo, TypeScript, ESLint, Prettier, Vitest; Postgres via `docker-compose.yml`.
- `CLAUDE.md` with commands and conventions; `.claude/settings.json` allowing test, lint and migrate commands.
- CI (GitHub Actions) running lint, typecheck and tests.
- **Done when:** `pnpm dev` starts web and API, `GET /api/health` returns ok with DB connected, CI is green.

### Phase 1 — Frontend from a fixture OFP

- Save one real OFP (JSON v2) to `fixtures/ofp/`.
- `packages/ofp`: Zod schema for the fields we use, `parseOfp(raw) → FlightPlanSummary`, unit tests against the fixture.
- Briefing page built from the fixture: header (callsign, route, aircraft), times card (out, off, on, in, block and air time in UTC and local), fuel card, payload card (with a kg/lbs toggle), OFP weather card (raw METAR/TAF), route table (waypoint, altitude, ETA, fuel on board).
- **Done when:** the page renders the fixture correctly, parser tests pass, a plan without an alternate still renders.

### Phase 2 — Load the latest OFP from SimBrief

- Settings screen for the SimBrief username (stored in `pilots`).
- `GET /api/simbrief/latest`: fetch, validate with `parseOfp`, return the summary. Timeout, retry and clear error mapping.
- Frontend "Load latest plan" button using a TanStack Query mutation; loading and error states.
- **Done when:** a plan freshly generated on SimBrief appears after one click, and a wrong username shows a helpful error.

### Phase 3 — Save to Postgres and flight history

- Drizzle schema and migrations for `flight_plans`, fuel, weights, waypoints, OFP weather.
- `POST /api/flight-plans/import`: one transaction, idempotent on `simbrief_request_id`, `raw_ofp` stored.
- History page (date, route, aircraft, block time) with cursor pagination; detail page loaded from the DB; delete.
- Integration tests against a real Postgres (Compose or Testcontainers).
- **Done when:** importing the same OFP twice gives one row, history survives restarts, detail page matches the phase 1 output.

### Phase 3b — Deploy to AWS

- Infrastructure as code with AWS CDK (TypeScript), so the setup is reproducible and teardown is one command.
- Postgres on RDS (smallest instance); API as a container on ECS Fargate behind a load balancer; web app built to S3 + CloudFront.
- Secrets in SSM Parameter Store or Secrets Manager; migrations run as a one-off task on each deploy.
- GitHub Actions deploys on merge to main; logs in CloudWatch.
- Set an AWS Budgets alarm first: RDS and a load balancer cost money even when idle. Cheaper fallback: one small EC2 or Lightsail instance running the same Docker Compose setup.
- **Done when:** the app is on a public URL, a deploy is one merge, and the budget alarm is active.

### Phase 4 — Live weather

- `packages/weather`: aviationweather.gov client for METAR and TAF, with caching.
- Refresh endpoint stores `live` snapshots next to the `ofp` ones; flight category badge (VFR to LIFR).
- UI shows planned vs live weather per airport and flags "changed since dispatch".
- **Done when:** origin, destination and alternate show OFP and live reports side by side, and repeated refreshes hit the cache.

### Phase 5 — AI briefing (first agent)

- `packages/agent`: tools `get_flight_plan`, `get_weather`, `get_planned_weather`; structured `Briefing` output.
- `POST /briefings` runs the agent, streams progress to the UI (SSE), stores the result, tokens, latency and tool calls.
- Briefing card at the top of the plan page; numbers in it come from the DB, not the model.
- **Done when:** a stored plan gets a validated briefing, failures are stored as `failed`, and no fuel or time figures appear in model output.

### Phase 6 — Hazards along the route

- Fetch SIGMETs (convective, turbulence, icing) and intersect their polygons with route segments (for example with Turf.js).
- Store matches in `advisories` with the affected waypoint range; add the `get_route_hazards` tool.
- Optional: route map (MapLibre) with hazard polygons.
- **Done when:** a test fixture with a known SIGMET maps to the correct waypoints, and the briefing names them.

### Phase 7 — Evals and tracing

- 10–20 fixture OFPs with frozen weather and advisories, so runs are reproducible.
- Checks: every intersecting hazard mentioned; no hazard without an advisory id; waypoint names exist; schema valid; runtime and cost under budget.
- Tracing (Langfuse or similar) for each run; compare prompt versions.
- **Done when:** `pnpm eval` prints a pass rate per check and per prompt version.

### Phase 8 — MCP server

- `apps/mcp` exposing the same tools plus `list_flight_plans` and `import_latest_plan`.
- **Done when:** asking Claude Desktop "brief me on my latest flight" works end to end.

### Stretch — Live flight with X-Plane 12

- Read position, fuel and altitude from X-Plane's local web API; compare actual against plan during the flight (websockets, background jobs).

## Data model

One `flight_plans` row per imported OFP, with fuel, weights, waypoints, weather and AI briefings hanging off it. The full OFP is also kept as `raw_ofp` (JSONB), so the parser can be improved later and old plans re-parsed without re-fetching.

**Relations:** `pilots` 1–n `flight_plans`; each flight plan has 1–1 `flight_plan_fuel` and `flight_plan_weights`, and 1–n `waypoints`, `weather_reports`, `advisories` and `briefings`.

| Table | Purpose | Phase |
| --- | --- | --- |
| pilots | SimBrief username and kg/lbs display preference | 2 |
| flight\_plans | One row per OFP: route, airports, times, distance, raw JSON | 3 |
| flight\_plan\_fuel | Planned fuel breakdown | 3 |
| flight\_plan\_weights | Pax, cargo, payload, ZFW, TOW, LDW | 3 |
| waypoints | Navlog fixes in order, with position, altitude, wind, fuel | 3 |
| weather\_reports | METAR and TAF snapshots, from the OFP and fetched live | 3 (OFP), 4 (live) |
| advisories | SIGMETs and similar hazards touching the route | 6 |
| briefings | AI briefing output, model, prompt version, cost | 5 |

```sql
CREATE TABLE pilots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simbrief_username  text NOT NULL UNIQUE,
  simbrief_pilot_id  text,
  weight_unit        text NOT NULL DEFAULT 'kgs' CHECK (weight_unit IN ('kgs','lbs')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE flight_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id              uuid NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  simbrief_request_id   text NOT NULL UNIQUE,   -- idempotent import key
  generated_at          timestamptz NOT NULL,   -- when SimBrief generated the OFP
  airac                 text,
  units                 text NOT NULL CHECK (units IN ('kgs','lbs')),
  airline_icao          text,
  flight_number         text,
  callsign              text,
  aircraft_icao         text NOT NULL,
  aircraft_reg          text,
  origin_icao           char(4) NOT NULL,
  origin_runway         text,
  destination_icao      char(4) NOT NULL,
  destination_runway    text,
  alternate_icao        char(4),
  route                 text NOT NULL,
  cruise_altitude_ft    integer,
  cost_index            integer,
  route_distance_nm     integer,
  sched_out             timestamptz,  -- off block
  sched_off             timestamptz,  -- takeoff
  sched_on              timestamptz,  -- landing
  sched_in              timestamptz,  -- on block
  block_time_s          integer,
  air_time_s            integer,
  raw_ofp               jsonb NOT NULL,
  imported_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX flight_plans_pilot_generated_idx ON flight_plans (pilot_id, generated_at DESC);
CREATE INDEX flight_plans_route_idx ON flight_plans (origin_icao, destination_icao);

CREATE TABLE flight_plan_fuel (
  flight_plan_id  uuid PRIMARY KEY REFERENCES flight_plans(id) ON DELETE CASCADE,
  ramp            integer NOT NULL,
  taxi            integer,
  trip            integer NOT NULL,
  contingency     integer,
  alternate       integer,
  final_reserve   integer,
  extra           integer,
  landing         integer            -- planned fuel at landing
);

CREATE TABLE flight_plan_weights (
  flight_plan_id  uuid PRIMARY KEY REFERENCES flight_plans(id) ON DELETE CASCADE,
  pax_count       integer,
  cargo           integer,
  payload         integer,
  zfw             integer,
  tow             integer,
  ldw             integer
);

CREATE TABLE waypoints (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  flight_plan_id        uuid NOT NULL REFERENCES flight_plans(id) ON DELETE CASCADE,
  seq                   integer NOT NULL,
  ident                 text NOT NULL,
  name                  text,
  type                  text,           -- wpt, vor, apt, toc, tod...
  stage                 text,           -- CLB, CRZ, DSC
  lat                   double precision NOT NULL,
  lon                   double precision NOT NULL,
  altitude_ft           integer,
  wind_dir_deg          integer,
  wind_speed_kt         integer,
  oat_c                 integer,
  elapsed_s             integer,        -- cumulative time from takeoff
  fuel_on_board         integer,
  UNIQUE (flight_plan_id, seq)
);

CREATE TABLE weather_reports (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  flight_plan_id  uuid NOT NULL REFERENCES flight_plans(id) ON DELETE CASCADE,
  station_icao    char(4) NOT NULL,
  role            text NOT NULL CHECK (role IN ('origin','destination','alternate','enroute')),
  kind            text NOT NULL CHECK (kind IN ('metar','taf')),
  source          text NOT NULL CHECK (source IN ('ofp','live')),
  raw_text        text NOT NULL,
  flight_category text,                 -- VFR, MVFR, IFR, LIFR
  parsed          jsonb,                -- wind, visibility, ceiling, wx
  observed_at     timestamptz,
  fetched_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX weather_reports_plan_idx ON weather_reports (flight_plan_id, station_icao, fetched_at DESC);

-- Phase 6
CREATE TABLE advisories (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  flight_plan_id      uuid NOT NULL REFERENCES flight_plans(id) ON DELETE CASCADE,
  source              text NOT NULL,    -- sigmet, airmet, gairmet
  hazard              text NOT NULL,    -- CONVECTIVE, TURB, ICE, ...
  severity            text,
  valid_from          timestamptz,
  valid_to            timestamptz,
  geometry            jsonb NOT NULL,   -- GeoJSON polygon
  first_waypoint_seq  integer,          -- affected route segment
  last_waypoint_seq   integer,
  raw_text            text,
  fetched_at          timestamptz NOT NULL DEFAULT now()
);

-- Phase 5
CREATE TABLE briefings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_plan_id  uuid NOT NULL REFERENCES flight_plans(id) ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('pending','done','failed')),
  model           text NOT NULL,
  prompt_version  text NOT NULL,
  output          jsonb,                -- validated Briefing schema
  tool_calls      jsonb,                -- trace of tools used
  input_tokens    integer,
  output_tokens   integer,
  latency_ms      integer,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX briefings_plan_idx ON briefings (flight_plan_id, created_at DESC);
```

**Design notes**

- Weights and fuel are stored as integers in the OFP's own unit, with `units` on the flight plan. Convert only for display, following the pilot's kg/lbs toggle (pilots.weight\_unit), through one shared, unit-tested formatWeight() helper.
- All times are `timestamptz` in UTC. The UI shows UTC (Zulu) first, local second.
- Import is idempotent: `INSERT … ON CONFLICT (simbrief_request_id) DO NOTHING`, all child rows in one transaction.
- Lat/lon as plain doubles is enough until phase 6. If route-geometry queries get heavy, consider PostGIS then, not before.

**OFP field mapping (checked against real OFPs in OFP-05)**

Checked against `fixtures/ofp/*.json`, fetched with `xml.fetcher.php?userid=…&json=v2`.
✅ = path as expected, ⚠️ = corrected.

**Formats in JSON v2.** These differ from `json=1`, so always request `json=v2`.

- Every number is a **string** (`"2432"`, `"52.362247"`). Coerce in the Zod schema.
- Timestamps are **ISO 8601 UTC strings** (`"2026-11-09T14:00:00Z"`). `json=1` sends Unix seconds instead.
- Durations are **`"HH:MM:SS"` strings** (`"01:07:31"`). `json=1` sends seconds instead.
- Empty values are `""`, and lists are always arrays. `json=1` sends `{}` for empty values and a bare object when a list has one item.
- `navlog` is a **flat array**, not `navlog.fix[]`.
- `alternate` is an **array**, because SimBrief allows several alternates.

| Column | OFP path (JSON v2) | |
| --- | --- | --- |
| simbrief\_request\_id, airac, units | params.request\_id, params.airac, params.units (`"kgs"` / `"lbs"`) | ✅ |
| generated\_at | params.time\_generated (ISO string) | ✅ |
| flight\_number, airline\_icao, route | general.flight\_number, general.icao\_airline, general.route | ✅ |
| callsign | atc.callsign | ⚠️ was unmapped |
| cruise\_altitude\_ft, cost\_index | general.initial\_altitude, general.costindex | ✅ |
| route\_distance\_nm | general.route\_distance | ⚠️ was unmapped |
| origin / destination | origin.icao\_code, destination.icao\_code (+ plan\_rwy) | ✅ |
| alternate | **alternate\[0\]**.icao\_code (+ plan\_rwy). With no alternate, `alternate` and `alternate_navlog` are `[]` and `fuel.alternate_burn` is `"0"` | ⚠️ |
| aircraft\_icao, aircraft\_reg | aircraft.icaocode (also icao\_code), aircraft.reg | ✅ |
| sched\_out / off / on / in | times.est\_out, est\_off, est\_on, est\_in (ISO strings) | ✅ see note |
| block\_time\_s, air\_time\_s | times.est\_block, times.est\_time\_enroute (`"HH:MM:SS"`, convert to seconds) | ⚠️ format |
| local time offsets | times.orig\_timezone, times.dest\_timezone (`"+01:00:00"`) | ⚠️ was unmapped |
| fuel | fuel.plan\_ramp, taxi, enroute\_burn, contingency, alternate\_burn, reserve, extra, plan\_landing | ✅ |
| weights | weights.pax\_count, cargo, payload, est\_zfw, est\_tow, est\_ldw | ✅ |
| waypoints | **navlog\[\]**: ident, name, type, stage, pos\_lat, pos\_long, altitude\_feet, wind\_dir, wind\_spd, oat, time\_total (`"HH:MM:SS"`), fuel\_plan\_onboard | ⚠️ path, format |
| weather (OFP) | origin.metar / taf, destination.metar / taf, alternate\[0\].metar / taf | ⚠️ alternate |

**Notes from the real data**

- `times` also has `sched_out/off/on/in`: the schedule entered in SimBrief, which can differ from the computed `est_*` (for example `sched_in` 15:20Z vs `est_in` 15:07Z). The columns take `est_*`. Consider renaming them `est_*` in OFP-14 so the name matches the source.
- Use the OFP's own timezone offsets for "local" times. The pilot's browser timezone may not match the airports'.
- The navlog does not start at the origin airport. The first fix is the first SID waypoint, and the last is the destination (`type: "apt"`). Fix types seen so far: `apt`, `ltlg`, `ndb`, `vor`, `wpt`. Top of climb and top of descent are not their own type. They are `type: "ltlg"` (a lat/long point) with `ident` `TOC` / `TOD`, and TOD carries `stage: "CRZ"`.
- Personal data: the pilot ID appears in `params.user_id`, `crew.pilot_id`, `fetch.userid`, `api_params.pid` and `offset_length`. `pnpm fixture:capture` replaces it with `0000000` before saving.

## API design

A small REST API under `/api`. The browser never calls SimBrief, aviationweather.gov or the LLM directly: the API proxies them, which avoids CORS, keeps keys server-side, and gives one place for caching, timeouts and logging.

| Method | Path | Does | Phase |
| --- | --- | --- | --- |
| GET | /api/health | Liveness, DB connectivity | 0 |
| GET | /api/simbrief/latest?username= | Fetch latest OFP from SimBrief, parse, return summary (no save) | 2 |
| POST | /api/flight-plans/import | Fetch latest OFP and save it; returns existing plan if `request_id` already imported | 3 |
| GET | /api/flight-plans?cursor=&limit= | History list, newest first, cursor pagination | 3 |
| GET | /api/flight-plans/:id | Full plan: summary, fuel, weights, waypoints, latest weather | 3 |
| DELETE | /api/flight-plans/:id | Remove a plan and its children | 3 |
| POST | /api/flight-plans/:id/weather/refresh | Fetch live METAR/TAF for origin, destination, alternate | 4 |
| GET | /api/flight-plans/:id/weather | Weather snapshots, OFP vs live | 4 |
| POST | /api/flight-plans/:id/briefings | Start an AI briefing; streams progress (SSE) | 5 |
| GET | /api/flight-plans/:id/briefings/latest | Latest stored briefing | 5 |
| GET | /api/flight-plans/:id/advisories | Hazards touching the route | 6 |

**Conventions**

- Request and response bodies validated with Zod; shared types exported from `packages/ofp` and `packages/agent`.
- Errors as `{ error: { code, message } }` with proper status codes; SimBrief's "user not found / no plan yet" maps to 404 with a clear message.
- Outbound calls get a timeout (about 10 s) and one retry on network errors. SimBrief's docs do not ask for a client identifier. Fetch by `userid` (Pilot ID, stable) or `username`. An unknown user returns HTTP 400 with `{"fetch":{"status":"Error: Unknown UserID"}}`.
- Live weather is cached per station for a few minutes to avoid hammering the source.

## Agent design

The agent writes the weather and hazard briefing by calling tools, then returns a validated JSON object. It never produces fuel, time or weight numbers; the UI renders those from the database.

**Model:** Claude Haiku 5.5 by default for briefings (fast and cheap, enough for structured summaries), with Claude Sonnet 5.5 as the comparison in phase 7 evals. The model id lives in config (`BRIEFING_MODEL`), never hard-coded.

**Tools**

| Tool | Input | Returns | Phase |
| --- | --- | --- | --- |
| get\_flight\_plan | flightPlanId | Trimmed plan: airports, times, route, cruise level, waypoint list with seq and ETA | 5 |
| get\_weather | icao, kind (metar or taf) | Latest live report + flight category + observed time | 5 |
| get\_planned\_weather | flightPlanId, icao | METAR/TAF as stored in the OFP at dispatch | 5 |
| get\_route\_hazards | flightPlanId | Advisories intersecting the route, with affected waypoint range and validity | 6 |
| get\_winds\_aloft | flightPlanId | Planned winds and temperatures per waypoint | later |

Tools read from the database and the weather package. Each tool result is stored in `briefings.tool_calls`, so every briefing can be traced and replayed in evals.

**Briefing output schema (Zod)**

```ts
const Conditions = z.object({
  icao: z.string().length(4),
  flightCategory: z.enum(['VFR', 'MVFR', 'IFR', 'LIFR']).nullable(),
  summary: z.string().max(200),           // e.g. "Wind 240/18G28, BKN012, light rain"
  changedSinceDispatch: z.boolean(),
  sourceReport: z.string(),               // raw METAR/TAF it is based on
});

export const Briefing = z.object({
  headline: z.string().max(140),
  overallRisk: z.enum(['low', 'moderate', 'high']),
  departure: Conditions,
  destination: Conditions,
  alternate: Conditions.nullable(),
  enrouteHazards: z.array(z.object({
    type: z.enum(['thunderstorm', 'turbulence', 'icing', 'volcanic_ash', 'other']),
    fromWaypoint: z.string(),
    toWaypoint: z.string(),
    validUntil: z.string().datetime().nullable(),
    severity: z.enum(['light', 'moderate', 'severe']).nullable(),
    advisoryId: z.string(),               // must reference a tool result
  })),
  pilotNotes: z.array(z.string().max(160)).max(5),
});
```

**Guardrails**

- Structured output only; the API validates with `Briefing.parse()` and stores `failed` with the error if it does not parse.
- Every hazard must cite an `advisoryId` and every conditions block a `sourceReport` from a tool result. A post-check rejects anything that cannot be matched.
- Waypoint names in hazards must exist in the plan's waypoint list.
- Version the system prompt (`prompt_version`) so evals can compare versions.
- Log tokens, latency and cost per briefing; set a max tool-call count (for example 8) per run.
- Show a "simulation use only" label on every briefing.

## Open questions and notes for review

**Decisions**

| Question | Decision |
| --- | --- |
| Auth | None until the app is shared. Single pilot row; SimBrief username set in settings. |
| API framework | Fastify, with Zod via a type provider (e.g. `fastify-type-provider-zod`). |
| Deployment | AWS, after phase 3 (see phase 3b). Firebase skipped: it is built around Firestore and serverless functions, not a Postgres + Node API. |
| Weight units | Stored in the OFP's unit; UI toggle switches kg and lbs; preference saved on the pilot. |
| LLM for briefings | Claude via the Anthropic API; model id in config so evals can compare models. |

**Still open**

- [ ] Monthly cost cap for LLM calls and AWS.
- [ ] Region for AWS (eu-central-1, Frankfurt, is the obvious default from Berlin).

**Notes for reviewers (and Claude Code)**

- Verify the OFP field mapping against `fixtures/ofp/*.json` before writing the Zod schema; paths in this doc are expected, not confirmed.
- Check the SimBrief fetch endpoint and `json=v2` format against the [SimBrief developer docs](https://developers.navigraph.com/docs/simbrief/fetching-ofp-data).
- ~~Check the aviationweather.gov Data API endpoints, formats and rate limits before phase 4.~~ Done; see "Weather source" below.
- Review the schema for missing indexes, nullability that does not match real OFPs, and anything that should be `numeric` instead of `integer`.
- Challenge scope: anything in a phase that does not serve that phase's acceptance criteria should move later.
- Work one phase per branch/PR; each phase ends with tests green and the acceptance criteria demonstrated.

## Weather source (checked 10 Nov 2026)

[aviationweather.gov Data API](https://aviationweather.gov/data/api/), free, no key.

| | |
| --- | --- |
| METAR | `GET https://aviationweather.gov/api/data/metar?ids=LSZH,EDDB,EDDP&format=json` |
| TAF | `GET https://aviationweather.gov/api/data/taf?ids=LSZH,EDDB,EDDP&format=json` |
| Limits | 100 requests per minute; max 400 entries per query; data covers the last 30 days |
| Etiquette | Set a custom User-Agent; keep requests small; 429 when limits apply; no CORS (our API proxies anyway) |
| Unknown station | HTTP 204, empty body |
| Caching | `cache-control: max-age=60`; most METARs update about hourly |

METAR JSON fields we use: `icaoId`, `obsTime` (Unix seconds), `reportTime` (ISO), `rawOb`
(starts with `METAR `), `fltCat` (`VFR`/`MVFR`/`IFR`/`LIFR`, may be missing), `wdir` (number or
`"VRB"`), `wspd`, `wgst`, `visib` (statute miles, number or a string like `"10+"`), `clouds`
(`[{ cover, base }]`, base in feet), `temp`, `dewp`, `altim` (hPa). TAF JSON: `icaoId`,
`issueTime` (ISO), `validTimeFrom` / `validTimeTo` (Unix seconds), `rawTAF` (starts with
`TAF `), `fcsts[]`. Results are not in request order: match them by `icaoId`.

The OFP's own METAR/TAF are plain text without these fields, so OFP Lens decodes METARs itself
(OFP-20) to compare dispatch and live weather on equal terms.
