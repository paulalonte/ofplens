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

| Part                         | What it is                                                                         | File          |
| ---------------------------- | ---------------------------------------------------------------------------------- | ------------- |
| VPC                          | Your private network in two availability zones; no NAT gateway (saves ~$35/month)  | `network.tf`  |
| EKS                          | Kubernetes; AWS runs the control plane, two ARM worker nodes run your pods         | `eks.tf`      |
| RDS Postgres                 | The database, reachable only from the nodes; **deleted with its data** on teardown | `database.tf` |
| AWS Load Balancer Controller | Turns the chart's Ingress into a load balancer (Traefik's job on kind)             | `addons.tf`   |
| External Secrets             | Copies your keys and the database URL from Secrets Manager into the cluster        | `addons.tf`   |
| Pod Identity                 | Gives those two add-ons exactly the AWS permissions they need, with no keys        | `addons.tf`   |

Then `pnpm aws:up` deploys the same Helm chart as kind, with
[values-aws.yaml](../../deploy/helm/ofplens/values-aws.yaml).

## Before the first time (once)

**1. Apply the bootstrap again.** It gained the `ofplens/app` secret for your keys (about
$0.40/month, kept when the cluster is destroyed) and the GitHub OIDC role for the nightly
teardown (free).

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
cd ../..
gh workflow run nightly-teardown.yml        # a test run now, with nothing to destroy
gh run watch                                # pick the run; it should end green
```

The test run proves GitHub can sign in to AWS and reach the state; its log ends with an empty
leftover check.

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
5. Helm installs the app; the load balancer appears and its address is set as `PUBLIC_URL`.
6. It prints **`OFP Lens … is up: http://ofplens-….elb.amazonaws.com`**.

**Sign-in doesn't work on AWS yet.** Google needs https, and development sign-in is
refused on anything that isn't localhost. You'll see the app and the sign-in page; signing in
comes with a domain in step 5.

## Look around

```bash
kubectl --context ofplens-aws get nodes -o wide          # two ARM nodes, in two zones
kubectl --context ofplens-aws get pods -A                # app, controllers, AWS add-ons
kubectl --context ofplens-aws get ingress -n ofplens     # the load balancer's address
kubectl --context ofplens-aws get externalsecret -n ofplens   # SecretSynced = keys copied
k9s --context ofplens-aws
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

All three must be empty. The database is gone **with its data**: the next session starts with
an empty history.

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

If a run fails (for example a load balancer that won't go away), GitHub emails you. Then check
[If something is left](#if-something-is-left). GitHub pauses scheduled workflows in a public
repository after 60 days without commits; the Actions tab then shows a button to turn it back on.

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

| Symptom                                             | Likely cause and fix                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Not signed in to AWS (or the session expired)`     | `aws sso login`, then run the command again                                                                                   |
| Token expired in the middle of `apply` or `destroy` | `aws sso login` and run it again. Terraform continues where it stopped                                                        |
| `Error acquiring the state lock`                    | Another run is still going (or was killed). Wait; only if you're sure nothing runs: `terraform force-unlock <id>`             |
| `kubectl wait externalsecret…` times out            | `kubectl --context ofplens-aws describe externalsecret ofplens-secrets -n ofplens`: the event says which secret or permission |
| Pods `ImagePullBackOff`                             | `kubectl describe pod`: wrong tag, or an image built for Intel (the nodes are ARM)                                            |
| Address answers `502`/`503` for a few minutes       | Normal right after install: the load balancer's health checks haven't passed yet                                              |
| `Kubernetes cluster unreachable` during `destroy`   | The cluster was deleted outside Terraform. Ask before going further: the fix depends on what's left                           |
