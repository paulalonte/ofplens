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
