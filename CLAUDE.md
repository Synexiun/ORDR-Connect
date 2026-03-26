# ORDR-Connect — Customer Operations OS

## Identity

ORDR-Connect is the Customer Operations Operating System — an autonomous, event-sourced, multi-agent platform that replaces passive CRM with an intelligent system of action. Built under the Synexiun ecosystem (limb: SynexCom).

---

## COMPLIANCE LAW — NON-NEGOTIABLE

**Every line of code in this repository MUST comply with SOC 2 Type II, ISO 27001:2022, and HIPAA. There are ZERO exceptions. These are not guidelines — they are hard gates. Code that violates any rule below MUST NOT be merged, committed, or deployed.**

### Certification Targets

| Standard | Scope | Key Controls |
|----------|-------|--------------|
| **SOC 2 Type II** | Trust Services Criteria (Security, Availability, Processing Integrity, Confidentiality, Privacy) | CC1–CC9, A1, PI1, C1, P1 |
| **ISO 27001:2022** | Annex A controls A.5–A.8 (Organizational, People, Physical, Technological) | 93 controls, all applicable |
| **HIPAA** | Technical Safeguards §164.312, Administrative §164.308, Physical §164.310 | Access control, audit, integrity, transmission security |

---

## MANDATORY DEVELOPMENT RULES

### Rule 1 — Encryption Everywhere

```
REQUIRED:
- All data at rest: AES-256-GCM (no exceptions)
- All data in transit: TLS 1.3 minimum (TLS 1.2 ONLY for legacy integration with explicit approval)
- All PII/PHI fields: Application-layer encryption BEFORE database write
- Key management: HSM-backed (AWS KMS / GCP Cloud HSM / Azure Key Vault with HSM)
- Key rotation: Automated, maximum 90-day cycle
- Database connections: Always TLS, always verify certificates
- Inter-service communication: mTLS mandatory

FORBIDDEN:
- Plaintext storage of any sensitive data
- MD5 or SHA-1 for any security purpose
- Hard-coded encryption keys
- Self-signed certificates in production
- Symmetric key sharing between tenants
- ECB mode for any block cipher
```

### Rule 2 — Authentication & Access Control

```
REQUIRED:
- Authentication: OAuth 2.1 + PKCE for all external auth flows
- Session tokens: Cryptographically random, minimum 256-bit entropy
- Password hashing: Argon2id (memory=64MB, iterations=3, parallelism=4) — NO bcrypt, NO scrypt
- MFA: Mandatory for all human access to production systems
- RBAC + ABAC: Every endpoint, every query, every agent action
- Tenant isolation: Derived from JWT claims server-side, NEVER from client input
- Row-Level Security (RLS): PostgreSQL RLS on every tenant-scoped table
- Principle of least privilege: Default deny, explicit grant
- Service-to-service: mTLS + short-lived JWT (max 15 min)
- API keys: SHA-256 hashed before storage, prefixed for identification

FORBIDDEN:
- Storing passwords in any reversible format
- Session tokens in URLs or query parameters
- Wildcard CORS origins in production
- Admin endpoints without MFA verification
- API keys with no expiration
- Service accounts with permanent credentials
- Trust of any client-supplied tenant_id
```

### Rule 3 — Audit Logging (WORM)

```
REQUIRED:
- Every state change → immutable audit event
- Every data access → logged with accessor identity, timestamp, resource, action
- Every agent decision → full reasoning chain logged (prompt, context, output, confidence)
- Every API call → request/response metadata (NOT sensitive payloads)
- Audit format: Structured JSON with SHA-256 hash chain (each entry hashes the previous)
- Merkle tree: Batch verification roots generated every 1000 events
- Storage: Append-only (PostgreSQL triggers blocking UPDATE/DELETE on audit tables)
- Replication: S3 Object Lock (Compliance mode) / GCS WORM bucket
- Retention: 7 years minimum (HIPAA=6yr, financial=7yr, we use the higher)
- Tamper detection: Automatic hash chain verification on read, alert on break

FORBIDDEN:
- UPDATE or DELETE on any audit table
- Audit logs without cryptographic chain
- Gaps in the audit sequence
- Logging PHI/PII in plaintext in audit records (use tokenized references)
- Audit log access without its own audit trail
```

