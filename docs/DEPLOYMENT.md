# OFP Lens — Deployment plan

How OFP Lens goes from running on one Mac to running on AWS, with Kubernetes, Helm and
Terraform. It replaces the CDK + Fargate plan of PLAN.md Phase 3b. The goal is the app online
**and** learning these tools, so each step says what you do yourself and what you learn.

**Who does what**

- **You:** anything with accounts, passwords, keys, payment or money: creating the AWS account,
  logging in, buying the domain, pasting the Claude key into AWS, and running `terraform apply`.
- **Claude:** the code (Dockerfiles, Helm chart, Terraform, CI), the tests and step-by-step
  instructions. Claude never sees your AWS credentials or API keys, and asks before anything
  that creates AWS resources or costs money.

**Order at a glance**

| Step | What                                  | Where           | Cost                        |
| ---- | ------------------------------------- | --------------- | --------------------------- |
| 0    | Prepare tools and accounts            | Your Mac        | Free                        |
| 1    | Containers                            | Your Mac        | Free                        |
| 2    | Kubernetes + Helm on kind             | Your Mac        | Free                        |
| 3    | Logins and multiple pilots            | Code            | Free                        |
| 4    | AWS foundation with Terraform (EKS)   | AWS             | ~$0.20/hour while up        |
| 5    | Domain and HTTPS                      | AWS             | Domain ~$10–20/year         |
| 6    | Deploy on merge (CI/CD)               | GitHub + AWS    | Free (GitHub Actions)       |
| 7    | Operations and safety nets            | AWS             | Small                       |
| 8    | Always-on server for students (later) | AWS (k3s, EC2)  | ~$15–25/month               |

Steps 1–3 cost nothing and need no AWS account, so they can start now.

---

## Step 0 — Prepare

Tools on your Mac (Homebrew, Docker Desktop and `kubectl` are already installed):

```bash
brew install helm kind k9s
```

Before step 4 (AWS):

1. Create an AWS account with your own email and a payment method.
2. Turn on MFA for the root user, then stop using root day to day.
3. In IAM Identity Center, create an admin user for yourself, with MFA.
4. In the billing settings, allow IAM access to billing, billing alerts and Cost Explorer.
5. Install the AWS tools: `brew install awscli terraform`.
6. Decide the region (close to you and your students; eu-central-1 was the earlier choice).
7. Decide the monthly budget alarm (about $20) and the email it goes to.

Before step 5 (HTTPS): choose the domain name.

Before sharing with anyone: SimBrief's reply about their terms, and step 3 done.

---

## Step 1 — Containers

**Claude builds**

- An API image: multi-stage build on Node 24, only production dependencies, runs as a
  non-root user, `/api/health` for health checks.
- A web image: the Vite build served by a small web server.
- Migrations as their own command, so they run once per deploy, not in every API pod.
- Images for both `amd64` (your Mac, kind) and `arm64` (cheaper Graviton nodes on AWS).
- `docker compose --profile app up`: the whole app from the images, next to Postgres.
- CI builds the images on every PR, so a broken Dockerfile is caught early.

**You do:** run the app from the images and open it in the browser; look at the image sizes
and layers (`docker images`, `docker history`).

**You learn:** images and layers, multi-stage builds, why containers run as non-root.

**Done when:** the whole app runs from the images locally, and CI builds them.

---

## Step 2 — Kubernetes and Helm on kind

**Claude builds** a Helm chart in `deploy/helm/ofplens`:

- Deployments and Services for the API and the web app, with readiness and liveness probes,
  CPU/memory requests and limits.
- An Ingress: `/api` to the API, everything else to the web app.
- The migration as a Job that runs before each install or upgrade (a Helm hook).
- Settings in a ConfigMap, secrets (database URL, Claude key) in a Kubernetes Secret.
- `values-kind.yaml` with a small Postgres inside the cluster; on AWS the chart uses RDS
  instead.

**You do:**

```bash
kind create cluster --name ofplens
helm install ofplens deploy/helm/ofplens -f deploy/helm/ofplens/values-kind.yaml
kubectl get pods
k9s
```

Then try: read logs, delete a pod and watch it come back, change the image tag and run
`helm upgrade`, roll back with `helm rollback`, and remove it all with `helm uninstall`.

**You learn:** pods, deployments, services, ingress, config and secrets, jobs, Helm values,
upgrades and rollbacks.

**Done when:** the app works through the ingress on kind, an upgrade replaces pods without
downtime, and `helm uninstall` leaves nothing behind.

---

## Step 3 — Logins and multiple pilots

Today the app has one pilot and no login. Before anyone else uses it:

**You decide** how pilots sign in. Options (Claude gives a recommendation when we get there):

