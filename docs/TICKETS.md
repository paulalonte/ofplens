# OFP Lens — Tickets

Derived from [PLAN.md](PLAN.md). Work them in order, one ticket per branch/PR.
Each ticket ends with tests green and its "Done when" shown working.

> **Status (11 Nov 2026):** OFP-01 to OFP-33 are done: the MVP, Phase 4 (live weather),
> **Phase 5 — AI briefing** (OFP-24 to OFP-28) and **Phase 6 — hazards along the route**
> (OFP-29 to OFP-33, route map included) are complete. Deployment (3b) follows.

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

## Phase 5 — AI briefing

Goal (PLAN.md): a stored plan gets a short weather briefing written by Claude, validated
against a schema, stored with its cost and trace; failures are stored as `failed`; no fuel,
time or weight figures come from the model.

**Ground rules for every Phase 5 ticket**

- **Numbers come from code, judgement from the agent.** The model reads decoded data through
  tools and writes words; fuel, times and weights on screen still come from the database.
- **Every claim is traceable.** Each report the tools return has an id; the briefing must cite
  those ids, and a post-check rejects anything it cannot match.
- **No real Claude in tests or CI.** A fake Claude answers with scripted responses; real calls
  happen only when the pilot presses the button, or in a manual script.
- **Tools are plain functions** in `packages/agent` (inputs, a database connection, output), with
  no dependency on Fastify or the agent loop, so the Phase 8 MCP server can reuse them as-is.
- Model, effort and limits come from config (`BRIEFING_MODEL`, default `claude-haiku-5-5`);
  the system prompt is versioned (`prompt_version`) so Phase 7 can compare versions.

### OFP-24 · `packages/agent`: tools and the `Briefing` schema
- Tools as typed functions with Zod input/output schemas:
  - `get_flight_plan(flightPlanId)`: airports (role, ICAO, name), planned times, route, cruise
    level, and the waypoint list (seq, ident, ETA), trimmed so the model sees what it needs.
  - `get_planned_weather(flightPlanId)`: the OFP's METAR/TAF per airport, decoded (category,
    ceiling, visibility, observation time).
  - `get_weather(flightPlanId)`: the latest live METAR/TAF per airport, refreshed through the
    existing cached client, decoded the same way, with `changedSinceDispatch`.
- Every report a tool returns carries a stable `reportId` (e.g. `metar:EDDB:2026-11-10T08:50Z`).
- The `Briefing` output schema from PLAN.md, with `sourceReportId` instead of free text, and
  `enrouteHazards` allowed but empty until Phase 6.
- **Done when:** unit tests run every tool against the captured fixtures (no LLM), and the
  schema accepts a hand-written valid briefing and rejects the usual mistakes.

### OFP-25 · The briefing agent loop, with guardrails
- `runBriefing(flightPlanId)` with the Anthropic TypeScript SDK (`@anthropic-ai/sdk`, 1.x): tool
  use for the three tools, at most 8 tool calls, the final answer as structured output
  validated by `Briefing`.
- Guardrails after the model answers, any failure making the run `failed`:
  - every conditions block cites a `reportId` that a tool actually returned, for that airport;
  - flight categories in the briefing match the decoded ones (no "VFR" for an IFR report);
  - waypoint names exist in the plan; hazards cite an advisory (none until Phase 6);
  - no fuel, weight or duration figures in the text (kg, lb, block time, "1:08").
- Handles refusals, `max_tokens`, API errors and timeouts as `failed` with the reason.
- Records model, prompt version, input/output tokens, latency, cost (from a price table in
  config) and the tool calls with their results.
- **Done when:** tests with a scripted fake Claude cover a valid run, each guardrail rejecting a
  bad answer, the tool-call limit, a refusal and an API error.

### OFP-26 · Store briefings + API with streamed progress
- Migration: the `briefings` table from PLAN.md (status, model, prompt_version, output,
  tool_calls, tokens, latency, cost, error).
