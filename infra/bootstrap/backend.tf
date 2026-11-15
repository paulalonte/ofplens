# Where this stack's own state lives. Chicken and egg: the bucket is created by this stack,
# so the very first apply runs with local state (this block commented out), and afterwards
# the state moves into the bucket. See infra/README.md, "Bootstrap".
#
# terraform {
#   backend "s3" {
#     # The bucket comes from: terraform init -backend-config="bucket=<state_bucket output>"
#     key          = "bootstrap/terraform.tfstate"
#     region       = "eu-central-1"
#     encrypt      = true
#     use_lockfile = true
#   }
# }