### Rule 4 — Input Validation & Injection Prevention

```
REQUIRED:
- All external input: Validate type, length, format, range BEFORE processing
- SQL: Parameterized queries ONLY (Prisma/Drizzle with type-safe queries)
- NoSQL: Schema validation on every document write
- HTML output: Context-aware output encoding (OWASP rules)
- File uploads: Validate MIME type, scan for malware, store outside webroot
- API payloads: JSON Schema validation with strict mode (additionalProperties: false)
- GraphQL: Query depth limiting (max 10), query cost analysis, introspection disabled in production
- Rate limiting: Per-tenant, per-endpoint, per-agent with sliding window
- Request size: Hard limits on all endpoints (default 1MB, configurable per-route)

FORBIDDEN:
- String concatenation for SQL/NoSQL queries
- eval(), Function(), or dynamic code execution on user input
- Deserializing untrusted data without schema validation
- Disabling CSRF protection
- Trusting Content-Type headers without verification
- Regex without ReDoS protection (use RE2 or timeout)
```

### Rule 5 — Secrets Management

```
REQUIRED:
- All secrets: External secret manager (Vault / AWS Secrets Manager / GCP Secret Manager)
- Environment variables: For non-sensitive configuration ONLY
- .env files: Development only, NEVER committed, in .gitignore
- CI/CD secrets: Platform-native secret storage (GitHub Actions secrets, etc.)
- Rotation: Automated, maximum 90 days, zero-downtime
- Access: Least privilege, audit-logged, short-lived leases
- Scanning: Pre-commit hooks scanning for secrets (gitleaks/trufflehog)

FORBIDDEN:
- Secrets in source code, config files, or environment variable defaults
- Secrets in Docker images or build artifacts
- Secrets in log output (mask/redact)
- Sharing secrets between environments (dev/staging/prod)
- Long-lived API tokens without rotation schedule
```

### Rule 6 — Data Classification & PHI Handling

```
DATA CLASSIFICATION:
- PUBLIC: Marketing content, public API docs
- INTERNAL: Business metrics, non-PII operational data
- CONFIDENTIAL: PII (names, emails, phone numbers)
- RESTRICTED: PHI, financial data, credentials, encryption keys

REQUIRED FOR RESTRICTED DATA:
- Application-layer encryption before storage
- Field-level encryption for PHI columns
- Access logged with full audit trail
- Minimum necessary access principle
- Data masking in non-production environments
- BAA (Business Associate Agreement) with every subprocessor touching PHI
- Breach notification workflow: detect → assess → notify within 60 days (HIPAA)
- Right to erasure: Cryptographic erasure (destroy encryption key)

FORBIDDEN:
- PHI in log files, error messages, or stack traces
- PHI in URLs, query strings, or path parameters
- PHI in client-side storage (localStorage, cookies, sessionStorage)
- Copying production PHI to development/staging
- PHI transmission without encryption
- PHI access without business justification logged
```

### Rule 7 — Error Handling & Information Disclosure

```
REQUIRED:
- All errors: Catch, log internally with full context, return safe message to client
- Error responses: Generic message + correlation ID (client can reference for support)
- Stack traces: NEVER exposed to clients in any environment
- Error logging: Include correlation ID, timestamp, service, tenant_id (not PHI)
- Graceful degradation: Circuit breakers on all external dependencies
- Structured error codes: Enum-based, documented, consistent across services

FORBIDDEN:
- Exposing internal paths, versions, or technology stack in error responses
- Catching and silently swallowing exceptions
- Returning database error messages to clients
- Logging sensitive data in error context
- Panicking/crashing on recoverable errors
```

### Rule 8 — Dependency & Supply Chain Security

```
REQUIRED:
- Dependency scanning: Automated on every PR (Snyk / Dependabot / Trivy)
- License compliance: Only OSI-approved licenses (MIT, Apache-2.0, BSD, ISC, MPL-2.0)
- Lock files: Always committed (package-lock.json, yarn.lock, Cargo.lock, go.sum)
- Docker images: Distroless or Alpine base, multi-stage builds, non-root user
- SBOM: Generated for every release (SPDX or CycloneDX format)
- Signature verification: All artifacts signed (Sigstore/cosign)
- Base image scanning: Weekly automated scans of all container images
- Pinned versions: Exact versions in production, no floating ranges

FORBIDDEN:
- Running containers as root
- Using :latest tag in production
- Dependencies with known critical/high CVEs (must patch within 48 hours)
- Dependencies without active maintenance (no commits in 12+ months requires review)
- Installing packages from untrusted registries
```

