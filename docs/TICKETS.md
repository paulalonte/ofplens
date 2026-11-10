# OFP Lens — Tickets

Derived from [PLAN.md](PLAN.md). Work them in order, one ticket per branch/PR.
Each ticket ends with tests green and its "Done when" shown working.

> **Status (10 Nov 2026):** OFP-01 to OFP-23 are done: the MVP and Phase 4 (live weather) are
> complete. Next: deployment (3b), then the AI phases.

**MVP = Phases 0–3**: load my latest SimBrief OFP, see a clean briefing, and keep a
history in Postgres, running locally. Deploy (3b), live weather (4) and everything AI
come after the MVP is usable.

---

## Phase 0 — Project setup

### OFP-01 · Monorepo scaffold
- pnpm workspaces with `apps/web`, `apps/api`, `packages/ofp`, `packages/db` (empty but building).
- Shared `tsconfig.base.json` (strict), ESLint, Prettier, Vitest at the root.
- Root scripts: `lint`, `typecheck`, `test`, `format`.
- **Done when:** `pnpm lint && pnpm typecheck && pnpm test` pass on a clean clone.

### OFP-02 · Postgres + API skeleton with health check
- `docker-compose.yml` with Postgres 16 (named volume, healthcheck).
- `apps/api`: Fastify + `fastify-type-provider-zod`; env config validated with Zod (`DATABASE_URL`, `PORT`).
- `packages/db`: Drizzle client + `drizzle.config.ts` (no tables yet).
- Error plugin that returns `{ error: { code, message } }` for every failure.
- `GET /api/health` runs `select 1` and reports `{ status: "ok", db: "up" }`, or 503 when the DB is down.
- **Done when:** `docker compose up -d` + starting the API returns ok; stopping Postgres returns 503. Route test with Fastify `inject`.

### OFP-03 · Web skeleton + `pnpm dev`
- `apps/web`: Vite, React, Tailwind, TanStack Router and Query.
- Vite proxy `/api` → API, so the browser never needs CORS.
- Placeholder home page showing API health.
- Root `pnpm dev` starts web and API together.
- **Done when:** `pnpm dev` opens the web app and it shows "API ok, DB up".

### OFP-04 · CI, CLAUDE.md, Claude settings
- GitHub Actions: install, lint, typecheck, test on every PR.
- `CLAUDE.md`: commands, repo layout, conventions (numbers from code, Zod at every boundary, UTC times).
- `.claude/settings.json` allowing test, lint, typecheck and migrate commands.
- **Done when:** a PR shows a green CI run.

---

## Phase 1 — Briefing UI from a fixture OFP

### OFP-05 · Capture fixtures and confirm the field mapping
- Generate and save at least 3 real OFPs (JSON v2) in `fixtures/ofp/`: one in kgs, one in lbs, one **without an alternate**.
- Redact personal fields (pilot id, name) if the repo will ever be public.
- Go through the "OFP field mapping" table in PLAN.md and mark each path confirmed or corrected. Note the real types: in JSON v2, numbers are strings, times are ISO strings and durations are `HH:MM:SS`.
- **Done when:** fixtures are committed and the mapping table in PLAN.md is confirmed.

### OFP-06 · `packages/ofp`: Zod schema + `parseOfp()`
- Zod schema for only the fields we use, coercing numeric strings and epoch times.
- `parseOfp(raw) → FlightPlanSummary` (header, times, fuel, weights, waypoints, OFP weather). The raw OFP is not part of the summary; the import keeps it separately for `raw_ofp`.
- Clear error type when the input is not a valid OFP.
- **Done when:** unit tests pass for every fixture, including the one without an alternate, plus one malformed input.