- `POST /api/flight-plans/:id/briefings` runs the agent and streams progress as Server-Sent
  Events (`started`, `tool` with the tool's name, `done` with the briefing, or `failed`).
- `GET /api/flight-plans/:id/briefings/latest`.
- Budget protection: one running briefing per plan, and a daily limit (`BRIEFING_DAILY_LIMIT`)
  answered with 429 and a clear message.
- **Done when:** integration tests on Postgres with the fake Claude cover a stored success, a
  stored failure, the event stream, the per-plan lock and the daily limit.

### OFP-27 · Web: the briefing card
- On the saved-plan page: a **Generate briefing** button (briefings are never generated
  automatically, so nothing costs money without a click), live progress ("Reading EDDB
  weather…"), then the card: headline, overall risk, per-airport conditions with category
  badge and the cited report, pilot notes.
- Always labelled "AI-generated · for flight simulation only", with model and time; failures
  shown with the reason and a retry; the latest stored briefing loads with the page.
- **Done when:** page tests (mock API with a scripted event stream) cover progress, success,
  failure, the daily limit message and reloading a stored briefing.

### OFP-28 · First real briefings + end-to-end
- `pnpm briefing:try <planId>`: runs one real briefing with your key from `.env`, prints the
  result, tokens, cost and any guardrail failure. Used to tune the system prompt.
- A fake Claude in the e2e stack (the API pointed at it like SimBrief and aviationweather.gov);
  the journey generates a briefing and sees the card.
- **Done when:** real briefings for the three captured plans pass every guardrail and cost under
  the agreed limit each, and e2e is green in CI. 🎉 Phase 5 done.

---

## Phase 6 — Hazards along the route

Goal (PLAN.md): SIGMETs and similar advisories that touch the planned route are found in code,
mapped to the affected waypoints, shown on the plan page, and named by the AI briefing.

**Ground rules for every Phase 6 ticket**

- **Geometry comes from code.** Whether a hazard touches the route, between which waypoints, and
  at which levels and times is computed deterministically. The agent only describes what the
  tools return, and the guardrails check every advisory id and waypoint it names.
- **Real advisories, simulated flight.** The feeds are real, current aviationweather.gov data
  (X-Plane 12 uses real weather by default); everything stays labelled "for flight simulation only".
- **No network in tests.** Captured feeds in `fixtures/hazards/`, plus hand-made polygons over
  known waypoints of the captured OFPs.
- **Small and cached.** One request per feed covers the whole world; cached 5 minutes like METARs.

### OFP-29 · Hazard feeds: SIGMETs and G-AIRMETs
- `packages/weather`: a client for aviationweather.gov's `isigmet` (international SIGMETs,
  worldwide), `airsigmet` (US SIGMETs, convective included) and `gairmet` (US G-AIRMETs), with
  Zod schemas for each feed.
- One normalised `Advisory`: stable id, source, hazard (`thunderstorm`, `turbulence`, `icing`,
  `volcanic_ash`, `tropical_cyclone`, `mountain_wave`, `low_visibility`, `other`), severity,
  valid from/to, base/top in feet (null when not given), polygon (`[lon, lat][]`, or null when
  the feed gives no shape), FIR, raw text.
- `pnpm fixture:hazards` captures the three feeds to `fixtures/hazards/`.
- **Done when:** tests parse the captured feeds, map every hazard code seen in them (unknown
  codes become `other`), and keep advisories without a polygon (listed, never matched).
- *As built:* `polygons` is a list of rings (an advisory can cover several areas, "AREAS");
  empty means no shape. Areas across the antimeridian keep longitudes past ±180 so they stay
  continuous (OFP-30 must handle that). G-AIRMET freezing-level contours (`FZLVL`, lines) are
  left out; a G-AIRMET snapshot counts as valid 90 min either side of its time.

### OFP-30 · Match hazards to the route
- A pure function: the plan's legs (consecutive waypoints, with altitude and ETA from takeoff
  time + elapsed time) against each advisory, using Turf.js for the leg/polygon intersection.
  - **Where:** first and last affected waypoint per advisory (one advisory can cross the route
    more than once).
  - **Altitude:** a leg counts only if its planned altitude overlaps base–top.
  - **Time:** a leg counts only if its ETA falls in the valid window (with a small margin).
  - Routes across the antimeridian (e.g. transpacific) work.
- Migration: the `advisories` table from PLAN.md (per plan, with the matched waypoint range).
- API: `GET /api/flight-plans/:id/hazards` (stored) and `POST …/hazards/refresh` (fetch, match,
  store), next to the live weather endpoints.
