# PHI Access Control Policy — ORDR-Connect
#
# HIPAA §164.312 — Technical safeguards for ePHI.
# HIPAA §164.502(b) — Minimum necessary standard.
# SOC2 CC6.1 — Logical access for restricted data.
# ISO 27001 A.8.2.3 — Handling of classified assets.
#
# Only HIPAA-authorized roles can access RESTRICTED data.
# BAA verification required for external sharing.
# Minimum necessary principle enforcement.

package ordr.phi_access_control

import future.keywords.in

default allow := false

# ── Roles authorized for PHI access ───────────────────────────────────

phi_authorized_roles := {"super_admin", "tenant_admin", "manager"}

# ── Allow: Authorized role + audit trail + encryption ─────────────────

allow {
    input.user.role in phi_authorized_roles
    input.request.audit_trail_id != ""
    input.request.data_encrypted == true
    minimum_necessary_satisfied
}

# ── Deny: Unauthorized role accessing PHI ─────────────────────────────

deny[msg] {
    not input.user.role in phi_authorized_roles
    msg := sprintf("Role '%s' is not authorized to access PHI — requires one of: %v", [input.user.role, phi_authorized_roles])
}

# ── Deny: PHI access without audit trail ──────────────────────────────

deny[msg] {
    input.request.audit_trail_id == ""
    msg := "PHI access requires an active audit trail entry (HIPAA §164.312(b))"
}

deny[msg] {
    not input.request.audit_trail_id
    msg := "PHI access requires an active audit trail entry (HIPAA §164.312(b))"
}

# ── Deny: PHI not encrypted ──────────────────────────────────────────

deny[msg] {
    input.request.data_encrypted != true
    msg := "PHI must be encrypted at rest and in transit (HIPAA §164.312(a)(2)(iv))"
}

# ── Minimum necessary principle ───────────────────────────────────────

minimum_necessary_satisfied {
    count(unauthorized_fields) == 0
}

unauthorized_fields[field] {
    field := input.request.requested_fields[_]
    not field in input.request.authorized_fields
}

deny[msg] {
    count(unauthorized_fields) > 0
    msg := sprintf("Minimum necessary violation: unauthorized fields requested: %v (HIPAA §164.502(b))", [unauthorized_fields])
}

# ── BAA verification for external sharing ─────────────────────────────

deny[msg] {
    input.request.sharing_external == true
    not input.request.baa_on_file == true
    msg := sprintf("BAA required before sharing PHI with subprocessor '%s' (HIPAA §164.502(e))", [input.request.subprocessor_id])
}

# ── Session timeout enforcement for PHI ───────────────────────────────

deny[msg] {
    input.session.idle_minutes > 15
    msg := sprintf("Session idle for %d minutes — exceeds 15-minute PHI session limit (HIPAA §164.312(a)(2)(iii))", [input.session.idle_minutes])
}

# ── MFA requirement for PHI access ────────────────────────────────────

deny[msg] {
    not input.user.mfa_verified == true
    msg := "MFA verification required for PHI access"
}

# ── PHI in forbidden locations ────────────────────────────────────────

deny[msg] {
    input.request.phi_in_logs == true
    msg := "PHI detected in log output — PHI must never appear in logs (HIPAA §164.312)"
}

deny[msg] {
    input.request.phi_in_url == true
    msg := "PHI detected in URL/query parameters — PHI must never appear in URLs"
}

deny[msg] {
    input.request.phi_in_error_response == true
    msg := "PHI detected in error response — error messages must never contain PHI"
}
