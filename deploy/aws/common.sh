# Shared by up.sh and down.sh (sourced, not run). Finds your account and prepares Terraform.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

REGION=eu-central-1
CLUSTER=ofplens
NAMESPACE=ofplens
CONTEXT=ofplens-aws
TF_DIR=infra/aws

run() { echo "+ $*" >&2; "$@"; }
# Every kubectl and helm command names the context, so it can never hit kind (or work) by accident.
k() { run kubectl --context "$CONTEXT" "$@"; }

if [[ -z "${AWS_PROFILE:-}" && -z "${AWS_ACCESS_KEY_ID:-}" && -z "${AWS_WEB_IDENTITY_TOKEN_FILE:-}" ]]; then
  echo "Set your AWS profile first:  export AWS_PROFILE=ofplens" >&2
  exit 1
fi
if ! ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null); then
  echo "Not signed in to AWS (or the session expired). Run:  aws sso login" >&2
  exit 1
fi
STATE_BUCKET="ofplens-tfstate-$ACCOUNT"
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

# Safe to repeat; only downloads providers and modules the first time.
run terraform -chdir="$TF_DIR" init -input=false -backend-config="bucket=$STATE_BUCKET" >/dev/null

cluster_exists() {
  aws eks describe-cluster --region "$REGION" --name "$CLUSTER" >/dev/null 2>&1
}

use_cluster() {
  run aws eks update-kubeconfig --region "$REGION" --name "$CLUSTER" --alias "$CONTEXT" >/dev/null
}
