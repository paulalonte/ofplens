#!/usr/bin/env bash
# Builds the images and installs OFP Lens on a local kind cluster (docs/DEPLOYMENT.md, step 2).
# Safe to run again: it reuses the cluster and upgrades the release.
#
#   pnpm kind:up      →  http://localhost:8088
#   pnpm kind:down    deletes the cluster
#
# Each step prints the command it runs, so you can also run them one by one.
set -euo pipefail
cd "$(dirname "$0")/../.."

CLUSTER=ofplens
NAMESPACE=ofplens
CONTEXT="kind-$CLUSTER"
TRAEFIK_CHART_VERSION=42.2.0
# One immutable tag per build: the commit, plus a timestamp so local changes get a new tag too.
TAG="$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"

run() { echo "+ $*" >&2; "$@"; }

if ! kind get clusters | grep -qx "$CLUSTER"; then
  run kind create cluster --config deploy/kind/cluster.yaml
fi
# Every command below names the context, so it can never hit another cluster by accident.
k() { run kubectl --context "$CONTEXT" "$@"; }

run helm repo add traefik https://traefik.github.io/charts --force-update >/dev/null
run helm upgrade --install traefik traefik/traefik --version "$TRAEFIK_CHART_VERSION" \
  --kube-context "$CONTEXT" --namespace traefik --create-namespace \
  -f deploy/kind/traefik-values.yaml --wait

run docker build --target api -t "ofplens-api:$TAG" .
run docker build --target web -t "ofplens-web:$TAG" .
run kind load docker-image --name "$CLUSTER" "ofplens-api:$TAG" "ofplens-web:$TAG"

k create namespace "$NAMESPACE" --dry-run=client -o yaml | k apply -f -
k apply -f deploy/kind/postgres.yaml
k rollout status statefulset/postgres -n "$NAMESPACE" --timeout=120s

# The app's Secret, created once and then left alone, so a key you add yourself survives re-runs.
# It holds only the database URL; AI briefings stay off until you add your Claude key
# (docs/LEARNING.md, step 2, "Try it").
if ! kubectl --context "$CONTEXT" get secret ofplens-secrets -n "$NAMESPACE" >/dev/null 2>&1; then
  k create secret generic ofplens-secrets -n "$NAMESPACE" \
    --from-literal=DATABASE_URL=postgres://ofplens:ofplens@postgres:5432/ofplens
fi

run helm upgrade --install ofplens deploy/helm/ofplens --kube-context "$CONTEXT" \
  --namespace "$NAMESPACE" -f deploy/helm/ofplens/values-kind.yaml \
  --set image.tag="$TAG" --wait --timeout 5m

echo
k get pods -n "$NAMESPACE" -o wide
echo
echo "OFP Lens $TAG is up: http://localhost:8088"