- **AWS Cognito:** more AWS learning; AWS stores the passwords.
- **Sign in with Google or GitHub:** simplest for pilots.
- **Email magic link:** no passwords at all.

**Claude builds**

- Sign-in and sign-out, and every plan, briefing and setting belonging to one pilot.
- A test that one pilot can never read or delete another pilot's plans.
- A daily limit of AI briefings per pilot, so the Claude bill stays predictable.
- Rate limits on the endpoints that call SimBrief, aviationweather.gov and Claude.

**Done when:** two pilots each see only their own plans, and the limits are tested.

---

## Step 4 — AWS foundation with Terraform

**You do first:** step 0's AWS items, then log in on your Mac:

```bash
aws configure sso
aws sts get-caller-identity
```

**Claude builds** Terraform in `infra/`, in two parts:

- `infra/bootstrap` (applied once, kept): the S3 bucket for Terraform's state, the budget
  alarm, and the ECR repositories for the images. It costs about $1–2/month.
- `infra/aws` (created and destroyed as you like):
  - a VPC with public subnets for the nodes and private subnets for the database; no NAT
    gateway (it would cost ~$35/month on its own)
  - an EKS cluster with two small `t4g` (Graviton) nodes
  - RDS Postgres (`db.t4g.micro`), reachable only from the cluster
  - IAM roles for service accounts (IRSA), so pods get AWS permissions without keys
  - the AWS Load Balancer Controller (turns the Ingress into an Application Load Balancer)
  - External Secrets, which copies the secrets from AWS Secrets Manager into Kubernetes

**You do:**

1. `terraform init`, then `terraform plan`; read what it will create and what it costs.
2. `terraform apply` (Claude asks you first; this is the step that starts the bill).
3. In the AWS console, paste the production Claude key into its Secrets Manager entry.
   Create a separate key for production in the Anthropic console, with a monthly spend limit.
4. `helm install` with `values-aws.yaml`; open the load balancer's address.
5. When you're done for the day: `terraform destroy` in `infra/aws`.

**You learn:** Terraform state, plan and apply, modules; VPCs and security groups; EKS; IAM
roles for pods; how a Kubernetes Ingress becomes an AWS load balancer.

**Done when:** the app runs on the load balancer's address, and `terraform destroy` removes
everything except the bootstrap part.

---

## Step 5 — Domain and HTTPS

**You do:** buy the domain in Route 53 (about $10–20/year, depending on the ending).

**Claude builds:** the DNS records and a free ACM certificate in Terraform, HTTPS on the load
balancer with HTTP redirected to it, and DNS kept up to date when the cluster is recreated.

**Done when:** `https://<your domain>` opens the app, and `http://` redirects to it.

---

## Step 6 — Deploy on merge (CI/CD)

**Claude builds**

- A GitHub OIDC role in Terraform: GitHub Actions gets short-lived AWS access for this
  repository only, so no AWS keys are stored in GitHub.
- A workflow on each merge to `main`: build the images, tag them with the commit, push them to
  ECR, and `helm upgrade` the cluster when it is up (skipped when it is not).

**You do:** add the role's ARN as a repository variable (it is not a secret), and approve the
first deploy.

**Done when:** a merge to `main` reaches the running app with no manual step.

---

## Step 7 — Operations and safety nets

**Claude builds**

- A nightly job that destroys the cluster unless you marked it to stay up, so a forgotten
  cluster costs one night, not a month.
- A database snapshot before each destroy, restored on the next create, so the flight history
  survives (snapshot storage costs cents).
- Logs you can search (CloudWatch), and cluster metrics (`kubectl top`).
- A short runbook: start, stop, deploy, roll back, restore the database, rotate the Claude key.

**You do:** practise the runbook once: destroy, create, restore, roll back.

**Done when:** you can bring the app up and down from the runbook alone, and the budget alarm
and nightly teardown are tested.

---

## Step 8 — Always-on server for students (later)

EKS stays the disposable practice cluster. For students, one small EC2 instance runs k3s (a
lightweight Kubernetes) with the **same Helm chart**, always on, for about $15–25/month.

Needs first: SimBrief's reply, step 3 (logins), and steps 4–7 working.

---

## Costs

| What                            | When                    | About             |
| ------------------------------- | ----------------------- | ----------------- |
| EKS cluster, nodes, RDS, ALB    | Only while it is up     | $0.20/hour        |
| State bucket, ECR, snapshots    | Always                  | $1–2/month        |
| Domain                          | Yearly                  | $10–20/year       |
| Claude (production key)         | Per briefing            | ~$0.003 (Haiku)   |
| A learning month (a few hours a week) | —                 | $7–15/month       |
| A cluster forgotten for a month | Prevented by step 7     | ~$145             |

The budget alarm (step 0 and step 4) emails you before any of this gets out of hand.
