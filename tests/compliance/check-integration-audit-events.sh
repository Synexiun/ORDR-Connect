#!/usr/bin/env bash
# Compliance gate: verify all 7 integration AuditEventType values are defined
# in packages/audit/src/types.ts
#
# CI gate: fails if any required integration audit event type is missing.
# SOC2 CC7.2 — Monitoring: audit trail coverage verified before merge.

set -euo pipefail

AUDIT_TYPES_FILE="packages/audit/src/types.ts"
FAILED=0

REQUIRED_TYPES=(
  "integration.connected"
  "integration.disconnected"
  "integration.sync_completed"
  "integration.sync_failed"
  "integration.conflict_detected"
  "integration.webhook_received"
  "integration.webhook_invalid_signature"
)

echo "[ORDR:COMPLIANCE] Checking integration AuditEventType values in $AUDIT_TYPES_FILE"

for event_type in "${REQUIRED_TYPES[@]}"; do
  if grep -q "'${event_type}'" "$AUDIT_TYPES_FILE"; then
    echo "  ✓ '${event_type}'"
  else
    echo "  ✗ MISSING: '${event_type}'"
    FAILED=1
  fi
done

if [ "$FAILED" -eq 1 ]; then
  echo ""
  echo "[ORDR:COMPLIANCE] FAIL — one or more integration audit event types missing from AuditEventType"
  exit 1
fi

echo "[ORDR:COMPLIANCE] PASS — all 7 integration audit event types present"
