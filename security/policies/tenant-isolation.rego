# Tenant Isolation Policy — ORDR-Connect
#
# SOC2 CC6.1 — Logical access security: tenant data isolation.
# ISO 27001 A.9.4.1 — Information access restriction.
# HIPAA §164.312(a)(1) — Access control for ePHI.
#
# Denies cross-tenant data access, verifies tenant_id in JWT matches
# request scope, and blocks wildcard tenant queries.

package ordr.tenant_isolation

import future.keywords.in

default allow := false

# ── Rule 1: JWT tenant_id must match the request scope ────────────────

allow {
    input.jwt.tid == input.request.tenant_id
}

# ── Rule 2: Super admins may access any tenant (global scope) ─────────

allow {
    input.jwt.role == "super_admin"
}

# ── Deny: Cross-tenant data access ────────────────────────────────────

deny[msg] {
    input.jwt.role != "super_admin"
    input.jwt.tid != input.request.tenant_id
    msg := sprintf("Cross-tenant access denied: JWT tenant '%s' does not match request tenant '%s'", [input.jwt.tid, input.request.tenant_id])
}

# ── Deny: Wildcard tenant queries ─────────────────────────────────────

deny[msg] {
    input.request.tenant_id == "*"
    msg := "Wildcard tenant queries are forbidden"
}

deny[msg] {
    input.request.tenant_id == ""
    msg := "Empty tenant_id is forbidden — tenant must be explicitly specified"
}

# ── Deny: Client-supplied tenant_id override attempt ──────────────────

deny[msg] {
    input.request.headers["x-tenant-id"]
    input.jwt.role != "super_admin"
    msg := "Client-supplied X-Tenant-Id header is forbidden — tenant derived from JWT only"
}

# ── Deny: Missing tenant_id in JWT ────────────────────────────────────

deny[msg] {
    not input.jwt.tid
    msg := "JWT missing required 'tid' (tenant_id) claim"
}

# ── Deny: tenant_id in query parameters ───────────────────────────────

deny[msg] {
    input.request.query_params.tenant_id
    input.jwt.role != "super_admin"
    msg := "tenant_id in query parameters is forbidden — tenant derived server-side from JWT"
}

# ── Deny: tenant_id in request body ───────────────────────────────────

deny[msg] {
    input.request.body.tenant_id
    input.jwt.role != "super_admin"
    msg := "tenant_id in request body is forbidden — tenant derived server-side from JWT"
}

# ── RLS enforcement check ─────────────────────────────────────────────

rls_enforced {
    input.database.rls_enabled == true
    input.database.rls_policy_tenant_id == input.jwt.tid
}

deny[msg] {
    not rls_enforced
    input.database.rls_enabled != true
    msg := "Row-Level Security (RLS) must be enabled on all tenant-scoped tables"
}