- **Done when:** fixture tests map a known polygon to the right waypoints of the EDDB → EDDM
  and KSFO → KJFK plans, the altitude and time filters each exclude a case, an antimeridian
  route matches, and the routes are tested with `app.inject()`.
- *As built:* one `advisories` row per advisory with its `segments` (fix to fix) as JSON, since
  one advisory can cross the route more than once. Legs follow the great circle; a leg counts
  when any of its planned altitudes is inside base–top (a missing base is the surface; low
  visibility without levels counts below 10,000 ft). The time margin is 30 min. ETAs count from
  the planned takeoff, or from the check time when that has passed (plans flown later than
  planned). The route starts at the first navlog fix: SimBrief's navlog has no origin position.
  Feeds are cached 5 minutes (1 minute when one was down), shared by all plans.

### OFP-31 · Web: hazards on the plan page
- A **Hazards along the route** card: per hazard its type, severity, levels (FL), valid until
  (Zulu), the affected legs ("LUROS → ERNAS"), and the raw SIGMET folded away; "None on your
  route" with how many advisories were checked and when.
- The affected navlog rows are marked.
- Refreshes together with live weather (on open when stale, and on Refresh).
- **Done when:** page tests (mock API) cover hazards found, none found, a feed that is down,
  and the navlog marks.
- *As built:* the card sits after the weather card; navlog rows inside a hazard get an amber
  mark with the hazard codes ("⚠ TS"). Checked on open when the last check is over 10 minutes
  old, and with the weather card's Refresh. The API now also returns `advisoriesChecked`
  (migration 0006). The e2e fake serves the captured feeds plus a SIGMET over the e2e route.

### OFP-32 · Hazards in the AI briefing
- A `get_route_hazards` tool: each matched advisory with `advisoryId`, type, severity, levels,
  valid until and the from/to waypoints.
- Prompt `briefing-v3`: name each hazard in `enrouteHazards` and in the pilot notes when it
  matters for the flight.
- New guardrail: every hazard the tool returned must appear in `enrouteHazards` (the existing
  checks already reject unknown advisory ids and waypoints).
- The e2e fake Claude and `pnpm briefing:try` cover a plan with a hazard.
- **Done when:** guardrail tests pass, real briefings for the captured plans (with captured
  hazards) pass every guardrail within the cost limit, and e2e is green. 🎉 Phase 6 done.
- *As built:* the tool returns at most 10 hazards (`moreNotShown` counts the rest); guardrails
  also check each entry's type, severity, validUntil and that its from/to is one of the
  advisory's segments, and that get_route_hazards was called. Captured plans get made-up
  SIGMETs on their routes (`packages/agent/src/testing/routeHazards.ts`), since the captured
  feeds expire. First run of `briefing-v3` on the three captured plans (11 Nov): all done,
  every hazard cited, $0.0078 in total.

### OFP-33 · Optional: route map
- A MapLibre map of the route with the hazard polygons drawn on it, on the plan page.
- **Done when:** it renders the captured plans with and without hazards, on phone width too.
- *As built:* MapLibre 6 with OpenFreeMap tiles (no key; positron or dark, following the system
  theme), in its own chunk loaded when the card scrolls into view; the main bundle is
  unchanged. Route along great circles from the first navlog fix, hazard areas in a colour per
  type, affected stretches highlighted, a popup per area and a legend; "Map unavailable" when
  the map or its style cannot load. Also on sample pages (without hazards). e2e serves a plain
  style from the fake (`VITE_MAP_STYLE_BASE`), so no tiles come from the internet.

---

## Phase 7 — Evals

Goal (PLAN.md): `pnpm eval` runs the briefing agent on frozen cases and prints a pass rate per
check and per prompt version, so prompt or model changes are measured, not guessed.

**Ground rules for every Phase 7 ticket**

- **Frozen inputs.** Each case is a captured OFP, a fixed clock and saved METARs, TAFs and
  advisories, so a case gives the agent the same tool results every run. No live feeds.
- **The real agent.** The eval calls `runBriefing()` with test dependencies, never its own copy
  of the Claude call.
- **Code checks only.** Grading is deterministic and free; no model judges a model. Checks are
  tested with hand-written passing and failing briefings, without calling Claude.
