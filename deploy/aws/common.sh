# Shared by up.sh and down.sh (sourced, not run). Finds your account and prepares Terraform.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

REGION=eu-central-1
CLUSTER=ofplens
DB=ofplens # the RDS instance (var.name in infra/aws)
NAMESPACE=ofplens
CONTEXT=ofplens-aws
TF_DIR=infra/aws
DOMAIN=ofplens.app

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

db_exists() {
  aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB" >/dev/null 2>&1
}

# The database's snapshots (the final one of each session), oldest first, one per line.
db_snapshots() {
  aws rds describe-db-snapshots --region "$REGION" --db-instance-identifier "$DB" \
    --snapshot-type manual --output text \
    --query 'sort_by(DBSnapshots[?Status==`available`], &SnapshotCreateTime)[].DBSnapshotIdentifier' |
    tr '\t' '\n' | sed '/^$/d; /^None$/d'
}

use_cluster() {
  run aws eks update-kubeconfig --region "$REGION" --name "$CLUSTER" --alias "$CONTEXT" >/dev/null
}

# --- DNS: the ofplens.app record that ExternalDNS keeps pointed at the load balancer ----------

ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --max-items 1 \
  --query 'HostedZones[0].Id' --output text)

# The load balancer that ofplens.app points at right now, as a plain host name
# (ofplens-123.eu-central-1.elb.amazonaws.com), or nothing if there is no record.
dns_target() {
  aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --query "ResourceRecordSets[?Name=='$DOMAIN.' && Type=='A'].AliasTarget.DNSName | [0]" \
    --output text | tr 'A-Z' 'a-z' | sed -e 's/^dualstack\.//' -e 's/\.$//' -e 's/^none$//'
}

# The load balancer of the app's Ingress, or nothing while it doesn't exist yet.
lb_host() {
  kubectl --context "$CONTEXT" get ingress ofplens -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null | tr 'A-Z' 'a-z' || true
}

# Deletes the ofplens.app A/AAAA records and ExternalDNS's ownership TXT records next to them.
# Only for records left behind: ExternalDNS never touches records it doesn't own (no TXT), so
# a leftover without its TXT would block it forever (seen on 16 Nov 2026).
remove_dns_records() {
  local sets batch
  sets=$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" --output json \
    --query "ResourceRecordSets[?(Name=='$DOMAIN.' && (Type=='A' || Type=='AAAA')) || ((Name=='a-$DOMAIN.' || Name=='aaaa-$DOMAIN.') && Type=='TXT')]")
  [[ "$sets" == "[]" ]] && return 0
  batch=$(mktemp)
  python3 -c 'import json, sys
print(json.dumps({"Changes": [{"Action": "DELETE", "ResourceRecordSet": r} for r in json.load(sys.stdin)]}))' \
    <<<"$sets" >"$batch"
  run aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --change-batch "file://$batch" >/dev/null
  rm -f "$batch"
}