### OFP-07 · Formatting helpers
- `formatWeight(value, fromUnit, toUnit)`, `formatDuration(seconds)`, `formatZulu(iso)` / `formatLocal(iso, utcOffsetMin)` (the airport's offset from the OFP, not a timezone name), plus `localDayOffset`, `formatZuluDate` and `formatUtcOffset`.
- Live in `packages/ofp` so web and API share them.
- **Done when:** unit tests cover kg↔lbs rounding, durations over 10 h, and UTC/local around midnight.

### OFP-08 · Briefing page, part 1: header, times, fuel, payload
- Page built from a fixture imported through `packages/ofp`.
- Header (callsign, origin → destination, aircraft, reg, AIRAC).
- Times card: out, off, on, in, block and air time; Zulu first, local second.
- Fuel card and payload card with a kg/lbs toggle (local state for now).
- "Simulation use only" label in the layout.
- **Done when:** the page renders each fixture correctly and the toggle converts every weight.

### OFP-09 · Briefing page, part 2: OFP weather + route table
- Weather card: raw METAR/TAF for origin, destination, alternate (hidden when there is no alternate).
- Route table: waypoint, altitude, ETA, fuel on board.
- **Done when:** the no-alternate fixture renders without errors, and a component test covers it.

---

## Phase 2 — Load the latest OFP from SimBrief

> PLAN.md stores the SimBrief username in `pilots` in phase 2, but Drizzle tables only
> arrive in phase 3. OFP-10 pulls the DB setup forward so phase 2 has somewhere to save it.

### OFP-10 · Drizzle migrations + `pilots` table + settings API
- Migration workflow (`pnpm db:generate`, `pnpm db:migrate`).
- `pilots` table as in PLAN.md (single row for now).
- `GET /api/pilot` and `PUT /api/pilot` (`simbriefUsername`, `weightUnit`) — upsert the single pilot.
- **Done when:** migrations run on a fresh DB and the username survives an API restart.

### OFP-11 · SimBrief client
- Fetch the latest OFP with `xml.fetcher.php?username=…&json=v2` (or `userid=`), as confirmed in OFP-05.
- 10 s timeout, one retry on network errors and 5xx (not after a timeout, which would double the wait). An unknown user returns HTTP 400 with `fetch.status` "Error: Unknown UserID".
- Map "user not found / no plan" to a typed `NotFound` error; other failures to `UpstreamError`.
- **Done when:** unit tests with a mocked HTTP layer cover success, unknown user, timeout and retry.

### OFP-12 · `GET /api/simbrief/latest`
- Uses the saved username (or `?username=`), runs `parseOfp`, returns the summary. No saving.
- Errors: 404 with a helpful message for unknown user, 502 for SimBrief failures, 422 if the OFP does not parse.
- **Done when:** route tests cover each status code.

### OFP-13 · Web: settings page + "Load latest plan"
- Settings page for the SimBrief username and kg/lbs preference (saved via `/api/pilot`).
- "Load latest plan" button (TanStack Query mutation) that renders the briefing page from the API result.
- Loading, empty ("set your username first") and error states.
- **Done when:** a plan freshly generated on SimBrief appears after one click, and a wrong username shows the helpful error.

---

## Phase 3 — Postgres history

### OFP-14 · Flight plan schema + integration test harness
- Drizzle schema and migration for `flight_plans`, `flight_plan_fuel`, `flight_plan_weights`, `waypoints`, `weather_reports` (OFP source only).
- Integration test setup against a real Postgres (Testcontainers, or a separate Compose test DB), migrated and reset per test file.
- Review against the fixtures: nullability, indexes, any field that needs `numeric`.
- **Done when:** migrations apply cleanly and a smoke integration test runs in CI.

### OFP-15 · Import service + `POST /api/flight-plans/import`
- Fetch latest → `parseOfp` → insert plan and all child rows in one transaction, `raw_ofp` stored.
- Idempotent on `simbrief_request_id`: if it already exists, skip child inserts and return the existing plan (`200` vs `201`).
- **Done when:** integration tests show that importing the same OFP twice leaves one row of each, and a failure partway leaves nothing behind.

### OFP-16 · Read and delete endpoints
- `GET /api/flight-plans?cursor=&limit=` newest first; cursor on `(generated_at, id)`.
- `GET /api/flight-plans/:id` returns the same `FlightPlanSummary` shape the UI already renders.
- `DELETE /api/flight-plans/:id` (children cascade).
- **Done when:** integration tests cover pagination across pages, 404 on unknown id, and a round-trip check that `parseOfp(fixture)` equals the summary read back from the DB.

### OFP-17 · Web: history and detail pages
- "Load latest plan" now imports and navigates to the stored plan.
- History page: date, route, aircraft, block time, infinite scroll or "load more".
- Detail page from the DB reusing the phase 1 components; delete with confirmation.
- **Done when:** history survives restarts and the detail page matches the phase 1 output.

### OFP-18 · E2E smoke test — MVP checkpoint
- Playwright: set username → import (SimBrief mocked at the API) → history → detail → delete.
- Runs in CI.
- **Done when:** green in CI. 🎉 MVP done.

---

## Phase 4 — Live weather

Goal (PLAN.md): origin, destination and alternate show the OFP's weather and the current
weather side by side, with a flight category badge and a "changed since dispatch" flag;
repeated refreshes hit the cache.

> Checked against the aviationweather.gov Data API on 10 Nov 2026 (see PLAN.md, "Weather
> source"): `GET /api/data/metar|taf?ids=A,B,C&format=json` takes several stations per call;
> 100 requests/minute; a custom User-Agent is expected; an unknown station is HTTP 204 with an
> empty body; responses are `cache-control: max-age=60`; most METARs update about hourly.
> The OFP's METAR is plain text, so dispatch and live weather are compared by decoding both
> with our own code, not by trusting one side's labels.

### OFP-19 · `packages/weather`: aviationweather.gov client
- Fetch METARs and TAFs for several stations in one request each (`ids=EDDB,EDDM,EDDF`).
- Identify ourselves with a User-Agent (no personal data); 10 s timeout, one retry on network
  errors and 5xx, like the SimBrief client; HTTP 204 means "no report", not an error.
- Zod schemas for the fields we use, tolerant of the API's quirks (`wdir` can be `"VRB"`,
  `visib` can be `"10+"`, `fltCat` can be missing); results keyed by ICAO, since the API does
  not keep the request order.
- Capture real responses into `fixtures/weather/` for tests.
- **Done when:** unit tests with a faked HTTP layer cover success, several stations, 204,
  timeout, retry and a malformed body.

### OFP-20 · Decode METARs and work out the flight category
- One decoder for **both** the OFP's METAR text and live METARs: observation time (`091320Z`
  → a full UTC time, using the plan or fetch date for month and year), wind, visibility
  (`9999`, `5000`, `3/4SM`, `P6SM`, `CAVOK`), ceiling (lowest BKN/OVC/VV), and the flight
  category (VFR / MVFR / IFR / LIFR, FAA thresholds).
