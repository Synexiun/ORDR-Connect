# Data Encryption Policy — ORDR-Connect
#
# HIPAA §164.312(a)(2)(iv) — Encryption and decryption of ePHI.
# SOC2 CC6.1 — Logical access security for encryption keys.
# ISO 27001 A.10.1.1 — Cryptographic controls policy.
#
# All RESTRICTED data fields encrypted before storage.
# TLS 1.3 minimum for all connections.
# Key rotation within 90-day window.

package ordr.data_encryption

import future.keywords.in

default allow := false

# ── Data classification requiring encryption ──────────────────────────

restricted_classifications := {"restricted", "confidential"}

# ── Allow: Data properly encrypted and key within rotation ────────────

allow {
    data_encrypted
    key_rotation_compliant
    tls_compliant
}

# ── Deny: RESTRICTED data not encrypted before storage ────────────────

data_encrypted {
    input.data.classification in restricted_classifications
    input.data.encrypted_at_rest == true
    input.data.encryption_algorithm == "AES-256-GCM"
}

data_encrypted {
    not input.data.classification in restricted_classifications
}

deny[msg] {
    input.data.classification in restricted_classifications
    not input.data.encrypted_at_rest == true
    msg := sprintf("Data classified as '%s' must be encrypted at rest before storage", [input.data.classification])
}

deny[msg] {
    input.data.classification in restricted_classifications
    input.data.encrypted_at_rest == true
    input.data.encryption_algorithm != "AES-256-GCM"
    msg := sprintf("Encryption algorithm '%s' is not approved — AES-256-GCM required", [input.data.encryption_algorithm])
}

# ── Deny: Field-level encryption missing for PHI columns ─────────────

deny[msg] {
    input.data.classification == "restricted"
    not input.data.field_level_encryption == true
    msg := "RESTRICTED data requires field-level encryption before database write"
}

# ── TLS compliance ────────────────────────────────────────────────────

tls_compliant {
    input.connection.tls_version == "1.3"
}

tls_compliant {
    input.connection.tls_version == "1.2"
    input.connection.legacy_approved == true
}

deny[msg] {
    input.connection.tls_version == "1.0"
    msg := "TLS 1.0 is forbidden — minimum TLS 1.3 required"
}

deny[msg] {
    input.connection.tls_version == "1.1"
    msg := "TLS 1.1 is forbidden — minimum TLS 1.3 required"
}

deny[msg] {
    not input.connection.tls_enabled == true
    msg := "Unencrypted connections are forbidden — TLS is mandatory for all connections"
}

# ── Key rotation compliance ───────────────────────────────────────────

key_rotation_compliant {
    input.key.days_since_rotation <= 90
}

deny[msg] {
    input.key.days_since_rotation > 90
    msg := sprintf("Encryption key has not been rotated in %d days — maximum 90-day rotation cycle required", [input.key.days_since_rotation])
}

# ── Forbidden encryption practices ────────────────────────────────────

deny[msg] {
    input.data.encryption_algorithm == "MD5"
    msg := "MD5 is forbidden for any security purpose"
}

deny[msg] {
    input.data.encryption_algorithm == "SHA-1"
    msg := "SHA-1 is forbidden for any security purpose"
}

deny[msg] {
    input.data.encryption_mode == "ECB"
    msg := "ECB mode is forbidden for any block cipher"
}

deny[msg] {
    input.key.hardcoded == true
    msg := "Hard-coded encryption keys are forbidden — use HSM-backed key management"
}

deny[msg] {
    input.key.shared_between_tenants == true
    msg := "Symmetric key sharing between tenants is forbidden"
}

# ── Database connection encryption ────────────────────────────────────

deny[msg] {
    input.connection.type == "database"
    not input.connection.tls_enabled == true
    msg := "Database connections must always use TLS"
}

deny[msg] {
    input.connection.type == "database"
    not input.connection.cert_verified == true
    msg := "Database connections must verify TLS certificates"
}
