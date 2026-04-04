# Phase 51 — GDPR Data Subject Request (DSR) Design

**Date:** 2026-04-03
**Status:** Approved for implementation
**Regulation:** GDPR Art. 12, 15, 17, 20 | HIPAA §164.524

---

## Goal

Implement a compliant GDPR Data Subject Request (DSR) system allowing tenant admins to submit, approve, and fulfil access, portability, and erasure requests on behalf of their customers (data subjects). Covers the full lifecycle: request creation → admin approval → background export/erasure → WORM audit trail.

---

## Scope

- **In scope:** DSR types `access`, `portability`, `erasure`. Tenant-admin-initiated only (Option A). Async export via S3 presigned URL. Cryptographic erasure via key destruction.
- **Out of scope:** Data subject self-service portal, Synexiun-level tenant erasure, rectification requests, CCPA/CPRA (separate phase).

---

## Architecture

**Approach:** New `apps/api/src/routes/dsr.ts` route module + background worker job in `apps/worker/` + two new Drizzle schema tables in `packages/db/`. Reuses existing `CryptographicErasure` (packages/crypto), `FieldEncryptor` (packages/crypto), `AuditLogger` (packages/audit), `EnvelopeEncryption` (packages/crypto), and S3 audit bucket (already provisioned in Terraform).

**Flow:**
```
Tenant admin → POST /v1/dsr → DB: data_subject_requests (pending)
             → POST /v1/dsr/:id/approve → Kafka: dsr.approved
             → Worker: export job → S3 encrypted archive
             → Worker: (erasure only) CryptographicErasure.executeErasure()
             → DB: dsr_exports + status=completed
             → Tenant admin → GET /v1/dsr/:id → presigned S3 URL (24h)
```

---

## 1. Data Model

### Migration 0011

New file: `packages/db/src/migrations/0011_dsr_tables.sql`

### Table: `data_subject_requests`

```sql
CREATE TABLE data_subject_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  type            TEXT NOT NULL CHECK (type IN ('access', 'erasure', 'portability')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','processing','completed','rejected','cancelled')),
  requested_by    TEXT NOT NULL,       -- actor ID (tenant admin user ID)
  reason          TEXT,                -- optional justification (required for erasure)
  deadline_at     TIMESTAMPTZ NOT NULL, -- created_at + 30 days (GDPR Art. 12)
  completed_at    TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY dsr_tenant_isolation ON data_subject_requests
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Indexes
CREATE INDEX idx_dsr_tenant_status ON data_subject_requests (tenant_id, status);
CREATE INDEX idx_dsr_deadline ON data_subject_requests (deadline_at) WHERE status NOT IN ('completed','rejected','cancelled');
CREATE INDEX idx_dsr_customer ON data_subject_requests (customer_id);
```

### Table: `dsr_exports`

