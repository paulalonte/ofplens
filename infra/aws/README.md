# OFP Lens on AWS (the cluster)

Everything in this folder **costs money by the hour while it exists**. It's built to be created
for a session and destroyed afterwards. What it teaches: [docs/LEARNING.md](../../docs/LEARNING.md),
step 4b. The kept, cheap part (budget, state bucket, image repositories, your app keys) is
[infra/bootstrap](../bootstrap).

## Cost: read this first

| While the cluster exists                            | Per hour   |
| --------------------------------------------------- | ---------- |
| EKS control plane                                   | $0.10      |
| 2 worker nodes (t4g.medium)                         | ~$0.08     |
| Load balancer (ALB)                                 | ~$0.03     |
| Database (RDS db.t4g.micro + 20 GB)                 | ~$0.02     |
| Public IPv4 addresses (nodes, load balancer), disks | ~$0.03     |
| **Total**                                           | **~$0.25** |

| If you…                     | It costs  |
| --------------------------- | --------- |
| use it for a 3-hour session | ~$0.75    |
| forget it for a day         | ~$6       |
| forget it for a month       | **~$180** |

**The $20 budget does not stop anything.** It only emails you. What stops the bill:

1. **`pnpm aws:down`** at the end of every session (you).
2. **The nightly teardown** at 01:00 UTC: a GitHub Actions job that runs the same script, in
   case you forgot ([below](#nightly-teardown)). Worst case, a forgotten cluster costs one
   evening (~$1–2), not a month.

Is anything running right now?

```bash
aws eks list-clusters --region eu-central-1      # "clusters": []  → nothing expensive is running
```

## What gets created

| Part                         | What it is                                                                               | File          |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ------------- |
| VPC                          | Your private network in two availability zones; no NAT gateway (saves ~$35/month)        | `network.tf`  |
| EKS                          | Kubernetes; AWS runs the control plane, two ARM worker nodes run your pods               | `eks.tf`      |
| RDS Postgres                 | The database, reachable only from the nodes; snapshotted on teardown, restored on create | `database.tf` |
| AWS Load Balancer Controller | Turns the chart's Ingress into a load balancer (Traefik's job on kind)                   | `addons.tf`   |
| External Secrets             | Copies your keys and the database URL from Secrets Manager into the cluster              | `addons.tf`   |
| ExternalDNS                  | Points `ofplens.app` at the load balancer in Route 53, and removes it on teardown        | `addons.tf`   |
| metrics-server               | Live CPU and memory of nodes and pods, for `kubectl top` and k9s                         | `eks.tf`      |
| Pod Identity                 | Gives those three add-ons exactly the AWS permissions they need, with no keys            | `addons.tf`   |

Then `pnpm aws:up` deploys the same Helm chart as kind, with
[values-aws.yaml](../../deploy/helm/ofplens/values-aws.yaml).

## Before the first time (once)

**1. Apply the bootstrap again.** It gained the `ofplens/app` secret for your keys (about
$0.40/month, kept when the cluster is destroyed), the GitHub OIDC role for the nightly
teardown (free), and the certificate for `ofplens.app` (free; OFP-46, 4 more to add: the
certificate, two validation records, and the wait for it to be issued, a few minutes). The
domain's registration must be complete first (Route 53 → Registered domains).

```bash
export AWS_PROFILE=ofplens
cd infra/bootstrap
terraform init -backend-config="bucket=ofplens-tfstate-$(aws sts get-caller-identity --query Account --output text)"
terraform plan        # expect: 7 to add (secret + first value, OIDC provider, role + 3 policies)
terraform apply
```

**2. Switch on the nightly teardown** before the first cluster exists. Still in
`infra/bootstrap`, store the role as a GitHub secret (piped, so the ARN with your account id
is never printed or pasted):

```bash
terraform output -raw github_teardown_role_arn | gh secret set AWS_TEARDOWN_ROLE_ARN
terraform output -raw github_deploy_role_arn | gh secret set AWS_DEPLOY_ROLE_ARN    # OFP-47
cd ../..
gh workflow run nightly-teardown.yml        # a test run now, with nothing to destroy
gh run watch                                # pick the run; it should end green
gh workflow run deploy.yml                  # builds and pushes this commit's images, no cluster to deploy to
```

The teardown test proves GitHub can sign in to AWS and reach the state; its log ends with an
empty leftover check. The deploy test ends with "No running app: images … are pushed".

**3. Tools:** Docker Desktop running, plus `kubectl` and `helm` (you have them from kind).

**4. Your keys (optional now).** Without any, the app runs but AI briefings are off and there's no
sign-in button. To add the Claude key, see [Add or change your keys](#add-or-change-your-keys).
Create a **separate key for AWS** in the Anthropic console, with a **monthly spend limit**,
so it can be revoked without touching your local one.

## Start a session

```bash
export AWS_PROFILE=ofplens
aws sso login                       # if the token expired
pnpm aws:up
```

What happens (each command is printed before it runs):

1. **`terraform apply`** shows the plan and waits for **`yes`**. Read it first: dozens of
   resources, most of them small (subnets, routes, IAM roles, security group rules). **This
   is the moment the bill starts.** The first apply takes **15–20 minutes** (EKS and RDS are
   slow to create).
2. Your kubeconfig gets a context **`ofplens-aws`**.
3. The two images are built for ARM and pushed to ECR with a new tag.
4. External Secrets creates the app's Secret.
5. Helm installs the app; the load balancer appears (HTTPS with the certificate from
   bootstrap).
6. ExternalDNS points `ofplens.app` at it; the script waits for the record, then for the site.
7. It prints **`OFP Lens … is up: https://ofplens.app`**.

Don't open `ofplens.app` before step 7: asking DNS for the name before the record exists makes
your Mac (or your router) remember "no such address" for a while. If it happens anyway, wait
a few minutes, or flush your Mac's DNS cache:
`sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`.

**Sign-in** works once the Google and GitHub keys for `ofplens.app` are in `ofplens/app`
([Sign-in on AWS](#sign-in-on-aws)). Development sign-in stays off on AWS.

## Look around

```bash
kubectl --context ofplens-aws get nodes -o wide          # two ARM nodes, in two zones
kubectl --context ofplens-aws get pods -A                # app, controllers, AWS add-ons
kubectl --context ofplens-aws get ingress -n ofplens     # the load balancer's address
kubectl --context ofplens-aws get externalsecret -n ofplens   # SecretSynced = keys copied
kubectl --context ofplens-aws top nodes                  # CPU and memory per node (metrics-server)
kubectl --context ofplens-aws top pods -A --sort-by=memory
k9s --context ofplens-aws                                # :pods shows CPU and MEM columns too
```

In the AWS console (region **eu-central-1**): **EKS** → Clusters → `ofplens`; **EC2** →
Instances (the two nodes) and → Load Balancers (`ofplens`); **RDS** → Databases; **Secrets
Manager**.

## End the session

```bash
pnpm aws:down
```

It uninstalls the app first and waits until the load balancer is gone, then runs
**`terraform destroy`** (type **`yes`**; 10–15 minutes), and finally lists what's left.
Expected:

```
Leftover check:
  EKS clusters:
  Load balancers:
  Databases:
```

The first three must be empty. Before deleting the database, Terraform takes a **final
snapshot** of it, so the flight history comes back with the next `pnpm aws:up`
([below](#your-data-between-sessions)).

## Your data between sessions

The database server is deleted every session; its data isn't:

1. `pnpm aws:down`: `terraform destroy` takes a final snapshot (`ofplens-final-<random>`, a few
   extra minutes), then deletes the database. The script keeps the newest **three** snapshots
   and deletes older ones.
2. `pnpm aws:up`: if no database exists, Terraform creates it from the newest snapshot. The
   plan shows `snapshot_identifier = "ofplens-final-…"`. The app's migrations then run as usual,
   so a snapshot from an older version is brought up to date.

Snapshots cost about $0.095 per GB-month for the data in them, not the 20 GB disk: a few cents.

| You want…                         | Do                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| to see the snapshots              | `aws rds describe-db-snapshots --db-instance-identifier ofplens --query 'DBSnapshots[].[DBSnapshotIdentifier,SnapshotCreateTime]' --output table` |
| an empty database for one session | `FRESH_DB=1 pnpm aws:up` (the snapshots are kept)                                                                                                 |
| an older snapshot                 | with no database running: `terraform -chdir=infra/aws apply -var db_snapshot=<name>`, then `pnpm aws:up`                                          |
| to delete the history for good    | `aws rds delete-db-snapshot --db-snapshot-identifier <name>`, for each one                                                                        |

The snapshot is used **only when the database is created**. A newer snapshot never replaces a
running database (`ignore_changes` in `database.tf`).

A cluster created before this change has `skip_final_snapshot = true` in its state, and
`terraform destroy` follows the state: run `pnpm aws:up` once more before `aws:down` to update
it, or that session's data is not kept.

## Look at the database (Drizzle Studio)

The database is private: only the cluster's nodes can reach it, not your Mac or the internet.
To browse it, open a temporary tunnel through the cluster, then close it again:

```
Your Mac :15432 ──kubectl port-forward──▶ db-tunnel pod (socat) ──▶ RDS :5432
```

Run these from the repo root, with `export AWS_PROFILE=ofplens` and the cluster up.

**Open**

1. A small pod that passes connections through to RDS:

   ```bash
   kubectl --context ofplens-aws run db-tunnel -n ofplens --image=alpine/socat --restart=Never -- tcp-listen:5432,fork,reuseaddr "tcp-connect:$(aws rds describe-db-instances --region eu-central-1 --db-instance-identifier ofplens --query 'DBInstances[0].Endpoint.Address' --output text):5432"
   ```

2. Your Mac's port 15432 to that pod. Leave it running in its own terminal tab:

   ```bash
   kubectl --context ofplens-aws port-forward -n ofplens pod/db-tunnel 15432:5432
   ```

3. Drizzle Studio against RDS, in another tab. The URL comes from Secrets Manager with the host
   swapped for the tunnel. The password is never printed, and `DATABASE_URL` is set for this
   one command only:

   ```bash
   DATABASE_URL="$(aws secretsmanager get-secret-value --region eu-central-1 --secret-id ofplens/database --query SecretString --output text | python3 -c 'import json,sys,re; print(re.sub(r"@[^/]+/", "@localhost:15432/", json.load(sys.stdin)["DATABASE_URL"]))')" pnpm db:studio
   ```

   Then open https://local.drizzle.studio. Any Postgres client (TablePlus, `psql`) works through
   the same tunnel on `localhost:15432`.

**Close** (as soon as you're done)

1. Ctrl+C in Studio's tab and in the port-forward's tab.
2. Delete the pod:

   ```bash
   kubectl --context ofplens-aws delete pod db-tunnel -n ofplens
   ```

3. Check that nothing is left. The first command should list only `ofplens-api-…` and
   `ofplens-web-…`; the second should print nothing:

   ```bash
   kubectl --context ofplens-aws get pods -n ofplens
   lsof -i :15432
   ```

**Careful**

- This is the live database behind ofplens.app. Browsing is safe; edits and deletes in Studio
  are real.
- Never `export` that `DATABASE_URL`: a later `pnpm db:migrate` or test in the same shell would
  run against RDS. The one-command form above avoids that.
- Forgotten? The port-forward ends with its terminal, and the nightly teardown deletes the pod
  with the cluster. Still, close it straight away.
- The same port-forward works from k9s (`Shift+F` on the pod) or Freelens/OpenLens (the pod's
  Forward button), once the `db-tunnel` pod exists.

## Deploy on merge

[.github/workflows/deploy.yml](../../.github/workflows/deploy.yml) runs after CI passes on
`main` (every merge):

1. builds the api and web images on GitHub's ARM runner and pushes them to ECR, tagged with the
   commit (`d23f05c`). A re-run reuses them: tags can't be overwritten.
2. if the cluster is up **and** the app is installed, `helm upgrade` to those images: a rolling
   update of `ofplens.app`, followed by a health check. With no cluster it stops after step 1.

`pnpm aws:up` on a clean checkout of `main` then finds those images and skips the local build.

It signs in with its own role, `ofplens-github-deploy`, which is much narrower than the
teardown role: push to the two image repositories, find the cluster, and inside Kubernetes
edit the `ofplens` namespace only. It can't create or delete infrastructure.

| You want…                       | Do                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| to deploy without a new merge   | `gh workflow run deploy.yml` (deploys the newest commit on `main`)                   |
| to see what was deployed        | `gh run list --workflow deploy.yml`; each run's summary names the commit             |
| to undo a bad deploy right away | `helm rollback ofplens -n ofplens --kube-context ofplens-aws` (the previous release) |
| to undo it for good             | revert the commit on GitHub and merge: the next deploy ships the fixed version       |

A deploy whose new pods never become ready rolls itself back (`--rollback-on-failure`), so
the site keeps serving the previous version and the run fails with the reason.

## Nightly teardown

[.github/workflows/nightly-teardown.yml](../../.github/workflows/nightly-teardown.yml) runs
`deploy/aws/down.sh` every night at 01:00 UTC (02:00 German winter time), and can be started by
hand: GitHub → Actions → Nightly teardown → Run workflow. It signs in through GitHub OIDC: no
AWS keys are stored in GitHub, only the role's ARN, and the role trusts only workflows on
`main` of this repository.

| You want…                         | Do                                                                     |
| --------------------------------- | ---------------------------------------------------------------------- |
| to keep the cluster for one night | `gh variable set KEEP_CLUSTER --body true`                             |
| the nightly teardown back         | `gh variable delete KEEP_CLUSTER` (do it the next morning)             |
| to see last night's run           | `gh run list --workflow nightly-teardown.yml`, then `gh run view <id>` |

The nightly teardown takes the same final snapshot, so a session it ends keeps its data too.

If a run fails (for example a load balancer that won't go away), GitHub emails you. Then check
[If something is left](#if-something-is-left). GitHub pauses scheduled workflows in a public
repository after 60 days without commits; the Actions tab then shows a button to turn it back on.

## Sign-in on AWS

`https://ofplens.app` needs its own callback URLs at Google and GitHub (one-time, by you; the
secrets never go into chat or git):

- **Google** ([Cloud console](https://console.cloud.google.com/) → APIs & Services →
  Credentials → your OAuth client): add the authorized redirect URI
  `https://ofplens.app/api/auth/google/callback`. The same client works locally and on AWS.
  While the consent screen is in **Testing**, only the test users you listed can sign in.
- **GitHub** (Settings → Developer settings → OAuth Apps → **New OAuth App**): GitHub allows one
  callback per app, so make a second one, `OFP Lens`, with homepage `https://ofplens.app` and
  callback `https://ofplens.app/api/auth/github/callback`. Generate a client secret.

Then put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET` into `ofplens/app` ([next section](#add-or-change-your-keys)). Anyone with
a GitHub account can then sign in while the cluster is up; the per-pilot and global briefing
limits cap what that costs in Claude usage.

## Add or change your keys

1. Console → **Secrets Manager** → `ofplens/app` → **Retrieve secret value** → **Edit**.
2. Add key/value rows. The names are the same as in `.env`:
   `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`,
   `GITHUB_CLIENT_SECRET`. Save.
3. If the cluster is running, copy them in now (otherwise External Secrets checks again within the hour), and restart the API so it reads them:

   ```bash
   kubectl --context ofplens-aws annotate externalsecret ofplens-secrets -n ofplens force-sync="$(date +%s)" --overwrite
   kubectl --context ofplens-aws rollout restart deployment/ofplens-api -n ofplens
   ```

Don't paste keys into chat, a file in git or a terminal command; the console is the only place
they're typed.

## If something is left

`aws:down` stops before `terraform destroy` if the load balancer doesn't disappear. Find
anything the controller made (it's tagged):

```bash
aws resourcegroupstaggingapi get-resources --region eu-central-1 \
  --tag-filters Key=ManagedBy,Values=aws-load-balancer-controller \
  --query 'ResourceTagMappingList[].ResourceARN'
```

If the cluster still exists, run `pnpm aws:down` again. If the cluster is already gone but a
load balancer is left, delete it in the console (EC2 → Load Balancers → `ofplens` → Delete),
then its target groups (EC2 → Target Groups, names starting `k8s-ofplens`), then run
`pnpm aws:down` again.

To see everything the project still costs: **Billing → Cost Explorer**, filter by tag
`Project = ofplens` (cost data appears about a day later).

## When things go wrong

| Symptom                                                               | Likely cause and fix                                                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Not signed in to AWS (or the session expired)`                       | `aws sso login`, then run the command again                                                                                                  |
| Token expired in the middle of `apply` or `destroy`                   | `aws sso login` and run it again. Terraform continues where it stopped                                                                       |
| `Error acquiring the state lock`                                      | Another run is still going (or was killed). Wait; only if you're sure nothing runs: `terraform force-unlock <id>`                            |
| `kubectl wait externalsecret…` times out                              | `kubectl --context ofplens-aws describe externalsecret ofplens-secrets -n ofplens`: the event says which secret or permission                |
| Pods `ImagePullBackOff`                                               | `kubectl describe pod`: wrong tag, or an image built for Intel (the nodes are ARM)                                                           |
| Address answers `502`/`503` for a few minutes                         | Normal right after install: the load balancer's health checks haven't passed yet                                                             |
| `up.sh` stops: `ofplens.app points at '…', not the load balancer '…'` | ExternalDNS couldn't create the record. Its log says why: `kubectl --context ofplens-aws logs -n external-dns deploy/external-dns --tail=20` |
| `Kubernetes cluster unreachable` during `destroy`                     | The cluster was deleted outside Terraform. Ask before going further: the fix depends on what's left                                          |