### Rule 9 — Agent Safety & AI Governance

```
REQUIRED:
- Every agent output: Validated against JSON schema before execution
- Every customer-facing message: Compliance rules engine check before delivery
- Hallucination containment: RAG grounding + multi-agent verification + confidence scoring
- Confidence threshold: Actions below 0.7 confidence → human review queue
- Agent permissions: Explicit tool allowlist per agent role (principle of least privilege)
- Agent budgets: Token limits, action limits, cost limits per execution
- Kill switch: Immediate agent termination capability at tenant and global level
- Audit trail: Full prompt → reasoning → action → outcome chain logged (WORM)
- Human-in-the-loop: Mandatory for financial actions, PHI access, mass communications
- Rollback: Every agent action must be reversible or flagged as irreversible before execution

FORBIDDEN:
- Agents with unrestricted tool access
- Agent actions without audit logging
- LLM output treated as trusted (always validate)
- Agents modifying their own permission boundaries
- Agents accessing data outside their tenant scope
- Deploying agents without safety testing in sandbox first
```

### Rule 10 — Infrastructure & Deployment Security

```
REQUIRED:
- Infrastructure as Code: Terraform/Pulumi, version controlled, peer reviewed
- Network: Zero-trust — all traffic authenticated, no implicit trust zones
- Kubernetes: Pod Security Standards (restricted), NetworkPolicies, ResourceQuotas
- Secrets: Never in IaC state files (use external references)
- Deployment: Blue-green or canary with automatic rollback on health check failure
- Monitoring: Real-time alerting on security events (failed auth, privilege escalation, audit chain breaks)
- Backup: Encrypted, tested monthly, stored in separate region
- Incident response: Documented runbook, tested quarterly
- Penetration testing: Annual third-party assessment minimum

FORBIDDEN:
- Direct SSH/RDP to production (use bastion + session recording)
- Public-facing databases or caches
- Security groups with 0.0.0.0/0 ingress (except load balancer on 443)
- Disabling security scanning in CI/CD
- Deploying without passing all security gates
- Manual production changes without change management record
```

---

## COMPLIANCE GATE ENFORCEMENT

Every Pull Request MUST pass:

1. **Static Analysis** — No critical/high findings (Semgrep, ESLint security rules)
2. **Dependency Scan** — No known critical/high CVEs
3. **Secret Scan** — Zero secrets detected (gitleaks)
4. **Type Safety** — Full TypeScript strict mode, no `any` types in security-sensitive code
5. **Test Coverage** — Minimum 80% line coverage, 100% on auth/audit/encryption paths
6. **Audit Log Check** — All state-changing endpoints have audit events
7. **Access Control Check** — All endpoints have authorization middleware
8. **PHI Check** — No PHI in logs, errors, or client responses
9. **Encryption Check** — All RESTRICTED data encrypted before storage
10. **Peer Review** — Minimum 1 reviewer for standard, 2 for security-sensitive changes

**A PR that fails ANY gate MUST NOT be merged. No override. No exceptions.**

---

## ARCHITECTURE PRINCIPLES

1. **Event Sourcing** — Kafka is the single source of truth. All stores are projections.
2. **CQRS** — Command and query paths are separated.
3. **Multi-Tenant Isolation** — tenant_id derived server-side, RLS enforced at database.
4. **Zero Trust** — Every request authenticated, every action authorized.
5. **Defense in Depth** — Multiple security layers; no single point of failure.
6. **Immutable Audit** — WORM logs with Merkle tree verification.
7. **Compliance by Default** — SOC2/ISO27001/HIPAA controls are automatic, not optional.
8. **Agent Safety First** — AI agents are bounded, audited, and killable.

---

