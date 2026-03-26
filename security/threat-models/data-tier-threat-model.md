# Data Tier Threat Model — STRIDE Analysis

**System:** ORDR-Connect Data Layer (PostgreSQL, Redis, Kafka, Neo4j, ClickHouse)
**Scope:** All data stores and event streams
**Review date:** 2026-03-25
**Reviewer:** Security Architecture Team

---

## Assets

| Asset | Classification | Description |
|-------|---------------|-------------|
| Customer records | RESTRICTED | PII/PHI stored with field-level encryption |
| Audit logs | RESTRICTED | WORM compliance trail with hash chain |
| Session store | RESTRICTED | Hashed refresh tokens and session metadata |
| API key hashes | RESTRICTED | SHA-256 hashed API keys |
| Kafka events | CONFIDENTIAL | Domain events with tenant isolation |
| Neo4j graph | CONFIDENTIAL | Customer relationship topology |
| ClickHouse analytics | INTERNAL | Aggregated OLAP metrics |
| Redis cache | CONFIDENTIAL | Rate limit counters, session state |

---

## Threat: Spoofing

### S-DAT-01: Database Connection Spoofing

- **Attack:** Malicious service connects to the database impersonating a legitimate service.
- **Mitigation:** TLS mandatory for all database connections with certificate verification. mTLS for service-to-database connections. Connection credentials via HashiCorp Vault with short-lived leases.
- **Control:** ISO 27001 A.13.1.1
- **Residual risk:** LOW.

---

## Threat: Tampering

### T-DAT-01: Audit Log Tampering

- **Attack:** Attacker modifies or deletes audit records to cover tracks.
- **Mitigation:** WORM enforcement: PostgreSQL triggers block UPDATE/DELETE on audit tables. SHA-256 hash chain links every event to its predecessor. Merkle tree batch verification every 1000 events. S3 Object Lock replication (Compliance mode). 7-year retention.
- **Control:** SOC2 CC7.2, HIPAA §164.312(b)
- **Residual risk:** VERY LOW. Multiple layers: DB triggers, hash chain, Merkle tree, off-site replication.

### T-DAT-02: Side-Channel Attacks on Encrypted Data

- **Attack:** Attacker infers plaintext from encryption patterns (ciphertext length, timing).
- **Mitigation:** AES-256-GCM with unique IV per encryption. Field-level encryption uses HKDF-derived per-field keys. Constant-time comparison for auth operations (timingSafeEqual). Padding applied to normalize ciphertext lengths.
- **Control:** ISO 27001 A.10.1.1
- **Residual risk:** LOW. AES-GCM with random IVs mitigates most side-channel vectors.

### T-DAT-03: SQL Injection via ORM Boundaries

- **Attack:** Attacker exploits edge cases in the ORM to inject raw SQL.
- **Mitigation:** Drizzle ORM with type-safe parameterized queries. No raw SQL construction. Zod schema validation on all inputs before they reach the ORM. SQL injection test suite in tests/security/.
- **Control:** ISO 27001 A.14.2.5
- **Residual risk:** VERY LOW. Type-safe ORM + input validation.

### T-DAT-04: Cross-Tenant Data Leakage via RLS Bypass

- **Attack:** Query bypasses PostgreSQL Row-Level Security to access another tenant's data.
- **Mitigation:** RLS policies on every tenant-scoped table. tenant_id derived from JWT server-side and set as session variable. Application-level tenant filtering as defense-in-depth. Integration tests verify RLS enforcement.
- **Control:** SOC2 CC6.1
- **Residual risk:** LOW. Requires both RLS and application-level bypass.

---

## Threat: Repudiation

### R-DAT-01: Undetected Data Modification

- **Attack:** Data is modified without an audit trail entry.
- **Mitigation:** Audit middleware logs all state-changing operations. Database triggers on critical tables. Event sourcing through Kafka provides an independent record. Hash chain and Merkle tree detect gaps.
- **Control:** SOC2 CC7.2
- **Residual risk:** VERY LOW.

---

## Threat: Information Disclosure

### I-DAT-01: Database Breach — PII Exposure

- **Attack:** Attacker gains read access to the database and extracts customer PII.
- **Mitigation:** Field-level encryption on all PII fields (name, email, phone) using per-field derived keys (field-encryption.ts). AES-256-GCM encryption before storage. Master key in HSM (AWS KMS). Even with full database access, encrypted fields are unreadable without the key.
- **Control:** HIPAA §164.312(a)(2)(iv)
- **Residual risk:** LOW. Depends on HSM key security.

### I-DAT-02: Cache Data Exposure

- **Attack:** Redis cache exposed, revealing session tokens or rate limit state.
- **Mitigation:** Redis ACLs restricting access. Session tokens stored as SHA-256 hashes (never raw). TLS for Redis connections. No PHI in cache (only IDs and counters).
- **Control:** SOC2 CC6.1
- **Residual risk:** LOW.

### I-DAT-03: Kafka Event Interception

- **Attack:** Attacker intercepts Kafka events containing sensitive data.
- **Mitigation:** Kafka with TLS encryption (Confluent Cloud). Event payloads do not contain plaintext PHI (use tokenized references). Schema registry validates event structure.
- **Control:** ISO 27001 A.13.1.1
- **Residual risk:** LOW.

---

## Threat: Denial of Service

### D-DAT-01: Database Connection Exhaustion

- **Attack:** Attacker opens excessive connections to exhaust the database connection pool.
- **Mitigation:** Connection pooling with hard limits. Per-tenant rate limiting at the API layer. Circuit breakers on database connections. Resource quotas in Kubernetes.
- **Control:** SOC2 CC6.6
- **Residual risk:** MEDIUM. Requires monitoring and auto-scaling.

### D-DAT-02: Storage Exhaustion

- **Attack:** Attacker creates excessive records to exhaust storage.
- **Mitigation:** Per-tenant rate limiting. Record count quotas per tenant plan. Automatic alerting on abnormal growth. Separate storage for audit logs.
- **Control:** SOC2 CC6.6
- **Residual risk:** LOW.

---

## Threat: Elevation of Privilege

### E-DAT-01: RLS Policy Bypass via Superuser

- **Attack:** Application uses a superuser database role that bypasses RLS.
- **Mitigation:** Application connects with a restricted database role. Superuser access only via bastion + session recording. RLS policies tested in CI/CD. Database role has no BYPASSRLS privilege.
- **Control:** SOC2 CC6.3
- **Residual risk:** LOW.

### E-DAT-02: Key Rotation Lag Exploitation

- **Attack:** Attacker exploits an old encryption key that should have been rotated.
- **Mitigation:** Automated key rotation on 90-day cycle. Key version tracked in encrypted data format (iv:authTag:ciphertext:keyVersion). Old keys retained for decryption but not used for new encryption.
- **Control:** ISO 27001 A.10.1.2
- **Residual risk:** LOW.