- **Paid runs are asked for.** A run prints its case count, repeats and estimated cost first,
  and stops at a budget. Tests never call Claude.
- **For flight simulation only**, like the rest of the app.

### OFP-35 · Frozen eval cases
- Agent tools take an injectable clock (`ToolDeps.now`), so ETAs, "today" and the hazard time
  filter follow the case, not the computer.
- Fixed weather and hazard clients that serve a case's reports and advisories (and can report
  a feed as down).
- Plans: the 3 captured OFPs plus 3–5 more varied ones captured with `pnpm fixture:capture`
  (other regions, long haul, winter).
- Scenarios, built from real captured reports re-dated to the case: quiet day; LIFR at the
  destination; freezing fog or freezing rain; worse since dispatch; TAF worsening around
  arrival; no live METAR; thunderstorm SIGMET on the route; severe turbulence; volcanic ash;
  hazard feeds down; no alternate.
- `packages/evals`: the cases in TypeScript (plan, clock, scenario, tags, and what a correct
  briefing says), and `CASES.md` listing every case with what the agent will see, for review.
- **Done when:** 18–24 cases load and their tool results are identical on every run (tested
  without Claude), and the case list is reviewed.

### OFP-36 · Graders
- Per briefing, each check passes or fails with a reason:
  - **guardrails:** the existing guardrails pass (citations, flight categories, hazard
    coverage, no fuel, weights or durations).
  - **risk:** `overallRisk` matches the rule in the prompt, worked out in code from the case.
  - **no invented weather:** each weather word in the text (freezing rain, thunderstorm, fog,
    snow, hail, ...) is backed by a code in that airport's METAR or TAF (FZRA, TS, FG, ...).
  - **numbers:** wind direction and speed and cloud heights in each summary match the cited
    METAR.
  - **hazards in notes:** every hazard on the route is named in a pilot note.
- Side measures per run: tokens, cost, latency, tool calls, turns.
- **Done when:** every check is tested with a passing and a failing hand-written briefing, a
  perfect briefing scores 100% and an empty or wrong one fails, with no Claude call.
- *As built:* six checks. Fuel and durations are already part of the guardrails, so they are
  not scored twice; **says what is missing** was added (when live weather or a hazard feed
  could not be read, the briefing must say so). An airport summary may only describe the METAR
  it cites, at its intensity ("light rain" needs `-RA`); notes may use any report of the
  airports they name, or a route hazard. Visibility and pressure are checked with wind and
  cloud. A code-written model answer for each case passes every check, and each kind of
  mistake fails only its own check. `pnpm eval:stored` grades the briefings in the dev
  database for free: 2 of the 4 recent `briefing-v3` ones failed (mist that only the TAF had,
  "light rain" for `RA`). Guardrail rejections now keep the rejected briefing for grading.

### OFP-37 · `pnpm eval`
- Runs every case (or `--case`, `--tag`) `--reps` times (default 3) on `--model` (default
  Haiku 5.5), a few at a time, with a time limit per run and retries with backoff on 429/529.
- Shows the plan and an estimated cost and asks before running; refuses past `--budget`.
- Writes `evals/runs/<prompt version>/<model>/`: one row per run (checks, tokens, cost,
  latency), a trace per run (system prompt, tool calls and results, answer), failed attempts
  separately, and resumes after a crash without repeating finished runs.
- Prints the pass rate per check and overall, with a margin of error, and builds a
  `report.html` linking every trace; compares prompt versions and models side by side.
- **Done when:** a fake-Claude run writes complete rows and traces (tested), and a real
  baseline run on Haiku 5.5 is recorded.

- *As built:* results in `packages/evals/runs/<prompt version>__<model>/` (`results.jsonl` with
  each answer, `errors.jsonl`, `meta.json` committed; traces and `report.html` rebuilt locally).
  A seventh check, **valid answer**: a run with no usable briefing fails it, and the other checks
  do not apply. `pnpm eval:regrade` grades stored answers again after a grader change and
  `pnpm eval:report` rebuilds the report, both free. API errors, timeouts and a different model
  answering are kept out of the scores and run again on resume.
