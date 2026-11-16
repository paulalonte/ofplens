#!/usr/bin/env bash
# Creates the AWS cluster (infra/aws) and deploys OFP Lens on it (docs/DEPLOYMENT.md, step 4).
# Safe to run again: Terraform changes only what differs, and the app is upgraded.
#
#   export AWS_PROFILE=ofplens
#   pnpm aws:up       → https://ofplens.app   (costs ~$0.25/hour until pnpm aws:down)
#
# Each step prints the command it runs, so you can also run them one by one.
source "$(dirname "$0")/common.sh"

# 1. The infrastructure. Shows the plan and asks before changing anything (type yes).
#    The first run takes 15-20 minutes (the cluster and the database).
run terraform -chdir="$TF_DIR" apply

use_cluster

# 2. The images. Every merge to main already has them in ECR, built by CI (deploy.yml) and
#    tagged with the commit. On a clean checkout of such a commit, use those: the exact images
#    CI tested, and no local build. Otherwise (local changes, or a commit CI hasn't built) build
#    them here for ARM (the t4g nodes), with a timestamp so every build gets its own tag.
COMMIT="$(git rev-parse --short=7 HEAD)"
image_exists() {
  aws ecr describe-images --region "$REGION" --repository-name "ofplens-$1" \
    --image-ids imageTag="$COMMIT" >/dev/null 2>&1
}
if [[ -z "$(git status --porcelain --untracked-files=no)" ]] && image_exists api && image_exists web; then
  TAG="$COMMIT"
  echo "Using the images CI built for $COMMIT (no local build)." >&2
else
  TAG="$COMMIT-$(date +%Y%m%d%H%M%S)"
  echo "+ aws ecr get-login-password | docker login $REGISTRY" >&2
  aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
  for part in api web; do
    run docker build --platform linux/arm64 --target "$part" -t "$REGISTRY/ofplens-$part:$TAG" .
    run docker push "$REGISTRY/ofplens-$part:$TAG"
  done
fi

# 3. The app's Secret, copied from Secrets Manager by External Secrets.
k create namespace "$NAMESPACE" --dry-run=client -o yaml | k apply -f -
k apply -f deploy/aws/external-secret.yaml
k wait externalsecret/ofplens-secrets -n "$NAMESPACE" --for=condition=Ready --timeout=120s

# 4. The app, at https://ofplens.app (api.publicUrl and ingress.host in values-aws.yaml).
run helm upgrade --install ofplens deploy/helm/ofplens --kube-context "$CONTEXT" \
  --namespace "$NAMESPACE" -f deploy/helm/ofplens/values-aws.yaml \
  --set image.registry="$REGISTRY" --set image.tag="$TAG" --wait --timeout 10m

echo
k get pods -n "$NAMESPACE" -o wide
echo

# 5. DNS. ExternalDNS writes ofplens.app → load balancer once the load balancer exists. Wait for
#    the record in Route 53's API before asking DNS for the name: asking too early makes DNS
#    resolvers remember "no such record" for a while (negative caching).
echo "Waiting for ExternalDNS to create the $DOMAIN record (a new load balancer takes a few minutes)..." >&2
ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --max-items 1 \
  --query 'HostedZones[0].Id' --output text)
record_exists() {
  [[ "$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --query "length(ResourceRecordSets[?Name=='$DOMAIN.' && Type=='A'])" --output text)" != 0 ]]
}
for _ in $(seq 60); do
  record_exists && break
  sleep 10
done
record_exists || { echo "No DNS record after 10 minutes: kubectl --context $CONTEXT logs -n external-dns deploy/external-dns" >&2; exit 1; }

echo "Waiting for https://$DOMAIN/api/health..." >&2
curl --fail --silent --retry 30 --retry-delay 10 --retry-all-errors "https://$DOMAIN/api/health" >/dev/null &&
  echo "OFP Lens $TAG is up: https://$DOMAIN" ||
  echo "Deployed, but https://$DOMAIN does not answer yet; try again in a few minutes."
echo
echo "It costs about \$0.25 an hour while it exists. When you are done:  pnpm aws:down"
