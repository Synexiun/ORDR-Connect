# API Security Policy — ORDR-Connect
#
# SOC2 CC6.1 — Logical access security at the API boundary.
# ISO 27001 A.14.1.2 — Securing application services.
# HIPAA §164.312(d) — Person or entity authentication.
#
# All endpoints require authentication (except public routes),
# rate limiting present per tenant, CORS restricted.

package ordr.api_security

import future.keywords.in

default allow := false

# ── Public routes that do not require authentication ──────────────────

public_routes := {
    "/health",
    "/health/ready",
    "/health/live",
    "/api/v1/openapi.json",
}

# ── Public route prefixes (webhooks use signature auth, not JWT) ──────

public_route_prefixes := {
    "/api/v1/webhooks/",
}

# ── Allow: Public routes without auth ─────────────────────────────────

allow {
    input.request.path in public_routes
}

allow {
    some prefix in public_route_prefixes
    startswith(input.request.path, prefix)
    input.request.signature_verified == true
}

# ── Allow: Authenticated request with rate limit check ────────────────

allow {
    not input.request.path in public_routes
    input.auth.authenticated == true
    input.rate_limit.allowed == true
    cors_valid
}

# ── Deny: Missing authentication on protected routes ──────────────────

deny[msg] {
    not input.request.path in public_routes
    not is_webhook_path
    not input.auth.authenticated == true
    msg := sprintf("Endpoint '%s %s' requires authentication", [input.request.method, input.request.path])
}

is_webhook_path {
    some prefix in public_route_prefixes
    startswith(input.request.path, prefix)
}

# ── Deny: Rate limit exceeded ─────────────────────────────────────────

deny[msg] {
    input.rate_limit.allowed == false
    msg := sprintf("Rate limit exceeded for tenant '%s' on endpoint '%s' — retry after %ds", [input.auth.tenant_id, input.request.path, input.rate_limit.retry_after_seconds])
}

# ── Deny: Missing rate limiting on endpoint ───────────────────────────

deny[msg] {
    not input.rate_limit
    not input.request.path in public_routes
    msg := sprintf("Endpoint '%s' has no rate limiting configured", [input.request.path])
}

# ── CORS validation ───────────────────────────────────────────────────

cors_valid {
    not input.request.headers.origin
}

cors_valid {
    input.request.headers.origin in data.allowed_origins
}

deny[msg] {
    input.request.headers.origin
    not input.request.headers.origin in data.allowed_origins
    msg := sprintf("CORS origin '%s' is not in the allowed origins list", [input.request.headers.origin])
}

deny[msg] {
    "*" in data.allowed_origins
    input.environment == "production"
    msg := "Wildcard CORS origin ('*') is forbidden in production"
}

# ── Request size validation ───────────────────────────────────────────

deny[msg] {
    input.request.content_length > input.request.max_body_size
    msg := sprintf("Request body size %d exceeds limit of %d bytes", [input.request.content_length, input.request.max_body_size])
}

# ── Required security headers ────────────────────────────────────────

deny[msg] {
    not input.response.headers["Strict-Transport-Security"]
    msg := "Missing HSTS header — Strict-Transport-Security is required"
}

deny[msg] {
    not input.response.headers["X-Content-Type-Options"]
    msg := "Missing X-Content-Type-Options header"
}

deny[msg] {
    not input.response.headers["X-Frame-Options"]
    msg := "Missing X-Frame-Options header"
}

deny[msg] {
    input.response.headers["X-Powered-By"]
    msg := "X-Powered-By header must be removed — technology stack disclosure"
}
