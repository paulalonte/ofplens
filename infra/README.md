# Infrastructure (Terraform)

Everything OFP Lens needs on AWS, as code. Deployment plan: [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md),
step 4. What each part teaches: [docs/LEARNING.md](../docs/LEARNING.md), step 4.

| Stack                     | What                                                                | Lifetime                          | Cost                 |
| ------------------------- | ------------------------------------------------------------------- | --------------------------------- | -------------------- |
| [`bootstrap/`](bootstrap) | Budget alarm, S3 bucket for Terraform state, ECR image repositories | Applied once, kept                | Under $1/month       |
| `aws/` (next)             | VPC, EKS, RDS, load balancer controller, External Secrets           | Created and destroyed as you like | Only while it exists |

**You run every `plan` and `apply` yourself**, signed in with your SSO profile. Nothing here
holds credentials, and CI only checks formatting and validity.

## Before each session

```bash
export AWS_PROFILE=ofplens          # every terraform and aws command uses your SSO login
aws sts get-caller-identity         # works? If it says the token expired:
aws sso login
```

## Bootstrap (once)

The stack that creates the state bucket can't keep its state in that bucket before the bucket
exists. So the first apply keeps its state on your Mac, and afterwards it moves into the bucket.

**1. Your values** (the file is git-ignored; your email never goes into git):

```bash
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: budget_email, monthly_budget_usd
```

**2. Plan, read, apply:**

```bash
terraform init
terraform plan        # expect: Plan: 12 to add, 0 to change, 0 to destroy
terraform apply       # shows the plan again; type yes
```

Read the plan before typing `yes`: every `+` is something created on AWS. You should see the
budget, the S3 bucket with its settings (versioning, encryption, public access block,
ownership, lifecycle, policy), and two ECR repositories with their lifecycle policies.

**3. Move the state into the bucket:**

```bash
BUCKET=$(terraform output -raw state_bucket)
# Uncomment the terraform { backend "s3" { ... } } block in backend.tf, then:
terraform init -migrate-state -backend-config="bucket=$BUCKET"
# "Do you want to copy existing state to the new backend?" → yes
terraform plan        # expect: No changes. The state is now read from S3.
rm terraform.tfstate terraform.tfstate.backup
```

From now on, `terraform init` in this folder needs `-backend-config="bucket=$BUCKET"` once per
fresh checkout (it is remembered in `.terraform/`).

**4. Check in the console:**

- Billing → Budgets: `ofplens-monthly` with three alerts.
- S3: `ofplens-tfstate-<account id>` with `bootstrap/terraform.tfstate` in it.
- ECR (eu-central-1): `ofplens-api` and `ofplens-web`, both empty for now.

## Destroying

`bootstrap` is meant to stay. The state bucket has `prevent_destroy`, so `terraform destroy`
stops with an error instead of deleting it. That is deliberate.
