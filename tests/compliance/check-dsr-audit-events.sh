#!/usr/bin/env bash
# check-dsr-audit-events.sh — Phase 51 compliance gate
#
# Verifies that all 9 GDPR DSR audit event types are present in
# packages/audit/src/types.ts AuditEventType union.
#
# SOC2 CC7.2 — Monitoring: DSR lifecycle must be fully auditable.
# GDPR Art. 12, 15, 17, 20 — All DSR state transitions must be logged.
#
# Usage: ./tests/compliance/check-dsr-audit-events.sh
# Returns: exit 0 on pass, exit 1 on failure (prints missing types)

set -eo pipefail

REQUIRED_TYPES=(
  "dsr.requested"
  "dsr.approved"
  "dsr.rejected"
  "dsr.cancelled"
  "dsr.exported"
  "dsr.failed"
  "dsr.erasure_scheduled"
  "dsr.erasure_executed"
  "dsr.erasure_verified"
)

AUDIT_TYPES_FILE="packages/audit/src/types.ts"

# ── Repo root guard ───────────────────────────────────────────────

if [[ ! -f "CLAUDE.md" ]]; then
  echo "ERROR: Must be run from the repo root (CLAUDE.md not found)" >&2
  exit 1
fi

if [[ ! -f "${AUDIT_TYPES_FILE}" ]]; then
  echo "ERROR: ${AUDIT_TYPES_FILE} not found" >&2
  exit 1
fi

# ── Check each required type ──────────────────────────────────────

MISSING=()
for event_type in "${REQUIRED_TYPES[@]}"; do
  if [[ -z "${event_type}" ]]; then
    continue
  fi
  if ! grep -qF "'${event_type}'" "${AUDIT_TYPES_FILE}"; then
    MISSING+=("${event_type}")
  fi
done

# ── Report ────────────────────────────────────────────────────────

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "FAIL: The following DSR audit event types are missing from ${AUDIT_TYPES_FILE}:" >&2
  for t in "${MISSING[@]}"; do
    echo "  - '${t}'" >&2
  done
  exit 1
fi

echo "PASS: All 9 DSR audit event types present in ${AUDIT_TYPES_FILE}"
exit 0
