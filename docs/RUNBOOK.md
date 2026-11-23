# Runbook: OFP Lens on AWS

What to do, step by step, to run OFP Lens at https://ofplens.app: start and stop it, deploy,
roll back, restore the data, rotate keys, and what to do when the alert fires. For **why**
things are built this way, see [infra/aws/README.md](../infra/aws/README.md) and
[LEARNING.md](LEARNING.md).

OFP Lens is a flight-simulation app with no paying users: nothing here is urgent at 3 a.m. The
point is to practise the habits that matter when it is.

**Conventions**

- Run everything from the repository root, on an up-to-date `main` (`git checkout main && git pull`).
- Every `kubectl` and `helm` command names `--context ofplens-aws`, so it can never hit kind or
  another cluster.
- Secrets are typed only into the AWS console or Grafana, never into chat, git or a command.
- The cluster costs about **$0.25 an hour** while it exists. Stop it when you're done.

---

## 0. Sign in (every time)

```bash
export AWS_PROFILE=ofplens
aws sts get-caller-identity        # your account and role; if it fails:
aws sso login
```

## Quick reference

| I want to…                         | Do                                                                     | Section                    |
| ---------------------------------- | ---------------------------------------------------------------------- | -------------------------- |
| start a session                    | `pnpm aws:up`                                                          | [1](#1-start)              |
| know if it's healthy               | `curl -s https://ofplens.app/api/health`, then the dashboard           | [2](#2-is-it-healthy)      |
| stop it                            | `pnpm aws:down`                                                        | [3](#3-stop)               |
| keep it overnight                  | `gh variable set KEEP_CLUSTER --body true`                             | [3](#3-stop)               |
| ship a change                      | merge the PR; CI deploys it                                            | [4](#4-deploy)             |
| undo a bad deploy now              | `helm rollback ofplens -n ofplens --kube-context ofplens-aws`          | [5](#5-roll-back)          |
| get older data back                | `pnpm aws:down`, then `DB_SNAPSHOT=<name> pnpm aws:up`                 | [6](#6-restore-the-database) |
| replace a key                      | edit the secret in Secrets Manager, force-sync, restart                | [7](#7-rotate-a-key)       |
| react to the 5xx alert             | dashboard → logs → recent deploy?                                      | [8](#8-the-alert-fired-server-errors-above-5-) |

---

## 1. Start

```bash
pnpm aws:up
```

1. Terraform shows its plan and asks. A fresh start creates about 70–75 resources and destroys
   **0**. If the plan wants to destroy something you didn't expect, answer `no` and find out why.
2. It says which snapshot the database is restored from (the last session's data).
3. 15–20 minutes later: `OFP Lens <commit> is up: https://ofplens.app`.

Options: `FRESH_DB=1` (empty database), `DB_SNAPSHOT=<name>` ([6](#6-restore-the-database)),
`NO_MONITORING=1` (no Grafana).

## 2. Is it healthy?

From outside in:

```bash
curl -s https://ofplens.app/api/health                    # {"status":"ok","db":"up"}
kubectl --context ofplens-aws get pods -A | grep -v Running   # only the header line (and Completed jobs)
kubectl --context ofplens-aws top pods -n ofplens         # CPU and memory per pod
```

Then Grafana → **Dashboards → OFP Lens API**: requests coming in, 5xx ratio at 0, p95 latency in
the usual range (most routes well under 0.5 s). Sign in on https://ofplens.app and open a plan.

## 3. Stop

```bash
pnpm aws:down
```

It uninstalls the app (so the controller deletes the load balancer), removes the DNS record,
destroys everything in `infra/aws` after a final database snapshot, keeps the newest three
snapshots, and ends with a **leftover check**. Done when it shows:

```
EKS clusters:
Load balancers:
Databases:
Kept snapshots: ofplens-final-… (the newest one is from just now)
```

If anything is listed, see [infra/aws/README.md, "If something is left"](../infra/aws/README.md#if-something-is-left).

**Overnight:** the nightly teardown stops a forgotten cluster around 08:00 UTC (GitHub starts
scheduled runs late). To keep it for one night: `gh variable set KEEP_CLUSTER --body true`, and
the next morning `gh variable delete KEEP_CLUSTER`.

## 4. Deploy

**Normal path:** merge a PR to `main`. CI runs, then `deploy.yml` pushes images tagged with the
commit to ECR and, if the cluster is up, runs `helm upgrade` (migrations first, then a rolling
update). Watch it:

```bash
gh run list --workflow deploy.yml --limit 3
gh run watch                                       # follow the newest run
helm history ofplens -n ofplens --kube-context ofplens-aws | tail -3   # the new revision
```

If the new pods never become ready, the deploy rolls itself back (`--rollback-on-failure`)
and the run fails: the site keeps serving the previous version.

**Without a new merge:** `gh workflow run deploy.yml` deploys the newest `main` again.

## 5. Roll back

When a deploy made things worse (the alert, errors in the dashboard, a broken page):

```bash
helm history ofplens -n ofplens --kube-context ofplens-aws    # revisions, newest last
helm rollback ofplens -n ofplens --kube-context ofplens-aws   # back to the previous revision
# or to a specific one:  helm rollback ofplens <revision> -n ofplens --kube-context ofplens-aws
kubectl --context ofplens-aws rollout status deploy/ofplens-api -n ofplens
```

Then make it last: **revert** the bad commit on GitHub (the PR's **Revert** button), merge the
revert, and let it deploy. A rollback alone is undone by the next deploy of `main`.

**Careful with migrations:** a rollback brings back the old code, not the old schema.
Migrations only go forward, and the old code must still work with the new schema. That's why
schema changes are made in steps that the previous version can live with (add a column first,
use it in the next release, drop the old one later). A migration that broke data is a restore
([6](#6-restore-the-database)), not a rollback.

## 6. Restore the database

**Every session** already restores: `aws:down` snapshots the data and `aws:up` brings back the
newest snapshot. Nothing to do.

**An older copy** (say a session broke the data):

```bash
pnpm aws:down        # its final snapshot holds the broken data: that's fine, it's just kept
aws rds describe-db-snapshots --region eu-central-1 --db-instance-identifier ofplens \
  --snapshot-type manual --query 'sort_by(DBSnapshots,&SnapshotCreateTime)[].[DBSnapshotIdentifier,SnapshotCreateTime]' --output table
DB_SNAPSHOT=ofplens-final-<id> pnpm aws:up
```

- Only three snapshots are kept, and `aws:down` deletes the oldest. Each extra broken session
  pushes a good copy out, so restore before running more sessions.
- After the restore, the next plain `aws:up` would pick the **newest** snapshot again, which
  is the broken one, until this session's `aws:down` makes a newer, good one.
- To keep a copy for good, copy it under another name (outside the three-copy rotation):
  `aws rds copy-db-snapshot --region eu-central-1 --source-db-snapshot-identifier ofplens-final-<id> --target-db-snapshot-identifier ofplens-keep-<date>`
  (a few cents a month; delete it in the console when you no longer need it).

**Start empty:** `FRESH_DB=1 pnpm aws:up` (the snapshots stay).

## 7. Rotate a key

Do it when a key may have leaked (pasted somewhere, in a log), when someone with access leaves,
or on a schedule. Always: **new key first, switch, check, then revoke the old one.**

| Key                       | New one from                                                     | Goes into                                  |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `ANTHROPIC_API_KEY`       | console.anthropic.com → API keys                                 | Secrets Manager `ofplens/app`              |
| `GOOGLE_CLIENT_SECRET`    | Google Cloud console → Credentials → the OAuth client → add secret | `ofplens/app`                            |
| `GITHUB_CLIENT_SECRET`    | GitHub → Developer settings → OAuth Apps → `OFP Lens` → generate | `ofplens/app`                              |
| Grafana `token`           | grafana.com → Access Policies → `ofplens-cluster` → Add token    | `ofplens/grafana`                          |
| Database password         | nothing to do: every session's database gets a new one           | `ofplens/database` (Terraform writes it)   |

With the cluster up, after saving the new value:

```bash
# The app's keys:
kubectl --context ofplens-aws annotate externalsecret ofplens-secrets -n ofplens force-sync="$(date +%s)" --overwrite
kubectl --context ofplens-aws rollout restart deployment/ofplens-api -n ofplens
# The Grafana token (Alloy rereads the Secret within a minute, no restart):
kubectl --context ofplens-aws annotate externalsecret grafana-cloud -n monitoring force-sync="$(date +%s)" --overwrite
```

Check (a briefing works, sign-in works, the collector's log has no 401), then revoke the old
key where you made it. With the cluster down there's nothing to restart: the next `aws:up`
reads the new value.

---

## 8. The alert fired: server errors above 5 %

The email says what share of API requests failed with 5xx. Work from symptom to cause:

1. **Is it real?** https://ofplens.app: does a page load, can you open a plan? Grafana →
   **OFP Lens API** → "Server error ratio" and "Answers by status".
2. **Where?** "Requests per second, by route" and the logs panel: which route, since when?
   In Explore (Loki):

   ```logql
   {namespace="ofplens", container="api"} | json | res_statusCode >= 500
   {namespace="ofplens", container="api"} | json | level=~"error|fatal"
   ```

   The error line's `err` field usually names the cause.

3. **Did we just deploy?** `gh run list --workflow deploy.yml --limit 3` and
   `helm history ofplens -n ofplens --kube-context ofplens-aws`. A deploy shortly before the
   errors started → **roll back first** ([5](#5-roll-back)), investigate after.
4. **Is the database there?** `curl -s https://ofplens.app/api/health`. `"db":"down"` → AWS
   console → RDS → `ofplens`: status, and **Logs & events**.
5. **Are pods crashing?**

   ```bash
   kubectl --context ofplens-aws get pods -n ofplens            # RESTARTS going up? CrashLoopBackOff?
   kubectl --context ofplens-aws describe pod <pod> -n ofplens   # Last State: OOMKilled = out of memory
   kubectl --context ofplens-aws logs <pod> -n ofplens --previous   # the log of the crashed container
   kubectl --context ofplens-aws get events -n ofplens --sort-by=.lastTimestamp | tail
   ```

6. **Is it someone else?** Errors only on SimBrief imports, weather or briefings usually mean
   the service behind it is down or slow (SimBrief, aviationweather.gov, status.anthropic.com).
   Nothing to roll back; the app shows the pilot a message, and it recovers by itself.
7. **Afterwards:** write down what happened, why, and what would prevent it (a short, blameless
   note in the PR or ticket that fixes it). If this runbook was wrong or missing a step, fix it
   in the same PR.

The alert resolves by itself (with an email) once the error ratio stays under 5 %.

## Other symptoms

| Symptom                                                  | First look                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| https://ofplens.app doesn't answer at all                | Is the cluster up? (`aws eks list-clusters --region eu-central-1`) The nightly teardown may have stopped it. Then [2](#2-is-it-healthy) |
| `502`/`503` from the load balancer                       | Right after a start: normal for a few minutes. Later: no ready API or web pods (`get pods`, then step 5 of [8](#8-the-alert-fired-server-errors-above-5-)) |
| "AI briefings are turned off"                            | `ANTHROPIC_API_KEY` missing from `ofplens/app`: add it, then the commands in [7](#7-rotate-a-key)                                      |
| Briefings fail, the rest works                           | Dashboard → "Briefings in the time range" (`failed`); logs: `{namespace="ofplens", container="api"} \|= "Briefing"`; status.anthropic.com |
| Slow pages                                               | Dashboard → "Latency p95, by route"; `kubectl top pods`; "Event loop delay" rising = the API's thread is busy                           |
| A budget email from AWS                                  | Billing → Cost Explorer by service; is a cluster still running? `pnpm aws:down`; see [3](#3-stop)                                       |
| The nightly teardown failed (email from GitHub)          | `gh run list --workflow nightly-teardown.yml`, `gh run view <id> --log-failed`; then `pnpm aws:down` by hand                          |
| Grafana shows nothing new                                | `kubectl --context ofplens-aws logs -n monitoring deploy/k8s-monitoring-alloy --tail=30`: 401/403 = token, 405 = `logs-url`           |

---

## Drill: practise it once

Deployment step 7 is done when you can do all of this from this page alone. One session,
about an hour:

- [ ] **Start** ([1](#1-start)) and check health ([2](#2-is-it-healthy)). Note which snapshot was restored.
- [ ] **Monitoring:** import the dashboard and create the alert (infra/aws/README.md,
      "The API's own metrics, dashboard and alert"). Use the app; watch the panels move.
- [ ] **Incident:** make the alert fire with 401s (same README section), then go through
      [8](#8-the-alert-fired-server-errors-above-5-) as if it were real. Put it back to `5..`.
- [ ] **Deploy and roll back:** `gh workflow run deploy.yml`, wait for it, see the new revision
      in `helm history`, then `helm rollback` to the one before ([5](#5-roll-back)) and check
      the site still works.
- [ ] **Data:** import a plan, `pnpm aws:down` ([3](#3-stop)), `pnpm aws:up`: the plan is
      still there ([6](#6-restore-the-database)).
- [ ] **Stop** and check the leftover list is empty.

Anything unclear or wrong on the way: fix this page.
