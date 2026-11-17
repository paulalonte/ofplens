# Platform engineering notes

What each deployment step teaches, written while building OFP Lens's deployment
([DEPLOYMENT.md](DEPLOYMENT.md)). Each step has the concepts, why it is done this way, the
production pitfalls it avoids, and how to explain it in an interview.

---

## Warm-up — Kubernetes basics (kind, kubectl, k9s, Helm)

**The tools**

| Tool      | What it does                                                                         |
| --------- | ------------------------------------------------------------------------------------ |
| `kind`    | Creates and deletes whole Kubernetes clusters on your Mac, as Docker containers.     |
| `kubectl` | The Kubernetes command line: works _inside_ a cluster (nodes, pods, logs).           |
| `k9s`     | A live terminal dashboard; reads the same login settings (kubeconfig) as `kubectl`.  |
| `helm`    | The package manager: installs an app (a _chart_) into a cluster, with upgrades and rollbacks. |

On AWS, Terraform creates the cluster (EKS) instead of kind; `kubectl`, `k9s` and `helm` stay
the same.

**Two trees**

```
Physical:  Cluster → Node (a machine) → Pod → Container
Logical:   Cluster → Namespace (a folder: one per app or team) → Pod → Container
```

- A pod belongs to one namespace and runs on one node. The **scheduler** picks the node; a
  namespace never decides where pods run.
- One cluster runs many apps, one namespace each. Clusters separate **environments** (dev,
  staging, prod) or regions, not the parts of one app.
- Usually one container per pod. Several only when they share a lifecycle: a **sidecar** (log
  shipper, service mesh proxy) or an **init container** (runs before the main one).
- Namespaces organise (names, access rules, quotas); **NetworkPolicies** isolate traffic.

