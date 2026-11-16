#!/usr/bin/env bash
# Deletes the AWS cluster and everything in infra/aws (the database and its data included).
# Keeps infra/bootstrap: the budget, the state bucket, the image repositories, your app keys.
#
#   export AWS_PROFILE=ofplens
#   pnpm aws:down
#
# The order matters. The load balancer is created by a controller inside the cluster, not by
# Terraform, so the app is uninstalled first: the controller sees its Ingress go and deletes the
# load balancer. Destroying the cluster first would leave the load balancer running (and billed)
# with nothing left to delete it.
#
# AUTO_APPROVE=1 skips Terraform's "yes" prompt (for the nightly teardown in CI).
source "$(dirname "$0")/common.sh"

# 1. The app and its load balancer.
if cluster_exists; then
  use_cluster
  if helm status ofplens --kube-context "$CONTEXT" -n "$NAMESPACE" >/dev/null 2>&1; then
    run helm uninstall ofplens --kube-context "$CONTEXT" -n "$NAMESPACE" --wait --timeout 10m
  fi
  k delete namespace "$NAMESPACE" --ignore-not-found --wait --timeout=5m
fi

# ExternalDNS deletes the DNS record when the Ingress goes. Give it the time to do so before
# Terraform removes ExternalDNS itself (otherwise ofplens.app would point at nothing).
ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --max-items 1 \
  --query 'HostedZones[0].Id' --output text)
echo "Checking that the $DOMAIN record is gone..." >&2
for _ in $(seq 18); do
  [[ "$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --query "length(ResourceRecordSets[?Name=='$DOMAIN.' && Type=='A'])" --output text)" == 0 ]] && break
  sleep 10
done

echo "Checking that the load balancer is gone..." >&2
for _ in $(seq 60); do
  aws elbv2 describe-load-balancers --region "$REGION" --names ofplens >/dev/null 2>&1 || break
  sleep 5
done
if aws elbv2 describe-load-balancers --region "$REGION" --names ofplens >/dev/null 2>&1; then
  echo "The load balancer 'ofplens' still exists after 5 minutes. Stopping before Terraform, so" >&2
  echo "the controller can still delete it. See infra/aws/README.md, 'If something is left'." >&2
  exit 1
fi

# 2. Everything Terraform created: the add-ons, the cluster, the database, the network.
#    Takes 10-15 minutes.
if [[ "${AUTO_APPROVE:-}" == 1 ]]; then
  run terraform -chdir="$TF_DIR" destroy -input=false -auto-approve
else
  run terraform -chdir="$TF_DIR" destroy
fi

# 3. What is left that costs money? All three should be empty.
kubectl config delete-context "$CONTEXT" >/dev/null 2>&1 || true
CLUSTERS=$(aws eks list-clusters --region "$REGION" --query 'clusters' --output text)
LBS=$(aws elbv2 describe-load-balancers --region "$REGION" --query 'LoadBalancers[].LoadBalancerName' --output text)
DBS=$(aws rds describe-db-instances --region "$REGION" --query 'DBInstances[].DBInstanceIdentifier' --output text)
echo
echo "Leftover check:"
echo "  EKS clusters:   $CLUSTERS"
echo "  Load balancers: $LBS"
echo "  Databases:      $DBS"
if [[ -n "$CLUSTERS$LBS$DBS" ]]; then
  echo "Something is still running (and billed). See infra/aws/README.md, 'If something is left'." >&2
  exit 1
fi
