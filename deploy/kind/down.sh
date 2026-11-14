#!/usr/bin/env bash
# Deletes the local kind cluster and everything in it, including its Postgres data.
set -euo pipefail
echo "+ kind delete cluster --name ofplens" >&2
kind delete cluster --name ofplens
