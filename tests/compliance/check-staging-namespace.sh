#!/bin/bash
set -e

KUSTOMIZE_NS=$(grep '^namespace:' infrastructure/kubernetes/overlays/staging/kustomization.yaml | awk '{print $2}')
CI_NS=$(grep 'namespace=ordr-' .github/workflows/deploy-staging.yml | head -1 | sed 's/.*--namespace=\(ordr-[a-z]*\).*/\1/')

echo "Kustomize namespace: $KUSTOMIZE_NS"
echo "CI workflow namespace: $CI_NS"

if [ "$KUSTOMIZE_NS" != "$CI_NS" ]; then
  echo "ERROR: namespace mismatch — kustomize uses '$KUSTOMIZE_NS', CI uses '$CI_NS'"
  exit 1
fi
echo "PASS: namespaces match"
