# Audit Completeness Policy — ORDR-Connect
#
# SOC2 CC7.2 — Monitoring: log all system activities.
# ISO 27001 A.12.4.1 — Event logging.
# HIPAA §164.312(b) — Audit controls.
#
# All state-changing routes produce audit events.
# Audit events contain required fields.
# Hash chain integrity maintained.

package ordr.audit_completeness

import future.keywords.in

default allow := false

# ── State-changing HTTP methods ───────────────────────────────────────

state_changing_methods := {"POST", "PUT", "PATCH", "DELETE"}

# ── Required audit event fields ───────────────────────────────────────

required_audit_fields := {
    "id",
    "timestamp",
    "actorId",
    "actorType",
    "tenantId",
    "eventType",
    "action",
    "resource",
    "resourceId",
    "hash",
    "previousHash",
    "sequenceNumber",
}

# ── Allow: Audit event has all required fields and valid chain ────────

allow {
    all_fields_present
    hash_chain_valid
    sequence_continuous
}

# ── Deny: State-changing route without audit event ────────────────────

deny[msg] {
    input.request.method in state_changing_methods
    not input.audit_event
    msg := sprintf("%s %s is state-changing but did not produce an audit event", [input.request.method, input.request.path])
}

# ── Deny: Missing required audit fields ──────────────────────────────

all_fields_present {
    every field in required_audit_fields {
        input.audit_event[field]
    }
}

missing_fields[field] {
    some field in required_audit_fields
    not input.audit_event[field]
}

deny[msg] {
    input.audit_event
    count(missing_fields) > 0
    msg := sprintf("Audit event missing required fields: %v", [missing_fields])
}

# ── Deny: Invalid timestamp ──────────────────────────────────────────

deny[msg] {
    input.audit_event.timestamp
    not is_valid_iso8601(input.audit_event.timestamp)
    msg := "Audit event timestamp must be ISO 8601 format"
}

is_valid_iso8601(ts) {
    regex.match(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}`, ts)
}

# ── Hash chain integrity ─────────────────────────────────────────────

hash_chain_valid {
    input.audit_event.hash != ""
    input.audit_event.previousHash != ""
    input.audit_event.hash != input.audit_event.previousHash
}

deny[msg] {
    input.audit_event
    input.audit_event.hash == ""
    msg := "Audit event hash is empty — SHA-256 hash chain link required"
}

deny[msg] {
    input.audit_event
    not input.audit_event.previousHash
    msg := "Audit event missing previousHash — hash chain broken"
}

# ── Sequence continuity ──────────────────────────────────────────────

sequence_continuous {
    input.audit_event.sequenceNumber > 0
    input.audit_event.sequenceNumber == input.previous_sequence + 1
}

deny[msg] {
    input.audit_event
    input.audit_event.sequenceNumber != input.previous_sequence + 1
    msg := sprintf("Audit sequence gap detected: expected %d, got %d", [input.previous_sequence + 1, input.audit_event.sequenceNumber])
}

# ── Deny: PHI in audit event details ─────────────────────────────────

phi_patterns := ["SSN", "ssn", "social_security", "credit_card", "date_of_birth", "medical_record"]

deny[msg] {
    some key in object.keys(input.audit_event.details)
    some pattern in phi_patterns
    contains(lower(key), lower(pattern))
    msg := sprintf("Audit event details contain potential PHI key '%s' — use tokenized references only", [key])
}

# ── Deny: Audit log modifications ────────────────────────────────────

deny[msg] {
    input.operation == "UPDATE"
    input.table == "audit_logs"
    msg := "UPDATE operations on audit_logs table are forbidden — WORM policy"
}

deny[msg] {
    input.operation == "DELETE"
    input.table == "audit_logs"
    msg := "DELETE operations on audit_logs table are forbidden — WORM policy"
}

# ── Merkle root verification ─────────────────────────────────────────

deny[msg] {
    input.batch_size >= 1000
    not input.merkle_root
    msg := "Merkle root must be generated every 1000 audit events"
}