```sql
CREATE TABLE dsr_exports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dsr_id           UUID NOT NULL REFERENCES data_subject_requests(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  s3_key           TEXT NOT NULL,           -- path: dsr-exports/{tenantId}/{dsrId}/{uuid}.json.enc
  s3_bucket        TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,    -- now + 24h
  file_size_bytes  BIGINT,
  checksum_sha256  TEXT NOT NULL,           -- SHA-256 of encrypted ciphertext
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE dsr_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY dsr_exports_tenant_isolation ON dsr_exports
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

### Drizzle Schema Files

- Create: `packages/db/src/schema/dsr.ts` — Drizzle table definitions for both tables
- Modify: `packages/db/src/schema/index.ts` — export `dataSubjectRequests`, `dsrExports`

---

## 2. API Endpoints

### New file: `apps/api/src/routes/dsr.ts`

Mounted at `/v1/dsr`. All routes require:
- JWT auth middleware
- RBAC: `dsr:read` (GET) / `dsr:write` (POST, DELETE)
- Rate limiting: 20 req/min per tenant
- Audit log on every mutation

#### `POST /v1/dsr`

Create a new DSR.

**Request body (Zod):**
```typescript
z.object({
  customerId: z.string().uuid(),
  type: z.enum(['access', 'erasure', 'portability']),
  reason: z.string().max(1000).optional(),
})
```

**Logic:**
1. Verify `customerId` belongs to the requesting tenant (RLS + explicit check)
2. Reject if an open DSR already exists for this customer+type (status `pending | approved | processing`)
3. Insert `data_subject_requests` with `deadline_at = now() + 30 days`
4. Emit audit event: `dsr.requested`

**Response:** `201 { id, customerId, type, status: 'pending', deadline_at }`

---

#### `GET /v1/dsr`

List DSRs for the tenant.

**Query params:**
```typescript
z.object({
  status: z.enum(['pending','approved','processing','completed','rejected','cancelled']).optional(),
  type: z.enum(['access','erasure','portability']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
```

**Response:** `200 { items: DSR[], total, page, overdue_count }`

`overdue_count` = count of DSRs where `deadline_at < now()` and `status IN ('pending','approved','processing')`.

---

#### `GET /v1/dsr/:id`

Get DSR detail. If `status = 'completed'` and a `dsr_exports` row exists, generate a fresh S3 presigned GET URL (24h TTL) and include it in the response. Verify `checksum_sha256` before issuing the URL.

**Response:**
```typescript
{
  id, customerId, type, status, reason, deadline_at, completed_at, rejection_reason,
  export?: {
    download_url: string,   // presigned, 24h TTL
    expires_at: string,
    file_size_bytes: number,
    checksum_sha256: string,
  }
}
```

---

#### `POST /v1/dsr/:id/approve`

Approve a pending DSR. Transitions `pending → processing`.

**Logic:**
1. Verify DSR is in `pending` status
2. Verify DSR belongs to the requesting tenant
3. Update status → `processing`
4. Publish Kafka message to topic `dsr.approved`: `{ dsrId, tenantId, customerId, type }`
5. Emit audit: `dsr.approved`

**Response:** `200 { id, status: 'processing' }`

---

#### `POST /v1/dsr/:id/reject`

Reject a pending DSR.

**Request body:**
```typescript
z.object({ reason: z.string().min(1).max(1000) })
```

**Logic:**
1. Verify DSR is in `pending` status
2. Update status → `rejected`, set `rejection_reason`
3. Emit audit: `dsr.rejected`

**Response:** `200 { id, status: 'rejected' }`

---

#### `DELETE /v1/dsr/:id`

Cancel a DSR. Only allowed when `status = 'pending'`.

**Logic:**
1. Verify status is `pending`
2. Update status → `cancelled`
3. Emit audit: `dsr.cancelled`

**Response:** `200 { id, status: 'cancelled' }`

---

## 3. Worker Job

### New file: `apps/worker/src/handlers/dsr-export.ts`

Subscribes to Kafka topic `dsr.approved`. Handles both export and erasure flows.

#### Export Job (type = `access` | `portability`)

```
1. Load + decrypt customer profile (FieldEncryptor: name, email, phone)
2. Load + decrypt contacts (FieldEncryptor: value)
3. Load consent_records (WORM, no decryption)
4. Load tickets (+ messages per ticket)
5. Load agent_memories (FieldEncryptor: content)
6. Load interaction analytics (health score, ticket counts, channel breakdown)
7. Assemble JSON archive:
   {
     meta: {
       schema_version: '1.0',
       dsr_id, customer_id, tenant_id,
       exported_at: ISO8601,
       regulations: ['GDPR_Art15', 'GDPR_Art20']
     },
     profile: { name, email, phone, type, status, created_at },
     contacts: [{ channel, value, consent_status, created_at }],
     consent_history: [{ channel, action, recorded_at, evidence_ref }],
     tickets: [{ id, subject, status, messages: [...] }],
     conversations: [{ id, channel, messages: [...] }],
     agent_memory: [{ content, created_at }],
     analytics: { health_score, ticket_count, ... }
   }
8. Generate per-export DEK via EnvelopeEncryption
9. AES-256-GCM encrypt the JSON string
10. Compute SHA-256 of ciphertext
11. Upload to S3: dsr-exports/{tenantId}/{dsrId}/{exportId}.json.enc
12. Insert dsr_exports row: s3_key, s3_bucket, expires_at=now()+24h, checksum_sha256, file_size_bytes
13. Update data_subject_requests: status=completed, completed_at=now()
14. Emit audit: dsr.exported (dsrId, checksum — no PHI)
```

#### Erasure Job (type = `erasure`)

```
1. Run export job first (GDPR Art. 15: right to access before erasure)
2. CryptographicErasure.scheduleErasure(tenantId, customerId, reason)
   → Emits audit: dsr.erasure_scheduled
3. CryptographicErasure.executeErasure(record)
   → Destroys derived HKDF key for this customer
   → Emits audit: dsr.erasure_executed
4. CryptographicErasure.verifyErasure(record)
   → Confirms key no longer readable
   → Emits audit: dsr.erasure_verified
5. Pseudonymise customer row (UPDATE in single transaction):
   - name     → '[erased]'
   - email    → SHA-256(original_email) (preserves uniqueness for dedup, irrecoverable)
   - phone    → null
   - Preserves id, tenant_id, created_at for FK integrity (tickets, audit logs)
6. Update data_subject_requests: status=completed, completed_at=now()
```

#### Error Handling

- Any step failure → status stays `processing`
- Exponential backoff retry: 3 attempts (30s, 2m, 10m)
- After max retries → status=`failed`, emit audit: `dsr.failed`
- In-app notification to tenant admin via `packages/notifications`

---

## 4. Audit Integration

### New audit event types

Add to `packages/audit/src/types.ts` `AuditEventType` union:

```typescript
| 'dsr.requested'
| 'dsr.approved'
| 'dsr.rejected'
| 'dsr.cancelled'
| 'dsr.exported'
| 'dsr.failed'
| 'dsr.erasure_scheduled'
| 'dsr.erasure_executed'
| 'dsr.erasure_verified'
```

**Payload rules (HIPAA/GDPR):** No PII in audit `details`. Use opaque IDs only:
```typescript
// dsr.exported example
{
  eventType: 'dsr.exported',
  resource: 'data_subject_request',
  resourceId: dsrId,
  details: {
    dsr_type: 'access',
    checksum_sha256: '...',
    file_size_bytes: 142000,
    // NO name, email, phone, message content
  }
}
```

All events flow through existing `AuditLogger` → WORM hash chain → Merkle batching. No new infrastructure required.

---

## 5. Deadline Enforcement

### New scheduler job: `packages/scheduler/src/jobs/dsr-deadline-check.ts`

Runs daily (cron: `0 9 * * *`). Queries across all tenants (no RLS — service account with limited SELECT):

```sql
SELECT id, tenant_id, deadline_at, status
FROM data_subject_requests
WHERE status IN ('pending', 'approved', 'processing')
  AND deadline_at < now() + INTERVAL '3 days'
```

For each result → emits `compliance.violation` audit event + in-app notification to tenant admin.

---

## 6. Security Controls

| Control | Implementation |
|---------|---------------|
| Tenant isolation | RLS on both tables + explicit tenant check in route middleware |
| Export encryption | Per-export DEK (EnvelopeEncryption) — S3 object never stored in plaintext |
| Download auth | Presigned URL valid 24h; re-generated on each GET /v1/dsr/:id request |
| Checksum | SHA-256 of ciphertext verified before issuing presigned URL |
| RBAC | `dsr:read` / `dsr:write` permissions, tenant admin and above |
| Rate limiting | 20 req/min per tenant |
| Audit | All mutations WORM-logged; no PHI in audit payload |
| Erasure verification | `CryptographicErasure.verifyErasure()` confirms irrecoverability before completing |
| S3 expiry | Object deleted after `expires_at` via existing S3 lifecycle policy |

---

## 7. Files Created / Modified

### Created
- `packages/db/src/schema/dsr.ts` — Drizzle schema for both tables
- `packages/db/src/migrations/0011_dsr_tables.sql` — SQL migration
- `apps/api/src/routes/dsr.ts` — 6 API endpoints
- `apps/worker/src/handlers/dsr-export.ts` — export + erasure job handler
- `packages/scheduler/src/jobs/dsr-deadline-check.ts` — daily deadline enforcement
- `apps/api/src/__tests__/dsr.test.ts` — route unit tests
- `apps/worker/src/__tests__/dsr-export.test.ts` — worker unit tests

### Modified
- `packages/db/src/schema/index.ts` — export `dataSubjectRequests`, `dsrExports`
- `packages/audit/src/types.ts` — add 9 new `AuditEventType` values
- `apps/api/src/server.ts` — mount `/v1/dsr` router
- `apps/worker/src/index.ts` — register `dsr.approved` Kafka consumer

---

## 8. Testing Strategy

| Test | Location | What it covers |
|------|----------|---------------|
| Route unit tests | `apps/api/src/__tests__/dsr.test.ts` | All 6 endpoints, auth, validation, RBAC, duplicate DSR rejection |
| Worker unit tests | `apps/worker/src/__tests__/dsr-export.test.ts` | Export assembly, encryption, S3 upload, erasure flow, retry logic |
| Compliance test | `tests/compliance/check-dsr-audit-events.sh` | Verifies all 9 DSR event types are present in audit types |
| Integration | Existing integration test suite | Full lifecycle: create → approve → worker → completed |

**Coverage target:** 100% on erasure path (CLAUDE.md Rule 5: 100% on auth/audit/encryption paths).

---

## 9. GDPR Compliance Mapping

| GDPR Article | Implementation |
|-------------|---------------|
| Art. 12 — Timely response | `deadline_at = created_at + 30d`; daily deadline check job |
| Art. 15 — Right of access | `access` DSR type → full JSON export |
| Art. 17 — Right to erasure | `erasure` type → export first, then cryptographic erasure + pseudonymisation |
| Art. 20 — Data portability | `portability` type → same export as access (JSON, machine-readable) |
| Art. 30 — Records of processing | WORM audit log for all DSR operations |
| Art. 5(1)(f) — Integrity/confidentiality | Per-export DEK encryption, presigned URL auth, S3 auto-expiry |