**The control plane** (the `kube-system` pods): `kube-apiserver` (the front door; every tool
talks only to it), `etcd` (the cluster's database), `kube-scheduler` (places pods),
`kube-controller-manager` (keeps reality matching what you asked for), `coredns` (names like
`postgres` inside the cluster), `kube-proxy` (routes Service traffic). On EKS AWS runs these;
you see only the worker nodes.

**Contexts:** `kubectl` talks to one cluster at a time, the current context. Check it
(`kubectl config current-context`) before anything destructive; a command meant for a test
cluster run against production is a classic incident.

**Scaling:** replicas of a pod are all active (active/active); a Service, and on AWS the load
balancer, spreads requests across them. That is **horizontal scaling** and only works for
**stateless** services: the API keeps nothing between requests, so any pod can answer. The
state lives in one database (RDS), the single source of truth. Watch its connection limit as
pods multiply; Multi-AZ gives it a standby, read replicas take extra reads.

**Helm:** `Chart.yaml` is like `package.json` (name, version, dependencies), `values.yaml` holds
the defaults, `values-<env>.yaml` the settings per environment (the names are a convention),
and `templates/` the Kubernetes YAML with blanks. The values live in Git, which is the source of
truth; secrets never do.

**Interview:** "What happens when a node dies?" The node stops renewing its lease
(`kube-node-lease`), Kubernetes marks it NotReady and recreates its pods on other nodes; with
two replicas spread over nodes, the app stays up meanwhile.

---

## Step 1 — Containers

**What was built**

- One `Dockerfile` with several **targets**: `api` and `web`. A `.dockerignore` keeps
  `node_modules`, `.git` and `.env` out of the build.
- The API is **bundled** with esbuild into `dist/server.js` and `dist/migrate.js`. The image
  needs no TypeScript, no pnpm and no `node_modules`: our code is one 16.6 MB layer on top of
  Node.
- The web app is the Vite build served by **nginx**, which also forwards `/api` to the API and
  answers `/healthz`.
- Migrations are a **separate command** in the API image (`node dist/migrate.js`), run once
  per deploy.
- `pnpm app:up` runs the whole app from the images (http://localhost:8080); CI builds both
  images and smoke-tests them on every PR.

**Concepts**

- **Image vs container:** an image is the packaged, read-only filesystem plus a start command;
  a container is one running copy of it. Kubernetes runs pods of containers from images.
- **Layers:** every `COPY` and `RUN` adds a layer. Docker reuses a layer until something it
  depends on changes. So the Dockerfile copies the lockfile and downloads dependencies
  (`pnpm fetch`) _before_ copying the source: a code change reuses the dependency layer and
  rebuilds in seconds. Order instructions from least to most often changed.
- **Multi-stage builds:** the build stages have pnpm, TypeScript and the whole repo; the final
  stage copies only the result (`COPY --from=api-build`). Smaller images download and start
  faster and contain fewer things an attacker could use.
- **Build context:** everything Docker can see while building, filtered by `.dockerignore`.
  Without it, `.env` (with the Claude key) could end up inside an image.
- **Run as non-root:** the API runs as `node`, the web as `nginx` (the unprivileged image,
  listening on 8080, since ports under 1024 need root). If the app is ever broken into, the
  attacker is not root inside the container. Many Kubernetes clusters refuse root containers.
- **Listen on 0.0.0.0:** inside a container, `127.0.0.1` is the container itself, so the API
  must listen on all interfaces (`HOST=0.0.0.0` in the image) to be reachable at all.
- **Configuration from the environment** (the "twelve-factor" rule): the same image runs on
  your Mac, on kind and on AWS; only environment variables differ (`DATABASE_URL`,
  `API_UPSTREAM`). Build once, deploy the same image everywhere.
- **Graceful shutdown:** Kubernetes stops a pod with `SIGTERM`, then kills it after 30 s. The
  API closes its server and database connections on `SIGTERM`, so requests in flight finish.
  The `CMD` uses the exec form (`["node", ...]`) so Node itself receives the signal.
- **Health checks:** `/api/health` (API and database) and `/healthz` (nginx). Compose waits on
  them now; in step 2 they become Kubernetes readiness and liveness probes.
- **Pinned versions:** base images are exact (`node:24.22.2-slim`, `1.30.6-alpine`), never
  `latest`: a rebuild next month gives the same result, and upgrades are deliberate PRs.

**Why migrations are separate**

If every API pod migrated on start, two pods starting together would race on the same schema
change. A single run per deploy (a Kubernetes Job in step 2) applies them once, and the API
starts only after it succeeded (in compose: `service_completed_successfully`).

**Production pitfalls this avoids**

- Secrets baked into an image (anyone who can pull the image has them).
- `latest` tags: you cannot tell what is running or roll back to it.
- Root containers, and containers that ignore `SIGTERM` and drop requests on every deploy.
- Rebuilding everything for a one-line change because the Dockerfile copies the source first.
- Config that only works with your own `.env`. The first CI run of the smoke test failed: with
  no `.env`, compose passed `ANTHROPIC_API_KEY` as an _empty_ string, and the API rejected it
  instead of treating it as unset. It worked on the Mac only because the key was set there.
  Now an empty variable counts as unset. Lesson: test the image the way a fresh environment
  will run it, with nothing but what the deploy provides.
- Images that only work on the machine that built them (the app's dev tools missing at run
  time); CI builds and starts the images on every PR, so that shows up before merging.

**Try it**

```bash
pnpm app:up        # build and start db, migrate, api, web; open http://localhost:8080
docker compose --profile app ps
pnpm app:logs      # follow the API and web logs (Ctrl+C to stop following)
docker images | grep ofplens
docker history ofplens-api:local
docker run --rm ofplens-api:local whoami
pnpm app:down      # stop everything (pnpm dev starts Postgres again)
```

Change a line in `apps/api/src` and run `pnpm app:up` again: only the source and build layers
rebuild.

**Interview**

"I containerised a TypeScript monorepo with a multi-stage Dockerfile: dependencies are fetched
from the lockfile in their own cached layer, the API is bundled so the runtime image holds only
our 17 MB of JavaScript on a pinned Node base, and it runs as a non-root user with config from
environment variables. Migrations are a separate one-off command so scaled-out pods never race
on schema changes. CI builds the images and smoke-tests the whole stack with Compose on every
PR."

---

## Step 2 — Kubernetes and Helm on kind

**What was built**

- `deploy/kind/cluster.yaml`: one control-plane and two worker nodes. Port 8088 on the Mac
  goes to Traefik, the ingress controller, on every node (a NodePort).
- `deploy/helm/ofplens`: the chart. API and web Deployments and Services, an Ingress, the
  migration Job, a ConfigMap, a ServiceAccount and PodDisruptionBudgets.
- `deploy/kind/postgres.yaml`: Postgres for kind only (a StatefulSet with its own disk).
- `pnpm kind:up` / `pnpm kind:down` (`deploy/kind/up.sh`), and a CI job that runs the same
  script on a fresh kind cluster for every PR.

**How a request reaches the API**

```
Browser → localhost:8088 → kind node :30080 (NodePort) → Traefik (ingress controller)
        → Ingress rule "/api" → Service ofplens-api → one of the API pods
```

On AWS only the start changes: the internet → an Application Load Balancer created from the
same Ingress → the pods.

**Concepts**

- **Deployment → ReplicaSet → Pods:** you declare "2 API pods of this image"; the Deployment
  keeps a ReplicaSet per version, and the ReplicaSet keeps that many pods alive. That's why a
  deleted pod comes back with a new name.
- **Service:** a stable name and IP (`ofplens-api:3000`) in front of pods that come and go. It
  sends traffic only to pods that are **ready**.
- **Ingress + ingress controller:** the Ingress is just a rule ("/api goes to that Service");
  a controller (Traefik here, the AWS Load Balancer Controller on AWS) reads the rules and does
  the routing. Without a controller, an Ingress does nothing. The newer **Gateway API** does the
  same job with more features; worth knowing for interviews.
- **ConfigMap vs Secret:** settings vs credentials. Both become environment variables. A
  Secret is only base64-encoded, not encrypted; what protects it is who may read it (RBAC) and
  encryption at rest, which EKS can do with a KMS key.
- **Job:** a pod that runs to completion. As a Helm **hook** (`pre-install,pre-upgrade`) it
  runs before the new version starts; if it fails, the upgrade stops and the running version
  keeps serving.
- **StatefulSet:** for things with an identity and a disk (databases): stable name
  (`postgres-0`) and a volume that stays when the pod is replaced.
- **Requests and limits:** a request is what the scheduler reserves on a node; a memory limit
  is the ceiling (above it the container is killed: `OOMKilled`). No CPU limit on purpose: it
  throttles the app even when the node is idle.
- **Immutable tags:** each build gets a new tag (`<commit>-<time>`). Reusing a tag means
  Kubernetes may run an old image and you can't roll back to a known version.

**Probes: the most common production mistake**

- **Readiness** (`/api/health`, which checks the database): "can this pod serve now?" Not
  ready → no traffic, but the pod stays.
- **Liveness** (only "is the port open?"): "is the process stuck?" Failing → the pod is
  restarted.
- If liveness checked the database, a short database outage would make Kubernetes restart
  every API pod at once, which fixes nothing and turns a blip into an outage. Liveness checks
  only the process itself.

**Zero-downtime deploys**

- `maxUnavailable: 0, maxSurge: 1`: a new pod must be ready before an old one stops.
- When a pod stops, Kubernetes removes it from the Service and sends `SIGTERM` _at the same
  time_. The `preStop` sleep of 5 s keeps it serving while the routers catch up, then the API
  shuts down gracefully. Without it, a few requests fail on every deploy.
- Tested: a rolling restart of the API while sending requests every 0.1 s, 282 of 282
  answered.

**Security defaults in the chart**

- `runAsNonRoot`, no privilege escalation, all Linux capabilities dropped, default seccomp
  profile, **read-only root filesystem** (nginx gets two small writable `emptyDir` folders).
- The ServiceAccount doesn't mount a Kubernetes API token: the app never talks to the
  Kubernetes API, so a break-in can't use one either.
- What broke on the first install, and why: the image said `USER node`. With `runAsNonRoot`,
  Kubernetes can only check a **numeric** user, so it refused to start the container
  (`CreateContainerConfigError`, visible only in `kubectl get events`). The fix is `USER 1000`
  in the Dockerfile. The migration Job then waited for its 5-minute deadline: a reminder to read
  events when something is "in progress" for too long.

**Resilience**

- `topologySpreadConstraints` put the two API pods on different worker nodes.
- A **PodDisruptionBudget** (`minAvailable: 1`) stops a node drain or cluster upgrade from
  evicting both API pods at once.

**Values schema: typos fail loudly**

`values.schema.json` describes every value the templates read. Helm checks the merged values
against it on install, upgrade, lint and template; unknown keys are errors. Without it,
`api.replica: 3` (missing "s") is silently ignored and you get the default 2 pods. With it:

```
- at '/api': additional properties 'replica' not allowed
```

It also rejects a `latest` tag, zero replicas, unknown log levels and memory like `lots`. The
rule: whenever a template reads a new value, add it to the schema in the same change.

**Pinned cluster version**

`cluster.yaml` names the node image with its digest (`kindest/node:v1.37.0@sha256:…`), and CI
installs the matching kind release, so every machine runs the same Kubernetes version. Upgrades
are a deliberate PR, like the base images in step 1.

**Production pitfalls this avoids**

- Liveness probes that depend on the database (restart storms).
- Deploys that drop requests (no readiness, no `preStop`, `maxUnavailable` above 0).
- Migrations run by every pod on start (races) or by hand (forgotten).
- Secrets in values files, `latest` tags, root containers, writable filesystems.
- Commands run against the wrong cluster: the script names its context on every command.

**Try it** (the cluster is up after `pnpm kind:up`)

```bash
kubectl config use-context kind-ofplens
kubectl get pods -n ofplens -o wide                  # which node each pod is on
k9s -n ofplens

# Self-healing: delete an API pod and watch a new one appear
kubectl delete pod -n ofplens -l app.kubernetes.io/component=api --wait=false
kubectl get pods -n ofplens -w                       # Ctrl+C to stop watching

# Logs and details
kubectl logs -n ofplens deploy/ofplens-api
kubectl describe pod -n ofplens -l app.kubernetes.io/component=web
kubectl get events -n ofplens --sort-by=.lastTimestamp

# Helm releases: deploy a new build, look at the history, roll back
pnpm kind:up                                         # builds a new tag and upgrades
helm history ofplens -n ofplens
helm rollback ofplens -n ofplens                     # back to the previous revision

# What Helm sends to the cluster
helm get manifest ofplens -n ofplens | less

# A node failure: stop a worker, see the node go NotReady; after about 5 minutes its pods
# are recreated on the other worker. Start it again afterwards.
docker stop ofplens-worker
kubectl get nodes -w
docker start ofplens-worker

# Turn on AI briefings on kind. read -s takes the key without showing it or saving it in your
# shell history; it goes straight into the cluster's Secret, never into a file.
read -rs CLAUDE_KEY        # paste the key, press Enter
kubectl create secret generic ofplens-secrets -n ofplens \
  --from-literal=DATABASE_URL=postgres://ofplens:ofplens@postgres:5432/ofplens \
  --from-literal=ANTHROPIC_API_KEY="$CLAUDE_KEY" --dry-run=client -o yaml | kubectl apply -f -
unset CLAUDE_KEY
kubectl rollout restart deploy/ofplens-api -n ofplens

pnpm kind:down                                       # delete the cluster
```

**Interview**

"I packaged the app as a Helm chart with per-environment values. The API runs as a
multi-replica Deployment spread across nodes with a PodDisruptionBudget; readiness checks the
database, liveness deliberately doesn't, to avoid restart storms. Rolling updates use
maxUnavailable 0 and a preStop delay, and I verified zero failed requests during a rollout.
Migrations run as a pre-upgrade hook Job, so a failed migration stops the deploy and the old
version keeps serving. Containers run non-root with read-only filesystems, config comes from
a ConfigMap and credentials from a Secret created outside the chart. CI installs the chart on a
fresh kind cluster for every PR."

## Step 3 — Logins and multiple pilots

**What was built**

- Sign in with Google and GitHub (`apps/api/src/auth/`, `apps/api/src/routes/auth.ts`), and a
  development sign-in by name for local work and tests (`DEV_SIGN_IN`, localhost only).
- New tables: `pilot_identities` (who signs in how), `sessions` (signed-in browsers),
  `briefing_usage` (the briefing quota). Every plan belongs to one pilot.
- One hook that makes every `/api` route need a session, and one that checks plan ownership.
- AI briefing limits per pilot and for everyone, and per-minute rate limits.
- A sign-in page, the pilot's name and Sign out in the header (`apps/web`).
- Setup steps for Google and GitHub: [AUTH.md](AUTH.md).

**Concepts**

- **Authentication vs authorization:** authentication is "who are you?" (sign-in), and
  authorization is "may you do this?" (is this plan yours?). Most security bugs are in
  authorization: the login works, but a route forgets to check the owner.
- **OAuth 2.0 vs OpenID Connect:** OAuth 2.0 is for delegating *access* ("this app may read
  your GitHub profile"). OpenID Connect (OIDC) is a layer on top for *identity*: Google also
  returns an **ID token**, a signed JWT that says who signed in (`sub` = their permanent user
  id). GitHub is plain OAuth 2.0, so we use the access token once to call `GET /user`.
- **Authorization code flow:** the browser only carries a short-lived **code**. Our server
  swaps it for tokens, server to server, using the **client secret**. Tokens never pass
  through the browser.
- **`state`:** a random value we set in a cookie before going to the provider, and that the
  provider sends back unchanged. If they differ, someone is trying to sign you in with *their*
  code (login CSRF), so we refuse.
- **PKCE** (say "pixie"): a random `code_verifier` we keep, and its hash sent to the provider.
  A stolen code is useless without the verifier. Required for mobile and browser-only apps,
  and recommended for servers too (OAuth 2.1).
- **Sessions vs JWTs:** we keep sessions in Postgres and give the browser a random token.
  Signing out deletes the row, so the token stops working at once. A self-contained JWT
  ("stateless") needs no lookup, but cannot be revoked before it expires. That trade-off
  (instant revocation vs one query per request) is a classic interview question.
- **Store a hash, not the token:** the database keeps SHA-256 of the session token, so a
  leaked backup cannot be used to sign in. It's the same idea as password hashing, but a
  plain fast hash is enough because the token is 256 random bits, not a guessable password.
- **Cookie flags:** `HttpOnly` (JavaScript cannot read it, so a script injected into the
  page cannot steal it), `Secure` (https only), `SameSite=Lax` (not sent on cross-site POSTs,
  which blocks CSRF; still sent when the provider redirects back with a top-level GET).
- **Stateless pods:** the session lives in the database, not in the API process, so any of
  the two (or twenty) API pods can answer any request, with no "sticky sessions" on the load
  balancer. That's why horizontal scaling works.
- **Multi-tenancy:** every plan has a `pilot_id`, and every query filters by it. A further
  step is Postgres **Row-Level Security**, where the database itself refuses rows of other
  tenants even if the code forgets the filter.
- **IDOR / BOLA:** "Insecure Direct Object Reference", or in OWASP's API list "Broken Object
  Level Authorization" (#1 on that list). The bug is `/api/flight-plans/<someone else's id>`
  working. We check ownership in **one hook for every `:id` route**, so a new route cannot
  forget it, and answer **404, not 403**, so nobody can probe which ids exist.
- **Open redirect:** `?redirect=https://evil.example` after sign-in would send pilots to a
  phishing page that looks like it came from us. Only paths inside the app are allowed,
  checked on the server and in the browser.
- **Quotas vs rate limits:** a **quota** is a budget over a long window (10 briefings per
  pilot per day, 50 for everyone), so the Claude bill has a ceiling. A **rate limit** is a
  speed limit over a short window (5 per minute), so a bug or a script cannot hammer
  SimBrief or the weather service. Both answer HTTP 429 with `Retry-After`.
- **Atomic check-and-insert:** "count today's briefings, then insert one" has a race: two
  requests at the same moment both see 9 of 10 and both start. We take a Postgres
  **advisory lock** inside the transaction, so starts happen one at a time. The usage ledger
  (`briefing_usage`) is separate from `briefings`, so deleting a plan doesn't refund the quota.
- **Rate limits per pod:** the counts are kept in each API pod's memory, so with two pods a
  pilot gets up to twice the limit. That's fine for protection. Exact limits need a shared
  store such as Redis (ElastiCache on AWS), or the limit can be enforced at the edge (AWS WAF,
  API gateway).
- **`X-Forwarded-For` and trust proxy:** behind nginx and the ingress, every request seems to
  come from the proxy's IP. `TRUST_PROXY=true` makes the API read the client's address from
  the header the proxy adds. Only enable it when the API cannot be reached directly, or anyone
  could fake their address in that header.
- **Secrets per environment:** each environment has its own OAuth client (GitHub allows one
  callback URL per app). The secrets go into the Kubernetes Secret, the same way as the
  database URL, and later into AWS Secrets Manager. Never into values files or images.
- **A test-only door, locked to localhost:** development sign-in makes end-to-end tests
  possible without a real Google account. The API refuses to start with it unless
  `PUBLIC_URL` is localhost, so a config mistake can't open it in production.

**What would break in production, and how it's prevented**

| Risk | Prevention here |
| --- | --- |
| A new route forgets the login check | One `onRequest` hook protects all of `/api` except health and sign-in; a test calls every route signed out and expects 401 |
| A route forgets the owner check | One `preHandler` hook for every `/api/flight-plans/:id` route; a two-pilot test against real Postgres |
| Pilot B sees A's data cached in the browser | The web app drops every cached query on sign-in, sign-out and any 401 |
| Session token leaked from a DB backup | Only its SHA-256 is stored |
| Signed-out pilot's cookie still works | Server-side sessions: sign-out deletes the row |
| Briefing bill runs away | Per-pilot and global daily quotas, enforced atomically |
| Dev sign-in enabled on AWS by mistake | The API refuses to start: `DEV_SIGN_IN` needs a localhost `PUBLIC_URL` |
| Two first sign-ins race to claim the old data | Advisory lock in the sign-in transaction (tested) |

**Try it**

```bash
# Locally: add DEV_SIGN_IN=true to .env yourself, then
pnpm dev                                   # http://localhost:5173 → Sign in page

# Two pilots at once: a normal and a private window, signed in with different names.
# Pilot B opening pilot A's /history/<id> address gets "Plan not found".

# Look at the tables (Drizzle Studio): pilots, pilot_identities, sessions, briefing_usage
pnpm db:studio

# The API without a cookie
curl -i localhost:3000/api/flight-plans                       # 401 UNAUTHENTICATED

# Sign in by name with curl and reuse the cookie (development sign-in only)
curl -i -c /tmp/ofplens-cookies -H 'content-type: application/json' \
  -d '{"name":"Curl Pilot"}' localhost:3000/api/auth/dev       # 204 + Set-Cookie
curl -b /tmp/ofplens-cookies localhost:3000/api/auth/session

# On kind: development sign-in is on at http://localhost:8088
pnpm kind:up
```

**Interview**

"I added multi-tenant sign-in with Google and GitHub using the OAuth 2.0 authorization code
flow with state and PKCE. Google is OIDC, so I read the ID token's `sub`; GitHub is plain OAuth,
so I read the profile once. Pilots are keyed by provider and subject, never by email. Sessions
are server-side in Postgres with only a hash of the token stored, in HttpOnly, SameSite=Lax,
Secure cookies, so the API pods stay stateless and sign-out is instant. Authorization is
centralised: one hook requires a session on every API route and one checks ownership on every
plan route, answering 404 for other tenants' objects to avoid IDOR. Costly operations have a
per-tenant and global daily quota, enforced atomically with an advisory lock and kept in a
ledger that deletes can't reset, plus per-minute rate limits. A development-only sign-in makes
end-to-end tests possible and is refused unless the app runs on localhost."

## Step 4a — AWS account and Terraform bootstrap

**What was set up (by you, in the console)**

- Root user locked away with MFA (a passkey plus an authenticator app); billing visible to
  IAM; Free Tier alerts on.
- IAM Identity Center (single-Region, eu-central-1) with your user `paul`, MFA required, and
  the `AdministratorAccess` permission set assigned to the account.
- `aws configure sso` on your Mac: profile `ofplens`, temporary credentials, no access keys.

**What was built (in `infra/bootstrap`)**

- An AWS Budgets alarm: emails at 50% and 100% of $20 spent, and when the month is
  *forecast* to go over.
- The S3 bucket for Terraform state: private, encrypted, versioned, https-only, and
  protected from `terraform destroy`.
- ECR repositories `ofplens-api` and `ofplens-web`: immutable tags, a vulnerability scan on
  every push, and old images cleaned up automatically.
- A CI job that checks formatting and validity (no AWS access).

**Concepts: identity**

- **Root vs everyday identities:** root owns the account and can't be limited, so it's only
  for emergencies. People sign in through IAM Identity Center and *assume a role*
  (`AWSReservedSSO_AdministratorAccess_…`) with temporary credentials.
- **Users, permission sets, assignments:** who (a person or group), what (a set of
  permissions), and where (which AWS account). In companies, groups get the permission sets,
  and the users come from the company directory (Okta, Google, Entra ID).
- **No long-lived keys:** `aws configure sso` uses the same OAuth flow with PKCE that you
  built in step 3, with the CLI listening on `127.0.0.1` for the code. Leaked access keys
  are the most common way AWS accounts get compromised; SSO doesn't create any.
- **Least privilege:** you're admin because you're alone. Students, CI and the cluster's pods
  each get their own narrow role (CI via GitHub OIDC, pods via EKS Pod Identity in step 4b).
- **AWS Organizations:** turning on Identity Center made this account an Organization's
  *management account*. Companies keep it empty and run workloads in member accounts (dev,
  prod), one blast radius each. We use one account to keep it simple.

**Concepts: Terraform**

- **Declarative:** the `.tf` files say what should exist. `plan` compares that with what
  exists (according to the state) and lists the difference; `apply` makes the difference
  real. It's the same idea as Kubernetes manifests, but for cloud resources.
- **State:** Terraform's record of which real resource belongs to which block in the code.
  Lose it and Terraform forgets it created things (they keep running and costing money).
  Hence: kept in **S3**, **versioned** (any old state can be restored), **encrypted** (state
  can contain secrets), and **locked** (`use_lockfile`), so two `apply`s can't run at once and
  corrupt it.
- **The bootstrap problem:** the stack that creates the state bucket can't store its state
  there yet. The usual fix, used here: apply once with local state, then
  `terraform init -migrate-state` into the new bucket.
- **Providers and the lock file:** the AWS provider is a plugin that turns `.tf` into AWS API
  calls. `.terraform.lock.hcl` pins its exact build and checksums for Mac and Linux, just
  like `pnpm-lock.yaml`, so your Mac and CI use identical code. Commit it.
- **Variables, outputs, `for_each`:** variables are the inputs (your email stays in a
  git-ignored `terraform.tfvars`); outputs are what other steps need (the bucket name, the
  ECR URLs); `for_each` creates one resource per item in a set (one ECR repository per image).
- **`default_tags`:** every resource gets `Project=ofplens`, `ManagedBy=terraform`, so Cost
  Explorer can show what OFP Lens costs, and anything without the tags was made by hand.
- **`prevent_destroy`:** Terraform refuses to delete the state bucket. That's a guard rail for
  the one resource whose loss would be a real problem.
- **Data sources:** `data "aws_caller_identity"` reads facts, here the account id, without
  creating anything, so no account-specific value is hard-coded in the repository.

**Concepts: the resources**

- **Budgets, actual vs forecast:** "actual" fires after the money is spent. "Forecast" fires
  when the trend says the month will go over, which is the alert that catches a cluster
  someone forgot to destroy. Budgets check a few times a day; it's a net, not a brake. AWS
  doesn't stop anything when a budget is exceeded.
- **S3 hardening:** Block Public Access (four switches), `BucketOwnerEnforced` (no ACLs, only
  IAM and bucket policies), default encryption, and a bucket policy that denies anything not
  using TLS. That's the standard checklist for any bucket holding something private.
- **ECR:** a private registry next to the cluster (fast, no Docker Hub rate limits).
  **Immutable tags** mean `abc123` can never be overwritten with different contents.
  **Scan on push** lists known CVEs in the image's OS packages. **Lifecycle policies** delete
  old images so storage costs stay flat.

**What would break in production, and how it's prevented**

| Risk | Prevention here |
| --- | --- |
| Root credentials stolen | Root has MFA, no access keys, and isn't used |
| Access key leaked from a laptop or repo | No access keys: SSO with temporary credentials |
| A forgotten cluster runs all month | Forecast budget alert, and nightly teardown later |
| State file lost or corrupted | S3 versioning, locking, `prevent_destroy` |
| State leaks secrets | Private, encrypted bucket, https-only, never in git |
| Same image tag pointing at different code | ECR immutable tags |
| Broken Terraform merged | CI runs `fmt -check` and `validate` on every PR |

**Try it**

```bash
export AWS_PROFILE=ofplens
aws sts get-caller-identity
cd infra/bootstrap
terraform init && terraform plan     # read it: what will be created, and why
terraform apply                      # infra/README.md has the whole sequence
terraform state list                 # what Terraform now manages
terraform output                     # the bucket name and ECR URLs
aws budgets describe-budgets --account-id "$(aws sts get-caller-identity --query Account --output text)"
```

**Interview**

"The account follows AWS's baseline: root is MFA-protected and unused; people sign in through
IAM Identity Center with permission sets and short-lived credentials, so there are no IAM
access keys anywhere. Infrastructure is Terraform with remote state in a versioned, encrypted,
TLS-only S3 bucket with S3-native locking. The bootstrap stack that creates that bucket
migrates its own state into it after the first apply. A cost budget with actual and forecast
alerts goes in before anything that costs money. Images live in ECR with immutable tags,
scan-on-push and lifecycle policies. CI checks formatting and validity on every PR, and
plan/apply run with human review."

## Step 4b — The cluster on AWS (EKS, RDS, load balancer, secrets)

**What was built (in `infra/aws`, `deploy/aws`, `values-aws.yaml`)**

- A VPC in two availability zones: public subnets for the nodes and the load balancer,
  database subnets with no internet route, **no NAT gateway**.
- EKS with two Graviton (ARM) worker nodes in a managed node group, and AWS-managed add-ons
  (VPC CNI, CoreDNS, kube-proxy, the Pod Identity agent).
- RDS Postgres 16, reachable only from the nodes, with its URL in Secrets Manager.
- Two Helm-installed controllers with their own narrow AWS permissions: the **AWS Load
  Balancer Controller** and **External Secrets**.
- `pnpm aws:up` / `pnpm aws:down`, and the cost-first run book [infra/aws/README.md](../infra/aws/README.md).
- The same Helm chart as on kind; only `values-aws.yaml` differs.

**Concepts: the platform under the chart**

| On kind (step 2)                          | On AWS (step 4b)                                    |
| ----------------------------------------- | --------------------------------------------------- |
| `kind create cluster` (control plane in Docker) | EKS: AWS runs and patches the control plane     |
| Three Docker containers as nodes          | A managed node group: EC2 instances AWS replaces    |
| Traefik turns the Ingress into routing    | The load balancer controller turns it into an ALB  |
| A Postgres pod (`kind/postgres.yaml`)     | RDS, outside the cluster                            |
| `kubectl create secret` in `up.sh`        | External Secrets copies from Secrets Manager        |
| `kind load docker-image`                  | `docker push` to ECR; nodes pull from it            |

The app's chart doesn't change. That's the separation platform teams aim for: app teams ship
one chart, and the platform decides what's underneath.

**Concepts: networking**

- **VPC, subnets, route tables:** a VPC is your private network. A subnet is *public* when its
  route table sends `0.0.0.0/0` to an **internet gateway**. The database subnets have no such
  route, so nothing there can reach the internet or be reached from it.
- **NAT gateway, and why there's none:** private subnets reach the internet through a NAT
  gateway (~$35/month each, before traffic). The usual production layout is nodes in private
  subnets behind NAT. Here the nodes are in public subnets with public IPs, and their security
  group admits nothing from the internet. It's cheaper, and the trade-off is a node with a
  public address (defence in depth is thinner, so this is a learning choice, not a production one).
- **Security groups:** stateful firewalls on each network interface. The database's group
  allows port 5432 **from the nodes' security group** (a reference, not an IP range), so it
  keeps working when nodes are replaced and get new IPs.
- **VPC CNI:** on EKS every pod gets a real VPC IP address. That's why the load balancer can
  send traffic **straight to pods** (`target-type: ip`), and why a t4g.medium can run only
  17 pods (each network interface holds a limited number of addresses).

**Concepts: permissions for pods**

- **The problem:** the load balancer controller must call AWS APIs, and External Secrets must
  read Secrets Manager. Putting access keys in a Kubernetes Secret would bring back the
  long-lived keys you avoided in step 4a.
- **EKS Pod Identity (used here):** an IAM role is *associated* with a namespace and service
  account. The Pod Identity agent on each node gives pods using that service account
  temporary credentials for that role. No keys, and each controller gets only its own policy.
- **IRSA, the older way (same goal):** the cluster's OIDC issuer is registered in IAM, and the
  role trusts tokens for a specific service account. You'll still meet it everywhere. Pod
  Identity needs no OIDC provider per cluster and the role doesn't name the cluster, which
  suits a cluster that's recreated every session.
- **Least privilege in practice:** External Secrets may read exactly two secrets
  (`ofplens/app`, `ofplens/database`); it can't list, create or read anything else.

**Concepts: getting traffic in**

- **Ingress → controller → ALB:** the chart's Ingress is only rules. The AWS Load Balancer
  Controller watches it and creates an Application Load Balancer, listeners, target groups
  and security group rules, and keeps the targets in sync as pods come and go.
- **Health checks:** the ALB checks every pod itself (`/api/health` for the API, `/healthz` for
  nginx, set as Service annotations) and only sends traffic to healthy ones. That's on top of
  Kubernetes' own readiness probes.
- **Admission webhooks and install order:** the controller registers webhooks, so the API server
  asks the controller's pod before accepting certain new objects. If that pod isn't running
  yet, the API server rejects the object (`failed calling webhook … no endpoints available`).
  The first apply hit this: External Secrets was installed in parallel and its Services were
  refused. The fix is an explicit `depends_on`, and switching off a webhook that isn't needed
  (`enableServiceMutatorWebhook`). Parallel installs are a common source of "works the second
  time" failures.
- **Things Terraform didn't create:** the ALB belongs to the controller. Destroy the cluster
  first and the ALB stays, billed, with nothing left to delete it. That's why
  `aws:down` uninstalls the app and waits for the ALB to disappear **before**
  `terraform destroy`. The tags `ManagedBy=aws-load-balancer-controller` and `Project=ofplens`
  help you find leftovers.

**Concepts: secrets**

- **Secrets Manager → External Secrets → Kubernetes Secret:** the values live in AWS. A
  `SecretStore` says where to read, and an `ExternalSecret` says what to copy into which
  Kubernetes Secret, refreshed every hour. The chart still just reads `ofplens-secrets`, the
  same as on kind.
- **Two lifetimes:** your keys (`ofplens/app`) live in **bootstrap**, so they survive every
  teardown. The database URL (`ofplens/database`) is created with the database and deleted
  with it (`recovery_window_in_days = 0`, otherwise the name would be blocked for a week).
- **Terraform never sees your keys:** it creates the empty secret and ignores later changes
  (`ignore_changes`). The database password *is* in Terraform's state (it generated it), which
  is one more reason the state bucket is private and encrypted.

**Concepts: Terraform beyond one stack**

- **Modules:** `terraform-aws-modules/vpc`, `/eks` and `/eks-pod-identity` are community modules
  most companies use: hundreds of lines of subnets, routes and IAM per call, tested by many.
  Pin them (`~> 21.29`) like any dependency, and read what they create in `plan`.
- **Providers configured from resources:** the Helm provider gets the cluster's address from
  `module.eks`, and its token from `aws eks get-token`. It's convenient but has a trap: if the
  cluster is deleted outside Terraform, the provider can't connect and `destroy` gets stuck.
- **Two stacks, one bucket:** `bootstrap/terraform.tfstate` and `aws/terraform.tfstate` are
  separate keys. Destroying `aws` can't touch the bootstrap.

**What would break in production, and how it's handled**

| Risk | Here | Production would add |
| --- | --- | --- |
| Forgotten cluster runs all month | `aws:down`, budget alerts; nightly teardown (OFP-45) | Scheduled teardown of non-prod, cost anomaly alerts |
| Orphaned load balancer after teardown | Uninstall first, wait, tagged resources | The same, plus tag-based cleanup jobs |
| Database lost on destroy | Accepted: disposable | Backups, final snapshot, deletion protection, Multi-AZ |
| Nodes reachable from the internet | Security group admits nothing inbound | Private subnets behind NAT, or VPC endpoints |
| Pods with too much AWS access | One role per controller, two secrets only | The same; plus policy reviews and IAM Access Analyzer |
| Keys in code or chat | Pasted in the console only; External Secrets copies them | Secret rotation, audit via CloudTrail |
| TLS to the database not verified | `sslmode=require` encrypts but doesn't check the certificate | `verify-full` with the RDS CA bundle |
| Old Kubernetes version | Newest version pinned | Planned upgrades; extended support costs 6× |

**Try it** (with the cluster up)

```bash
kubectl --context ofplens-aws get nodes -o wide              # two ARM nodes, two zones, public IPs
kubectl --context ofplens-aws get pods -A -o wide            # which pod runs where, with VPC IPs
kubectl --context ofplens-aws describe ingress ofplens -n ofplens   # events from the ALB controller
kubectl --context ofplens-aws get externalsecret,secretstore -n ofplens
aws eks list-pod-identity-associations --cluster-name ofplens --region eu-central-1
aws elbv2 describe-target-health --region eu-central-1 --target-group-arn \
  "$(aws elbv2 describe-target-groups --region eu-central-1 --query 'TargetGroups[0].TargetGroupArn' --output text)"
kubectl --context ofplens-aws delete pod -n ofplens -l app.kubernetes.io/component=api --wait=false
#   …then watch the ALB's target health: old IP draining, new pod IP registering
```

**Interview**

"The app runs on EKS, provisioned with Terraform using the community VPC and EKS modules: two
AZs, a managed node group on Graviton, and RDS Postgres in isolated subnets that only admit
traffic from the node security group. Ingress is handled by the AWS Load Balancer Controller
in IP mode, so the ALB targets pods directly with per-service health checks. Controllers get
AWS access through EKS Pod Identity with least-privilege roles, with no static keys. Secrets
live in Secrets Manager and are synced into the namespace by External Secrets, so the Helm
chart is identical to the one used on a local kind cluster. It's a non-production,
cost-optimised setup: no NAT gateway, a disposable database, and a teardown that removes
controller-created resources before `terraform destroy`, so nothing is orphaned."

### Step 4b, part 2 — the nightly teardown (GitHub OIDC)

**What was built:** a GitHub Actions workflow that runs `deploy/aws/down.sh` every night, and in
`infra/bootstrap` the AWS side that lets it sign in without any stored key.

**Concepts**

- **Workload identity federation (GitHub OIDC):** every workflow run can ask GitHub for a
  signed token that says *who* it is, its `sub`:
  `repo:paulalonte@11928482/ofplens@1451769280:ref:refs/heads/main`. AWS
  trusts GitHub as an identity provider (`aws_iam_openid_connect_provider`) and swaps that
  token for one hour of credentials for a role (`AssumeRoleWithWebIdentity`). It's the same
  idea as your SSO login and as Pod Identity: **nothing long-lived to leak**.
- **The trust policy is the security boundary:** `aud` must be `sts.amazonaws.com` and `sub`
  must be this repo's `main` branch. A pull request from a fork gets a different `sub`
  (`…:pull_request`) and is refused, so a stranger's PR can't run code with your AWS role.
- **Immutable subjects:** the numbers are the owner's and the repository's permanent ids. With
  plain names (`repo:owner/name`), deleting a repo (or renaming an account) lets someone
  recreate the same name and inherit the trust. GitHub now uses the id form for this
  repository, and the first test run proved it: AWS answered *Not authorized to perform
  sts:AssumeRoleWithWebIdentity*, the classic sign of a trust policy whose `sub` doesn't match
  the token. Check the real format with
  `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` instead of guessing.
- **`permissions: id-token: write`:** a workflow only gets an OIDC token when it asks for one.
  Other workflows (CI) don't, so they couldn't assume the role even if they tried.
- **Guard rails on a broad role:** destroying a whole stack touches EC2, EKS, RDS, IAM and
  more, so the role is broad (PowerUserAccess). It's narrowed where it matters: IAM deletes
  only on resources tagged `Stack=aws`, and an explicit **Deny** on reading your app keys.
  In IAM an explicit Deny always beats an Allow.
- **Public repo hygiene:** workflow logs of a public repository are public. The role ARN is a
  GitHub *secret* (masked in logs) and `mask-aws-account-id` hides the account id.
- **Hidden per-session costs:** the EKS module creates a KMS key and CloudWatch control-plane
  logs by default. Fine for a long-lived cluster; for one recreated daily, every session left a
  $1/month key (deleted keys wait 30 days) and paid log ingestion. Both are switched off. Read
  a module's defaults, not just the inputs you set.

**Try it**

```bash
gh workflow run nightly-teardown.yml && gh run watch       # sign-in + empty leftover check
gh variable set KEEP_CLUSTER --body true                   # skip tonight
aws iam get-role --role-name ofplens-github-teardown --query Role.AssumeRolePolicyDocument
```

**Interview**

"Non-production clusters are torn down nightly by a scheduled GitHub Actions workflow. It
authenticates with GitHub OIDC: the IAM role's trust policy pins the audience and the subject
to the main branch of one repository, so no static credentials exist and forks can't assume
it. The role is broad enough to destroy the stack, but IAM deletions are restricted by tag,
and an explicit deny blocks reading application secrets. Teardown runs the same script
engineers run by hand, which removes controller-created load balancers first and fails the job
if anything billable is left."

## Step 5 — Domain and HTTPS (ofplens.app)

**What was built**

- The domain `ofplens.app`, bought in Route 53 by you. Registering it created its **hosted
  zone**, where its DNS records live.
- In `infra/bootstrap` (kept): a free **ACM certificate** for `ofplens.app` and
  `www.ofplens.app`, proved through DNS.
- In `infra/aws` (per session): **ExternalDNS**, which writes `ofplens.app → load balancer`
  into Route 53 and deletes it again on teardown.
- The load balancer now listens on **443 with that certificate**, and port 80 only redirects
  to https. `PUBLIC_URL` is `https://ofplens.app`, so sign-in with Google and GitHub works on AWS.

**Concepts: DNS**

- **Registrar vs DNS hosting:** buying the name (the registrar: Route 53 Domains) and
  answering questions about it (the hosted zone: Route 53 DNS) are separate jobs. The
  registry for `.app` (Google) is told which name servers answer for `ofplens.app`; those are
  the four `ns-…awsdns…` servers in your hosted zone's NS record.
- **Records:** `A` maps a name to IPv4 addresses, `CNAME` maps a name to another name, `TXT` is
  free text (used for proofs and ownership). Route 53's **alias** record is an AWS extension:
  an `A` record that follows an AWS resource's changing IPs (the ALB has several, and they
  change). It also works at the **apex** (`ofplens.app` itself), where a CNAME isn't allowed.
- **TTL and caching:** resolvers (your router, your ISP, your Mac) keep answers for the
  record's TTL. They also cache **"no such record"** (negative caching, as long as the zone's
  SOA says). So `up.sh` asks Route 53's *API* whether the record exists before asking *DNS*:
  one curious look too early can make the site "not exist" for you for a while.

**Concepts: certificates and HTTPS**

- **What a certificate proves:** that whoever answers on `ofplens.app` was approved by a
  certificate authority (here Amazon's) for that name. The browser checks the name, the
  dates and the chain up to a root it trusts.
- **DNS validation:** ACM gives a random CNAME to create in the zone. Only someone who controls
  the zone can do it, so that's the proof. While the record stays, ACM **renews the certificate
  automatically** (they last about 13 months). Certificates that silently expire are a classic
  production outage, and this design avoids it.
- **TLS terminates at the load balancer:** browser ↔ ALB is encrypted; ALB ↔ pods is plain
  HTTP inside the VPC. That's the common setup. End-to-end encryption to the pods (or a
  service mesh) is the stricter option when policy requires it.
- **Redirect and HSTS:** port 80 answers with a redirect to https. `.app` and `.dev` are on
  every browser's **HSTS preload list**, so browsers never even try http for them; the
  redirect matters for other clients like curl.
- **TLS policy:** `ELBSecurityPolicy-TLS13-1-2-2021-06` allows only TLS 1.2 and 1.3 with
  modern ciphers. Old protocols (TLS 1.0/1.1) are refused.
- **Secure cookies:** with `PUBLIC_URL` on https, the session cookie gets `Secure`, so the
  browser sends it only over encrypted connections.

**Concepts: ExternalDNS**

- **Another controller in the same pattern:** watch Kubernetes objects (Ingress hosts),
  change something in AWS (Route 53 records). Like the load balancer controller, it gets
  permission through Pod Identity, limited to **this one zone**.
- **Ownership:** next to each record it creates, ExternalDNS writes a `TXT` record saying
  "owned by ofplens". With `policy: sync` it deletes only records it owns, never the
  certificate's validation records or anything you make by hand.
- **The leftover record (16 Nov 2026):** a teardown left `ofplens.app` pointing at the old,
  deleted load balancer, without its ownership TXT records. Next session ExternalDNS logged
  "All records are already up to date" and did nothing: it never overwrites a record it doesn't
  own. Route 53 answered nothing (an alias to a load balancer that's gone resolves to nothing),
  while `up.sh`'s check only asked "is there an A record?" and passed. Fixes: `up.sh` removes
  a record pointing at any load balancer other than the current one before installing, and
  waits until the record points at *this* load balancer; `down.sh` deletes the record itself
  if ExternalDNS didn't. Lesson: check the *value* you need, not only that something exists,
  and compare what DNS answers (`dig @<authoritative server>`) with what the API says.
- **Why not Terraform for this record:** the ALB's address only exists after the app is
  installed, and changes with every new cluster. A controller that follows the Ingress keeps
  DNS right without a second Terraform run. Teardown order matters again: the record is
  removed after the Ingress and before ExternalDNS itself.

**What would break in production, and how it's handled**

| Risk | Here | Production would add |
| --- | --- | --- |
| Certificate expires | ACM renews automatically (validation record kept) | Alarms on certificate expiry (ACM emits events) |
| Domain lapses | Auto-renew on; registration email verified | Registrar lock, billing alerts, several owners |
| Someone else's record overwritten | ExternalDNS TXT ownership, zone-scoped role | The same, plus separate zones per environment |
| Dangling record after teardown | `sync` policy; `down.sh` waits for the deletion | Periodic checks for records pointing at nothing |
| Weak TLS | TLS 1.2+ policy, redirect, HSTS preload of `.app` | WAF, security headers, TLS to the pods if required |
| Public sign-in costs money | Briefing limits per pilot and overall | Allow-lists, stronger quotas, abuse monitoring |

**Try it** (with the cluster up)

```bash
dig +short NS ofplens.app                      # the four Route 53 name servers
dig +short ofplens.app                         # the load balancer's current IPs
dig +short TXT a-ofplens.app                   # ExternalDNS's ownership record (a- = for the A record)
curl -sI http://ofplens.app | head -3          # 301 to https
curl -sI https://ofplens.app | head -1         # HTTP/2 200
openssl s_client -connect ofplens.app:443 -servername ofplens.app </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates # who issued the certificate, valid until
kubectl --context ofplens-aws logs -n external-dns deploy/external-dns | tail
```

**Interview**

"The domain is in Route 53, and a DNS-validated ACM certificate is managed in a long-lived
Terraform stack, so it auto-renews and survives cluster rebuilds. The ALB terminates TLS 1.2+
on 443 with the certificate discovered from the Ingress host, and redirects 80 to 443.
ExternalDNS keeps the alias record in sync with whatever load balancer currently backs the
Ingress, with TXT-based ownership and a role scoped to the one hosted zone. Teardown removes
the Ingress first, so both the load balancer and the DNS record are cleaned up before the
controllers and the cluster are destroyed."

## Step 6 — Deploy on merge (CI/CD)

**What was built**

- `.github/workflows/deploy.yml`: after CI passes on `main`, build the images on GitHub's
  ARM runner, push them to ECR tagged with the commit, and `helm upgrade` the running app.
- `ofplens-github-deploy`: a second GitHub OIDC role (in bootstrap), far narrower than the
  teardown role, plus an EKS access entry that lets it edit the `ofplens` namespace only.
- `pnpm aws:up` reuses CI's images for a clean checkout instead of building locally.

**Concepts: the pipeline**

- **CI vs CD:** CI (`ci.yml`) answers "is this change good?": lint, types, tests, images,
  kind. CD (`deploy.yml`) answers "ship it": it runs **only after CI passed**
  (`workflow_run`), on the exact commit CI tested (`head_sha`).
- **Build once, deploy that artefact:** the image tag is the commit (`d23f05c`). The same bytes
  go to every environment, and you can always tell which code is running:
  `kubectl get deploy -n ofplens -o wide` shows the tag. Never `latest`: it says nothing, and
  two nodes could pull two different images under it.
- **Immutable tags make re-runs safe:** ECR refuses to overwrite a tag, so the workflow
  checks first and reuses an existing image. Re-running a deploy is harmless (idempotent).
- **Native ARM builds:** the nodes are ARM. Building ARM images on an Intel runner would need
  emulation (QEMU, several times slower). GitHub's ARM runner builds them natively, free for
  public repositories.
- **Push-based vs GitOps:** here GitHub *pushes* the change into the cluster (`helm upgrade`
  from the workflow). The GitOps alternative (Argo CD, Flux) runs *inside* the cluster and
  *pulls*: it watches a git repository and makes the cluster match it. CI then only needs to
  change a version in git, with no cluster credentials. Push is simpler to start; GitOps
  scales better to many clusters and shows drift. Worth naming in interviews.

**Concepts: safe deploys**

- **Rolling update + readiness:** Kubernetes starts new pods, waits until their readiness
  probe passes, and only then stops old ones (`maxUnavailable: 0`). The load balancer's own
  health checks add a second gate. Users never see a gap.
- **Automatic rollback:** `--rollback-on-failure --wait` makes Helm wait for the new pods. If
  they don't become ready in time (crash, bad config, failed migration), Helm reinstalls the
  previous release, and the run fails with the reason. Then `helm history ofplens -n ofplens`
  lists the revisions.
- **Migrations first:** the migrate Job is a pre-upgrade hook, so the schema changes before
  any new API pod starts. A failed migration stops the deploy before anything is replaced. The
  rule that keeps rollbacks possible: migrations must be **backwards compatible** (add
  columns, don't rename or drop in the same release).
- **Smoke test:** after Helm, the workflow calls `https://ofplens.app/api/health` through the
  real load balancer and DNS. That's the user's view, not the cluster's.
- **Rollback options:** `helm rollback` is the fast undo (seconds, previous images). Reverting
  the commit is the durable undo: the next deploy ships the fixed code, and git shows what
  happened.

**Concepts: least privilege for pipelines**

- **Two roles, two jobs:** the teardown role can destroy the stack, so it's broad. The deploy
  role runs on *every merge* and can only push two image repositories, read the cluster's
  address, and edit one namespace. It can't create or delete infrastructure, read the app's
  keys in Secrets Manager, or touch other namespaces. If a workflow were ever compromised, the
  damage is limited to what that role can do (blast radius).
- **Two layers of permission:** IAM decides what the role may do in **AWS**. The EKS access
  entry (`AmazonEKSEditPolicy`, scoped to the namespace) decides what it may do in
  **Kubernetes**. Both have to allow an action.
- **`workflow_run` pitfall:** `branches: [main]` matches the *branch name* of the run that
  triggered it, which could be a fork's PR from a branch called `main`. The workflow also
  checks that the trigger was a `push` to this repository.
- **Queueing:** deploys share a concurrency group, so they never overlap. If several merges
  queue up, GitHub keeps only the newest waiting run, which is the commit you want anyway.

**What would break in production, and how it's handled**

| Risk | Here | Production would add |
| --- | --- | --- |
| Untested code deployed | Deploy waits for CI on the same commit | Required reviews and branch protection |
| Bad release takes the site down | Readiness gates, rolling update, automatic rollback | Canary or blue/green, error-rate alarms |
| Unknown version running | Image tag = commit, run summary | Release notes, deployment tracking (GitHub Environments) |
| Pipeline credentials leaked | OIDC, no keys; narrow role; namespace-scoped access | Required approvals for production, separate accounts |
| Migration breaks the old version on rollback | Pre-upgrade hook stops a failed migration | Expand/contract migrations, tested rollbacks |
| Two deploys at once | Concurrency group | The same |

**Try it** (with a cluster up)

```bash
git commit --allow-empty -m "Deploy test" && git push      # via a PR, as usual; merge it
gh run watch                                               # CI, then Deploy
kubectl --context ofplens-aws get pods -n ofplens -w       # new pods in, old pods out
helm history ofplens -n ofplens --kube-context ofplens-aws # one revision per deploy
kubectl --context ofplens-aws get deploy -n ofplens -o wide   # IMAGES: …:<commit>
```

**Interview**

"Every merge to main triggers a deploy workflow, but only after CI passes on that exact commit.
It authenticates to AWS with GitHub OIDC, using a role that can only push to two ECR
repositories and read the cluster endpoint; inside Kubernetes its access entry is
edit-only and scoped to the app's namespace. Images are built natively on ARM runners and
tagged with the commit SHA, so they're immutable and traceable. The release is a Helm upgrade
with wait and automatic rollback, so new pods must pass readiness before old ones go, and a
failing release reverts itself. Migrations run as a pre-upgrade hook. A smoke test checks the
public endpoint afterwards. It's push-based; for many clusters I'd move to GitOps with Argo CD
so the cluster pulls its desired state and CI needs no cluster credentials."