- *Baseline, `briefing-v3` on Haiku 5.5 (21 cases × 3, $0.16, 12.7 s per run):* all checks
  76% (48/63); valid answer 98%, guardrails 98%, risk 95%, no invented weather 87%, numbers
  97%, hazards noted 100%, missing data said 100%. The mistakes: mist (`BR`) called fog (6
  runs), freezing rain and drizzle no report has, a TAF value in a METAR summary, a wrong wind
  direction, "block time" in a note, a headline over 140 characters (no briefing), and risk
  "moderate" with thunderstorms in the arrival TAF where the prompt's rule says low (3 runs; the
  rule, not the model, is probably what needs changing).

### OFP-38 · Baseline and first improvements
- Baseline on Haiku 5.5 (`briefing-v3`), and once on Sonnet 5.5 for comparison.
- Fix the prompt for what the checks find (e.g. invented weather), as `briefing-v4`, and keep
  it only if it scores better without making another check worse.
- **Done when:** the results for v3 and v4 (and Sonnet) are recorded here, and the app uses the
  better prompt.
- *As built:* `briefing-v4` adds a "weather words" section (BR is mist, never fog; freezing rain
  only for FZRA; RASN is rain and snow; "-" light, none moderate, "+" heavy), keeps forecasts out
  of airport summaries, asks for the METAR wind copied exactly, a headline of at most 110
  characters, and no fuel or time words at all. The risk rule now says thunderstorms in the
  destination TAF rule out "low" (the v3 model was right to say moderate); the grader follows it
  and grades every version by it.
- *Results (Haiku 5.5, 21 cases × 3):* `briefing-v3` 81% of runs pass every check (51/63, after
  the risk rule fix), `briefing-v4` **92% (58/63)**, $0.17. Better on 8 cases, worse on 1 (by
  one run); no check got worse (no invented weather 54/62 → 58/63, numbers 60/62 → 63/63,
  guardrails 61/62 → 63/63, valid answer 62/63 → 63/63). Left: mist still called fog in 3
  headlines or notes, and "rain showers" for RA twice. The app uses v4.
- *Sonnet 5.5 (`briefing-v4`, 21 cases × 1, $0.78):* 86% (18/21; interval 65–95%), 7.9 s per run
  against Haiku's 13.4 s, at $0.037 a run (14× Haiku). Not more accurate: a 10 SM visibility
  given as 10 km, mist called fog, a "high" risk where the rule says moderate, and six pilot
  notes (no briefing). Haiku 5.5 stays the default. Reading these failures also fixed two
  grader mistakes: notes naming US airports by their three-letter code ("JFK"), and advice
  ("check for icing") read as a weather claim.

---

## Extras

### OFP-34 · Countdown to pushback in the Times card
- At the top of the Times card, the time left to Out (pushback), then to Off (takeoff), then to
  On (landing), ticking every second by the computer's clock (not X-Plane's), with the target
  in Zulu and local time.
- **Done when:** it counts down and changes stage at each milestone, turns amber under ten
  minutes before pushback and takeoff, and is hidden for a plan more than a day ahead or
  already flown; tested with a fake clock.
- *As built:* milestones are rounded to the minute as the card shows them, so 0:00 matches the
  time on screen. The app cannot tell whether the pilot actually pushed back, so the takeoff
  stage also says how long ago pushback was planned.

### OFP-39 · Temperature and QNH now in the Takeoff & landing card
- The card showed the live METAR wind under the planned values but not the temperature and
  QNH, so after a weather refresh the pressure still read as at dispatch.
- **Done when:** a saved plan shows "Now" temperature and QNH from the latest METAR under the
  planned values at both airports, updating with the weather refresh; sample pages show
  planning data only.
- *As built:* `decodeMetar` reads the temperature group (M for minus) and QNH (Q in hPa, A in
  inHg) from the observation only, never the remarks, so the same code reads the OFP's and
  live METARs. Temperature and QNH are what the pilot sets, so the value now is the main one
  and the dispatch value sits under it as "Before"; the wind keeps the planned value first.

---

## Later phases (not ticketed yet)

| Next | Summary |
| --- | --- |
| 3b Deploy | Budget alarm first; then CDK (RDS, Fargate, S3 + CloudFront) or the cheaper Lightsail + Compose fallback |
| 8 MCP | The `packages/agent` tools exposed to Claude Desktop / Claude Code |
| Sharing | Auth and multi-pilot support before anyone else uses it |
