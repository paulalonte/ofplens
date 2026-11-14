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