## TECH STACK (Locked)

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Language | TypeScript (strict) | Type safety, ecosystem, team velocity |
| Runtime | Node.js 22 LTS + Bun (build) | Performance, LTS stability |
| API | Hono (edge-ready) | Speed, standards-based, minimal surface |
| ORM | Drizzle ORM | Type-safe SQL, no magic, full control |
| Database | PostgreSQL 16+ (RLS) | ACID, RLS, pgvector, battle-tested |
| Event Stream | Apache Kafka (Confluent) | Event sourcing backbone, schema registry |
| Graph | Neo4j Aura | Customer relationship modeling |
| Analytics | ClickHouse | OLAP at billions-scale |
| Vector | pgvector + pgvectorscale | AI memory, 75% cheaper than Pinecone |
| Cache | Redis 7+ (ACL) | Session, rate limiting, real-time scores |
| Auth | WorkOS + custom JWT | Enterprise SSO, SCIM, tenant RBAC |
| AI Orchestration | LangGraph + Claude API | Multi-agent workflows |
| Communication | Twilio (SMS/Voice/IVR) + SendGrid (email) | Multi-channel execution |
| IaC | Terraform | Infrastructure reproducibility |
| CI/CD | GitHub Actions | Automated compliance gates |
| Monitoring | Grafana + Prometheus + Loki | Observability stack |
| Secret Management | HashiCorp Vault | HSM-backed secret lifecycle |

---

## PROJECT STRUCTURE

```
ORDR-Connect/
├── CLAUDE.md                    ← This file (the law)
├── Data/                        ← Business + Technical documentation
│   ├── Business/
│   └── Technical/
├── Research/                    ← Market research and blueprints
├── .claude/                     ← NEXUS skills, memory, state
├── apps/
│   ├── api/                     ← Core API (Hono)
│   ├── web/                     ← Dashboard (React/Next.js)
│   ├── agent-runtime/           ← AI Agent execution environment
│   └── worker/                  ← Background job processing
├── packages/
│   ├── core/                    ← Shared business logic
│   ├── db/                      ← Drizzle schemas, migrations, RLS policies
│   ├── auth/                    ← Auth module (WorkOS + JWT + RBAC/ABAC)
│   ├── audit/                   ← WORM audit logging + Merkle tree
│   ├── crypto/                  ← Encryption utilities (AES-256-GCM, field-level)
│   ├── events/                  ← Kafka producers/consumers + schema registry
│   ├── compliance/              ← Rules engine for regulatory enforcement
│   ├── graph/                   ← Neo4j client + Customer Graph operations
│   ├── channels/                ← Multi-channel delivery (Twilio, SendGrid, Slack)
│   └── ai/                      ← LLM abstraction, prompt management, safety
├── infrastructure/
│   ├── terraform/               ← IaC definitions
│   ├── kubernetes/              ← K8s manifests
│   └── docker/                  ← Dockerfiles (distroless, non-root)
├── security/
│   ├── policies/                ← OPA/Rego policies
│   ├── schemas/                 ← JSON Schema definitions for validation
│   └── threat-models/           ← STRIDE threat models per component
└── tests/
    ├── unit/
    ├── integration/
    ├── security/                ← Security-specific test suites
    └── compliance/              ← Compliance verification tests
```

---

## GIT WORKFLOW

- `main` — Production. Protected. Requires all compliance gates + 2 reviewers.
- `staging` — Pre-production. Requires all compliance gates + 1 reviewer.
- `develop` — Integration. Requires all compliance gates.
- Feature branches: `feat/`, `fix/`, `security/`, `compliance/`
- Every commit signed (GPG/SSH).
- No force pushes to main, staging, or develop.

---

## INCIDENT CLASSIFICATION

| Severity | Description | Response Time | Example |
|----------|-------------|---------------|---------|
| **P0 — Critical** | Data breach, PHI exposure, audit chain broken | 15 minutes | Unauthorized data access |
| **P1 — High** | Auth bypass, agent safety failure, compliance violation | 1 hour | Agent exceeding permissions |
| **P2 — Medium** | Security scan failure, dependency CVE | 24 hours | High-severity CVE in dependency |
| **P3 — Low** | Best practice deviation, minor config issue | 1 week | Missing rate limit on internal endpoint |
