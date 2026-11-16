#!/usr/bin/env bash
# Creates the AWS cluster (infra/aws) and deploys OFP Lens on it (docs/DEPLOYMENT.md, step 4).
# Safe to run again: Terraform changes only what differs, and the app is upgraded.
#
#   export AWS_PROFILE=ofplens
#   pnpm aws:up       → http://<load balancer>/   (costs ~$0.25/hour until pnpm aws:down)
#
# Each step prints the command it runs, so you can also run them one by one.
source "$(dirname "$0")/common.sh"

# 1. The infrastructure. Shows the plan and asks before changing anything (type yes).
#    The first run takes 15-20 minutes (the cluster and the database).
run terraform -chdir="$TF_DIR" apply

use_cluster

# 2. The images, built for ARM (the t4g nodes) and pushed to ECR. One immutable tag per build.
TAG="$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
echo "+ aws ecr get-login-password | docker login $REGISTRY" >&2
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
for part in api web; do
  run docker build --platform linux/arm64 --target "$part" -t "$REGISTRY/ofplens-$part:$TAG" .
  run docker push "$REGISTRY/ofplens-$part:$TAG"
done

# 3. The app's Secret, copied from Secrets Manager by External Secrets.
k create namespace "$NAMESPACE" --dry-run=client -o yaml | k apply -f -
k apply -f deploy/aws/external-secret.yaml
k wait externalsecret/ofplens-secrets -n "$NAMESPACE" --for=condition=Ready --timeout=120s

# 4. The app. PUBLIC_URL must be the load balancer's address, which exists only after the first
#    install; until then a placeholder (nobody can sign in on AWS before step 5 anyway).
lb_host() {
  kubectl --context "$CONTEXT" get ingress ofplens -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true
}
helm_deploy() {
  run helm upgrade --install ofplens deploy/helm/ofplens --kube-context "$CONTEXT" \
    --namespace "$NAMESPACE" -f deploy/helm/ofplens/values-aws.yaml \
    --set image.registry="$REGISTRY" --set image.tag="$TAG" --set api.publicUrl="$1" \
    --wait --timeout 10m
}

HOST="$(lb_host)"
helm_deploy "http://${HOST:-pending.invalid}"
if [[ -z "$HOST" ]]; then
  echo "Waiting for the load balancer's address..." >&2
  for _ in $(seq 60); do
    HOST="$(lb_host)"
    [[ -n "$HOST" ]] && break
    sleep 5
  done
  [[ -n "$HOST" ]] || { echo "No load balancer address after 5 minutes: kubectl describe ingress ofplens -n $NAMESPACE" >&2; exit 1; }
  helm_deploy "http://$HOST"
fi

echo
k get pods -n "$NAMESPACE" -o wide
echo
# A new load balancer needs a few minutes before its DNS name resolves and targets are healthy.
echo "Waiting for http://$HOST/api/health (a new load balancer takes a few minutes)..." >&2
curl --fail --silent --retry 40 --retry-delay 10 --retry-all-errors "http://$HOST/api/health" >/dev/null &&
  echo "OFP Lens $TAG is up: http://$HOST" ||
  echo "Deployed, but http://$HOST does not answer yet; try again in a few minutes."
echo
echo "It costs about \$0.25 an hour while it exists. When you are done:  pnpm aws:down"