- Pure functions in `packages/weather`, no network.
- **Done when:** tests cover each visibility and ceiling form, and the category we compute
  matches aviationweather.gov's `fltCat` for every METAR in the captured fixtures.

### OFP-21 · Store live weather + refresh and read endpoints
- `POST /api/flight-plans/:id/weather/refresh`: fetch live METAR and TAF for origin,
  destination and alternate, store them as `weather_reports` rows with `source = 'live'`,
  observation time, flight category and decoded fields; a report already stored (same station,
  kind and observation time) is not stored again.
- Cache per station for 5 minutes, so repeated refreshes (or several plans with the same
  airports) do not call aviationweather.gov again.
- `GET /api/flight-plans/:id/weather`: per airport, the OFP report and the latest live one,
  each with its decoded category and time, plus `changedSinceDispatch` (a newer observation
  with a different category, or a TAF issued after dispatch).
- If aviationweather.gov is down, the refresh returns 502 and the stored reports still show.
- **Done when:** integration tests on Postgres cover storing, not duplicating, the cache (one
  upstream call for two refreshes), a plan without an alternate, and the "changed" rules.

### OFP-22 · Web: OFP vs live weather on the plan page
- The weather card shows, per airport, **at dispatch** and **now** side by side, each with a
  flight category badge (VFR green, MVFR blue, IFR red, LIFR magenta, labelled in text too),
  the observation time, and a "changed since dispatch" flag.
- Live weather loads with the page (route loader), is refreshed automatically when it is more
  than 10 minutes old, and has a "Refresh" button; when live weather is unavailable, the OFP
  side still shows with a short note.
- **Done when:** page tests cover both sides, the flag, refresh, and the unavailable state;
  checked in the browser against real aviationweather.gov.

### OFP-23 · End-to-end: live weather
- A fake aviationweather.gov in the e2e stack (like the fake SimBrief), serving METARs that
  differ from the OFP's.
- Journey: load a plan, see OFP and live weather side by side with the right badges and the
  "changed since dispatch" flag, refresh.
- **Done when:** green locally and in CI. 🎉 Phase 4 done.

---

## Later phases (not ticketed yet)

| Next | Summary |
| --- | --- |
| 3b Deploy | Budget alarm first; then CDK (RDS, Fargate, S3 + CloudFront) or the cheaper Lightsail + Compose fallback |
| 5–7 AI | Briefing agent, route hazards, evals and tracing |
| 8 MCP | Same tools exposed to Claude Desktop / Claude Code |
| Sharing | Auth and multi-pilot support before anyone else uses it |
