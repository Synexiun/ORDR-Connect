# Network Policy — ORDR-Connect
#
# ISO 27001 A.13.1.1 — Network controls.
# SOC2 CC6.6 — System boundaries and threat mitigation.
# HIPAA §164.312(e)(1) — Transmission security.
#
# No public database ingress, mTLS for inter-service communication,
# egress limited to allowlisted domains.

package ordr.network_policy

import future.keywords.in

default allow := false

# ── Allowed egress domains ────────────────────────────────────────────

allowed_egress_domains := {
    "api.twilio.com",
    "api.sendgrid.com",
    "api.workos.com",
    "api.anthropic.com",
    "vault.hashicorp.com",
    "confluent.cloud",
    "neo4j.io",
    "monitoring.grafana.net",
    "s3.amazonaws.com",
    "kms.amazonaws.com",
    "secretsmanager.amazonaws.com",
}

# ── Allow: Traffic to allowlisted domains ─────────────────────────────

allow {
    input.direction == "egress"
    input.destination.domain in allowed_egress_domains
    input.tls.version >= "1.3"
}

allow {
    input.direction == "egress"
    input.destination.domain in allowed_egress_domains
    input.tls.version == "1.2"
    input.destination.legacy_approved == true
}

# ── Allow: Internal service-to-service with mTLS ─────────────────────

allow {
    input.direction == "internal"
    input.mtls.enabled == true
    input.mtls.client_cert_valid == true
    input.mtls.server_cert_valid == true
}

# ── Deny: Public database ingress ─────────────────────────────────────

deny[msg] {
    input.destination.type == "database"
    input.source.is_public == true
    msg := "Public ingress to databases is forbidden — databases must not be internet-accessible"
}

deny[msg] {
    input.destination.type == "cache"
    input.source.is_public == true
    msg := "Public ingress to cache (Redis) is forbidden"
}

# ── Deny: Inter-service without mTLS ─────────────────────────────────

deny[msg] {
    input.direction == "internal"
    not input.mtls.enabled == true
    msg := "mTLS is required for all inter-service communication"
}

deny[msg] {
    input.direction == "internal"
    input.mtls.enabled == true
    not input.mtls.client_cert_valid == true
    msg := "mTLS client certificate validation failed"
}

# ── Deny: Egress to non-allowlisted domains ──────────────────────────

deny[msg] {
    input.direction == "egress"
    not input.destination.domain in allowed_egress_domains
    msg := sprintf("Egress to '%s' is not in the allowlisted domains", [input.destination.domain])
}

# ── Deny: TLS version below minimum ──────────────────────────────────

deny[msg] {
    input.tls.version == "1.0"
    msg := "TLS 1.0 is forbidden — minimum TLS 1.3 required (TLS 1.2 only with legacy approval)"
}

deny[msg] {
    input.tls.version == "1.1"
    msg := "TLS 1.1 is forbidden — minimum TLS 1.3 required (TLS 1.2 only with legacy approval)"
}

deny[msg] {
    input.tls.version == "1.2"
    not input.destination.legacy_approved == true
    msg := "TLS 1.2 requires explicit legacy approval — TLS 1.3 is the minimum standard"
}

# ── Deny: Unencrypted traffic ─────────────────────────────────────────

deny[msg] {
    not input.tls.enabled == true
    msg := "All traffic must be encrypted — unencrypted connections are forbidden"
}

# ── Security group validation ─────────────────────────────────────────

deny[msg] {
    input.security_group.ingress_cidr == "0.0.0.0/0"
    input.destination.port != 443
    msg := sprintf("Security group allows 0.0.0.0/0 ingress on port %d — only port 443 (load balancer) permitted", [input.destination.port])
}
