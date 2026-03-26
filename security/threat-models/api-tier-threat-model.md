# API Tier Threat Model — STRIDE Analysis

**System:** ORDR-Connect API (Hono)
**Scope:** All route groups under /api/v1/*
**Review date:** 2026-03-25
**Reviewer:** Security Architecture Team

---

## Assets

| Asset | Classification | Description |
|-------|---------------|-------------|
| Customer PII | CONFIDENTIAL | Names, emails, phone numbers |
| Customer PHI | RESTRICTED | Health data, medical records |
| Session tokens | RESTRICTED | JWT access + refresh tokens |
| API keys | RESTRICTED | Developer portal integration keys |
| Audit logs | RESTRICTED | Immutable compliance trail |
| Agent outputs | CONFIDENTIAL | AI-generated customer communications |

---

## Threat: Spoofing

### S-API-01: JWT Forgery

- **Attack:** Attacker crafts a JWT with a valid structure but signed with a different key.
- **Mitigation:** RS256 asymmetric signing (packages/auth/src/jwt.ts). Public key verification on every request. Algorithm pinned to RS256 only — no algorithm confusion.
- **Control:** SOC2 CC6.1, ISO 27001 A.9.4.2
- **Residual risk:** LOW. Key compromise would require HSM breach.

### S-API-02: Session Hijacking

- **Attack:** Attacker steals a session token via XSS, network sniffing, or log exposure.
- **Mitigation:** HSTS enforced (security-headers.ts). HttpOnly/Secure cookies for refresh tokens. 15-minute idle timeout (HIPAA). Token rotation on every refresh. Revocation on reuse detection.
- **Control:** HIPAA §164.312(a)(2)(iii)
- **Residual risk:** LOW. Token rotation limits replay window to 15 minutes.

### S-API-03: API Key Impersonation

- **Attack:** Attacker obtains an API key from logs, code, or network capture.
- **Mitigation:** API keys SHA-256 hashed before storage (hash.ts). Prefix-based identification (ordr_). Rotation enforced. Rate limiting per key.
- **Control:** SOC2 CC6.1
- **Residual risk:** MEDIUM. Requires monitoring for anomalous key usage patterns.

---

## Threat: Tampering

### T-API-01: Input Manipulation

- **Attack:** Attacker sends malformed input to bypass validation or inject payloads.
- **Mitigation:** Zod schema validation on all inputs (routes/customers.ts etc.). Parameterized queries via Drizzle ORM. JSON Schema with additionalProperties: false.
- **Control:** ISO 27001 A.14.2.5
- **Residual risk:** LOW. Type-safe pipeline from input to database.

### T-API-02: CSRF Attack

- **Attack:** Attacker tricks authenticated user into making state-changing requests.
- **Mitigation:** Bearer token authentication (not cookie-based). CORS restricted to allowed origins. SameSite cookie attribute on refresh tokens.
- **Control:** SOC2 CC6.6
- **Residual risk:** LOW. Bearer auth is inherently CSRF-resistant.

### T-API-03: Request Replay

- **Attack:** Attacker captures and replays a valid request.
- **Mitigation:** Short-lived JWTs (15min). JTI claim for revocation tracking. Rate limiting. Audit trail detects duplicate actions.
- **Control:** ISO 27001 A.14.1.3
- **Residual risk:** LOW. 15-minute window limits exposure.

---

## Threat: Repudiation

### R-API-01: Denied Data Modification

- **Attack:** User denies making a change to customer data or agent settings.
- **Mitigation:** WORM audit log with SHA-256 hash chain (audit-logger.ts). Every state-changing operation produces an immutable audit event. Merkle tree batch verification. Actor ID from JWT (non-repudiable).
- **Control:** SOC2 CC7.2, HIPAA §164.312(b)
- **Residual risk:** VERY LOW. Cryptographic hash chain makes tampering detectable.

### R-API-02: Agent Action Denial

- **Attack:** Agent claims it did not send a particular message or make a decision.
- **Mitigation:** Full reasoning chain logged (prompt, context, output, confidence). Each agent action has a unique action ID in the audit trail. Confidence scores recorded.
- **Control:** CLAUDE.md Rule 9
- **Residual risk:** LOW.

---

## Threat: Information Disclosure

### I-API-01: Stack Trace Leakage

- **Attack:** Error responses expose internal paths, library versions, or database schema.
- **Mitigation:** Global error handler (error-handler.ts) catches all errors. InternalError.toSafeResponse() returns generic message. Stack traces logged internally only. Correlation ID returned for support reference.
- **Control:** ISO 27001 A.14.1.2
- **Residual risk:** VERY LOW.

### I-API-02: PHI in Logs/Errors

- **Attack:** PHI appears in application logs, error messages, or API responses.
- **Mitigation:** Audit middleware logs metadata only (method, path, status, duration). PII fields encrypted before storage. Error handler strips internal details. Customer data changes logged as field names only, not values.
- **Control:** HIPAA §164.312
- **Residual risk:** LOW. Requires ongoing log review.

### I-API-03: Technology Stack Disclosure

- **Attack:** Response headers reveal framework, runtime, or version information.
- **Mitigation:** X-Powered-By header removed (security-headers.ts). No Server header. No version numbers in responses. CSP and security headers set defensively.
- **Control:** SOC2 CC6.6
- **Residual risk:** VERY LOW.

---

## Threat: Denial of Service

### D-API-01: Request Flooding

- **Attack:** Attacker sends high volume of requests to exhaust resources.
- **Mitigation:** Per-tenant sliding window rate limiting (rate-limiter.ts). Per-endpoint limits. Auth rate limiting (5/15min). API rate limiting (1000/min). 429 responses with Retry-After.
- **Control:** ISO 27001 A.13.1.1
- **Residual risk:** MEDIUM. Distributed attacks may require WAF/CDN.

### D-API-02: Request Size Attack

- **Attack:** Attacker sends oversized payloads to exhaust memory.
- **Mitigation:** Hard request size limits (default 1MB). JSON Schema validation rejects oversized payloads. GraphQL query depth limiting (max 10).
- **Control:** SOC2 CC6.6
- **Residual risk:** LOW.

### D-API-03: ReDoS

- **Attack:** Attacker crafts input that causes catastrophic regex backtracking.
- **Mitigation:** All regex patterns reviewed for ReDoS. Zod schema validation has built-in length limits. Timeout on all regex operations.
- **Control:** ISO 27001 A.14.2.5
- **Residual risk:** LOW.

---

## Threat: Elevation of Privilege

### E-API-01: RBAC Bypass

- **Attack:** User with 'agent' role accesses admin-only endpoints.
- **Mitigation:** requireAuth() + requireRole()/requirePermission() middleware on every protected route (middleware/auth.ts). Role hierarchy enforced server-side. Permissions from JWT, not client input.
- **Control:** SOC2 CC6.3, HIPAA §164.312(a)(1)
- **Residual risk:** LOW.

### E-API-02: Tenant Isolation Bypass

- **Attack:** User in tenant A accesses data belonging to tenant B.
- **Mitigation:** tenant_id derived from JWT server-side (never from client input). PostgreSQL RLS on all tenant-scoped tables. requireTenant() middleware for explicit checks. Branded TenantId type prevents accidental misuse.
- **Control:** SOC2 CC6.1
- **Residual risk:** VERY LOW. Multiple layers of enforcement.

### E-API-03: Privilege Escalation via API Key

- **Attack:** API key with limited scope is used to access admin resources.
- **Mitigation:** API key maps to a specific TenantContext with explicit role and permissions. ApiKeyVerifier callback validates scope. Rate limited independently.
- **Control:** SOC2 CC6.3
- **Residual risk:** LOW.
