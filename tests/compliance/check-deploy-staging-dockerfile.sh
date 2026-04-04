#!/usr/bin/env bash
set -eo pipefail

DOCKERFILE=$(grep 'file:' .github/workflows/deploy-staging.yml | sed "s/.*file:[[:space:]]*//" | tr -d ' ')

echo "deploy-staging.yml Dockerfile: $DOCKERFILE"

if [ -z "$DOCKERFILE" ]; then
  echo "ERROR: could not extract 'file:' value from deploy-staging.yml"
  exit 1
fi

if [ "$DOCKERFILE" != "./infrastructure/docker/Dockerfile.api" ]; then
  echo "ERROR: deploy-staging.yml references '$DOCKERFILE', expected './infrastructure/docker/Dockerfile.api'"
  exit 1
fi
echo "PASS: deploy-staging.yml references Dockerfile.api"
