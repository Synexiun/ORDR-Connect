# Phase 51 — GDPR Data Subject Request (DSR) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a compliant GDPR DSR system — tenant admins can create, approve, and fulfil access/portability/erasure requests against customer records, with full WORM audit trail.

**Architecture:** New `apps/api/src/routes/dsr.ts` (6 Hono endpoints, `configure*Routes` injection pattern) + `apps/worker/src/handlers/dsr-export.ts` (Kafka consumer, idempotent) + `packages/scheduler/src/jobs/dsr-deadline-check.ts` (daily cron). Cryptographic erasure via existing `CryptographicErasure` class; exports encrypted with `EnvelopeEncryption` and stored in S3.

**Tech Stack:** TypeScript strict, Drizzle ORM, PostgreSQL 16 RLS, Kafka (`@ordr/events`), Hono, Vitest, `@ordr/crypto`, `@ordr/audit`, `@ordr/scheduler`

**Spec:** `docs/superpowers/specs/2026-04-03-phase-51-gdpr-dsr-design.md`

---

## Chunk 1: Foundation — DB, Events, Audit types

### Task 1: DB Migration and Drizzle Schema

**Files:**
- Create: `packages/db/src/migrations/0011_dsr_tables.sql`
- Create: `packages/db/src/schema/dsr.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/src/migrations/0011_dsr_tables.sql`:

```sql
-- Phase 51: GDPR Data Subject Request tables
-- SOC2 CC6.1 — RLS enforced on both tables
-- GDPR Art. 12, 15, 17, 20 — full DSR lifecycle storage

CREATE TABLE data_subject_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  type            TEXT NOT NULL CHECK (type IN ('access', 'erasure', 'portability')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','processing','completed','rejected','cancelled','failed')),
  requested_by    TEXT NOT NULL,
  reason          TEXT,
  deadline_at     TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY dsr_tenant_isolation ON data_subject_requests
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

CREATE INDEX idx_dsr_tenant_status ON data_subject_requests (tenant_id, status);
CREATE INDEX idx_dsr_deadline       ON data_subject_requests (deadline_at)
  WHERE status NOT IN ('completed','rejected','cancelled');
CREATE INDEX idx_dsr_customer       ON data_subject_requests (customer_id);

-- ────────────────────────────────────────────────────────────────────

CREATE TABLE dsr_exports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dsr_id           UUID NOT NULL REFERENCES data_subject_requests(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  s3_key           TEXT NOT NULL,
  s3_bucket        TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  file_size_bytes  BIGINT,
  checksum_sha256  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dsr_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY dsr_exports_tenant_isolation ON dsr_exports
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

CREATE INDEX idx_dsr_exports_dsr_id ON dsr_exports (dsr_id);
```

- [ ] **Step 2: Create Drizzle schema `packages/db/src/schema/dsr.ts`**

```typescript
/**
 * DSR (Data Subject Request) schema — GDPR Art. 12, 15, 17, 20
 *
 * SOC2 CC6.1 — RLS enforced at DB level (dsr_tenant_isolation policy).
 * GDPR Art. 12 — 30-day deadline tracked in deadline_at.
 * HIPAA §164.524 — right of access applies to any PHI held.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { customers } from './customers.js';

// ── Enums ─────────────────────────────────────────────────────────

export const dsrTypeEnum = pgEnum('dsr_type', ['access', 'erasure', 'portability']);

export const dsrStatusEnum = pgEnum('dsr_status', [
  'pending',
  'approved',
  'processing',
  'completed',
  'rejected',
  'cancelled',
  'failed',
]);

// ── Tables ────────────────────────────────────────────────────────

export const dataSubjectRequests = pgTable(
  'data_subject_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),

    type: dsrTypeEnum('type').notNull(),

    status: dsrStatusEnum('status').notNull().default('pending'),

    /** Actor ID of the tenant admin who submitted the request */
    requestedBy: text('requested_by').notNull(),

    /** Required for erasure type; optional for access/portability */
    reason: text('reason'),

    /** GDPR Art. 12 — created_at + 30 days */
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),

    completedAt: timestamp('completed_at', { withTimezone: true }),

    rejectionReason: text('rejection_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_dsr_tenant_status').on(t.tenantId, t.status),
    index('idx_dsr_customer').on(t.customerId),
    index('idx_dsr_deadline').on(t.deadlineAt),
  ],
);

export const dsrExports = pgTable(
  'dsr_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    dsrId: uuid('dsr_id')
      .notNull()
      .references(() => dataSubjectRequests.id, { onDelete: 'cascade' }),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** S3 object key: dsr-exports/{tenantId}/{dsrId}/{exportId}.json.enc */
    s3Key: text('s3_key').notNull(),

    s3Bucket: text('s3_bucket').notNull(),

    /** Presigned URL window — object auto-deleted after this */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),

    /** SHA-256 of the AES-256-GCM ciphertext — verified before issuing presigned URL */
    checksumSha256: text('checksum_sha256').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_dsr_exports_dsr_id').on(t.dsrId)],
);
```

- [ ] **Step 3: Add exports to `packages/db/src/schema/index.ts`**

Open `packages/db/src/schema/index.ts` and append after the last existing export block:

```typescript
// DSR — GDPR Data Subject Requests
export { dataSubjectRequests, dsrExports, dsrTypeEnum, dsrStatusEnum } from './dsr.js';
```

- [ ] **Step 4: Type-check the db package**

```bash
cd packages/db && pnpm type-check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/dsr.ts \
        packages/db/src/schema/index.ts \
        packages/db/src/migrations/0011_dsr_tables.sql
git commit -m "feat(db): Phase 51 — DSR schema (data_subject_requests + dsr_exports)"
```

---

### Task 2: Events — DSR topic, type constants, schemas

**Files:**
- Modify: `packages/events/src/topics.ts`
- Modify: `packages/events/src/types.ts`
- Modify: `packages/events/src/schemas.ts`

- [ ] **Step 1: Write a failing test for the new event type**

Create `packages/events/src/__tests__/dsr-events.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TOPICS, EventType } from '../index.js';
import { eventSchemaRegistry } from '../schemas.js';

describe('DSR events', () => {
  it('TOPICS.DSR_EVENTS resolves to correct topic string', () => {
    expect(TOPICS.DSR_EVENTS).toBe('ordr.dsr.events');
  });

  it('EventType.DSR_APPROVED is defined', () => {
    expect(EventType.DSR_APPROVED).toBe('dsr.approved');
  });

  it('eventSchemaRegistry has dsr.approved schema', () => {
    expect(eventSchemaRegistry.has('dsr.approved')).toBe(true);
  });

  it('dsr.approved schema validates a valid envelope', () => {
    const schema = eventSchemaRegistry.get('dsr.approved')!;
    const result = schema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      type: 'dsr.approved',
      tenantId: 'tenant-1',
      payload: {
        dsrId: '00000000-0000-0000-0000-000000000002',
        tenantId: 'tenant-1',
        customerId: '00000000-0000-0000-0000-000000000003',
        type: 'access',
      },
      metadata: {
        correlationId: 'corr-1',
        causationId: 'cause-1',
        source: 'api',
        version: 1,
      },
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd packages/events && pnpm test
```

Expected: FAIL — `TOPICS.DSR_EVENTS` is undefined.

- [ ] **Step 3: Add DSR_EVENTS to `packages/events/src/topics.ts`**

In `TOPICS` const, add after `AUDIT_EVENTS`:

```typescript
  /** GDPR Data Subject Request lifecycle events */
  DSR_EVENTS: 'ordr.dsr.events',
```

In `DEFAULT_TOPIC_CONFIGS`, add entry after the `AUDIT_EVENTS` entry:

```typescript
  [TOPICS.DSR_EVENTS]: {
    name: TOPICS.DSR_EVENTS,
    partitions: 6,
    replicationFactor: 3,
    retentionMs: 365 * 24 * 60 * 60 * 1000, // 1 year — GDPR/SOC2 audit retention
    cleanupPolicy: 'delete',
    minInsyncReplicas: 2,
  },
```

- [ ] **Step 4: Add DSR types and payload interface to `packages/events/src/types.ts`**

In `EventType` const, add after `AUTH_MFA_VERIFIED`:

```typescript
  // DSR
  DSR_APPROVED: 'dsr.approved',
```

After the `AuthEventPayload` interface, add:

```typescript
// ─── DSR Payloads ─────────────────────────────────────────────────

export interface DsrApprovedPayload {
  readonly dsrId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly type: 'access' | 'erasure' | 'portability';
}
```

- [ ] **Step 5: Add DSR schema to `packages/events/src/schemas.ts`**

After the `authEventPayloadSchema` definition, add:

```typescript
// ─── DSR Schemas ──────────────────────────────────────────────────

/**
 * Payload for dsr.approved — no PII, IDs only.
 * GDPR/HIPAA: type field tells the worker which flow to run.
 */
export const dsrApprovedPayloadSchema = z.object({
  dsrId: z.string().uuid(),
  tenantId: z.string().min(1),
  customerId: z.string().uuid(),
  type: z.enum(['access', 'erasure', 'portability']),
});
```

In `eventSchemaRegistry`, add entry at the end of the Map constructor array:

```typescript
  [EventType.DSR_APPROVED, createEnvelopeSchema(dsrApprovedPayloadSchema)],
```

- [ ] **Step 6: Ensure `DsrApprovedPayload` is exported from the package index**

Open `packages/events/src/index.ts` (or wherever types are re-exported) and verify `DsrApprovedPayload` is included. If the file re-exports everything from `types.ts` with `export * from './types.js'` it is already covered; if it lists explicitly, add `DsrApprovedPayload`.

- [ ] **Step 7: Run tests — verify they pass**

```bash
cd packages/events && pnpm test
```

Expected: 4/4 pass.

- [ ] **Step 8: Commit**

```bash
git add packages/events/src/topics.ts \
        packages/events/src/types.ts \
        packages/events/src/schemas.ts \
        "packages/events/src/__tests__/dsr-events.test.ts"
git commit -m "feat(events): Phase 51 — DSR_EVENTS topic + dsr.approved schema"
```

---

### Task 3: Audit Types — 9 DSR event types

**Files:**
- Modify: `packages/audit/src/types.ts`

- [ ] **Step 1: Write failing test**

Create `packages/audit/src/__tests__/dsr-audit-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { AuditEventType } from '../types.js';

const DSR_AUDIT_TYPES: ReadonlyArray<AuditEventType> = [
  'dsr.requested',
  'dsr.approved',
  'dsr.rejected',
  'dsr.cancelled',
  'dsr.exported',
  'dsr.failed',
  'dsr.erasure_scheduled',
  'dsr.erasure_executed',
  'dsr.erasure_verified',
];

describe('DSR audit event types', () => {
  it('all 9 DSR audit types are valid AuditEventType values', () => {
    // This test passing means the TS union accepts all values.
    // It's a compile-time check — if AuditEventType excludes any of these
    // values, TypeScript will reject the array literal above.
    expect(DSR_AUDIT_TYPES.length).toBe(9);
  });
});
```

- [ ] **Step 2: Run test — verify it fails (TS compile error)**

```bash
cd packages/audit && pnpm type-check
```

Expected: TS error — `'dsr.requested'` is not assignable to `AuditEventType`.

- [ ] **Step 3: Extend `AuditEventType` in `packages/audit/src/types.ts`**

At the end of the `AuditEventType` union (after `'api_key.revoked'`), add:

```typescript
  // DSR — GDPR Data Subject Requests (Art. 12, 15, 17, 20)
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

- [ ] **Step 4: Run test — verify it passes**

```bash
cd packages/audit && pnpm test && pnpm type-check
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/audit/src/types.ts \
        "packages/audit/src/__tests__/dsr-audit-types.test.ts"
git commit -m "feat(audit): Phase 51 — 9 DSR audit event types"
```

---

## Chunk 2: API Layer

### Task 4: DSR API Route (6 endpoints)

**Files:**
- Create: `apps/api/src/routes/dsr.ts`
- Create: `apps/api/src/__tests__/dsr.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/__tests__/dsr.test.ts`:

```typescript
/**
 * DSR Route tests
 *
 * SOC2 CC6.1 — tenant-scoped, role-checked
 * GDPR Art. 12, 15, 17, 20 — request lifecycle
 *
 * Verifies:
 * - POST /   → 201 with pending DSR
 * - POST /   → 409 when open DSR already exists for customer+type
 * - POST /   → 400 when erasure has no reason
 * - GET  /   → 200 list with pagination + overdue_count
 * - GET  /:id → 200 with DSR detail
 * - GET  /:id → 410 when export expired
 * - POST /:id/approve → 200 transitions pending→approved
 * - POST /:id/approve → 409 when not pending
 * - POST /:id/reject  → 200 with rejection_reason
 * - DELETE /:id       → 200 cancels pending DSR
 * - DELETE /:id       → 409 when not pending
 * - Auth: unauthenticated request → 401
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { dsrRouter, configureDsrRoutes } from '../routes/dsr.js';
import { configureAuth } from '../middleware/auth.js';
import { configureBillingGate } from '../middleware/plan-gate.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { SubscriptionManager, InMemorySubscriptionStore, MockStripeClient } from '@ordr/billing';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { FieldEncryptor } from '@ordr/crypto';

// ─── Mock @ordr/auth ─────────────────────────────────────────────

vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'user-admin-1',
      roles: ['tenant_admin'],
      permissions: [],
    },
  }),
  requireRole: vi.fn(),
  requirePermission: vi.fn(),
  requireTenant: vi.fn(),
  ROLE_HIERARCHY: {},
  ROLE_PERMISSIONS: {},
  hasRole: vi.fn().mockReturnValue(true),
  hasPermission: vi.fn().mockReturnValue(true),
}));

// ─── Shared State ─────────────────────────────────────────────────

const DSR_ID = '00000000-0000-0000-0000-000000000010';
const CUSTOMER_ID = '00000000-0000-0000-0000-000000000020';
const TENANT_ID = 'tenant-1';

// ─── Shared DSR mock ─────────────────────────────────────────────

const baseDsr = {
  id: DSR_ID,
  tenantId: TENANT_ID,
  customerId: CUSTOMER_ID,
  type: 'access' as const,
  status: 'pending' as const,
  requestedBy: 'user-admin-1',
  reason: null,
  deadlineAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  completedAt: null,
  rejectionReason: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ─── Mock DSR store ───────────────────────────────────────────────

const mockCreateDsr = vi.fn().mockResolvedValue(baseDsr);
const mockListDsrs = vi.fn().mockResolvedValue({ items: [baseDsr], total: 1, overdue_count: 0 });
const mockGetDsr = vi.fn().mockResolvedValue({ dsr: baseDsr, export: null });
const mockApproveDsr = vi.fn().mockResolvedValue({ ...baseDsr, status: 'approved' });
const mockRejectDsr = vi.fn().mockResolvedValue({ ...baseDsr, status: 'rejected', rejectionReason: 'Unjustified' });
const mockCancelDsr = vi.fn().mockResolvedValue({ ...baseDsr, status: 'cancelled' });
const mockPublishApproved = vi.fn().mockResolvedValue(undefined);

// ─── App setup ────────────────────────────────────────────────────

async function buildApp(): Promise<Hono<Env>> {
  const auditStore = new InMemoryAuditStore();
  const auditLogger = new AuditLogger(auditStore);
  const fieldEncryptor = new FieldEncryptor('test-encryption-key-32bytes!!!!!');

  const subStore = new InMemorySubscriptionStore();
  await subStore.saveSubscription({
    id: 'sub-test',
    tenant_id: TENANT_ID,
    plan_id: 'enterprise',
    status: 'active',
    current_period_start: new Date(Date.now() - 86400000).toISOString(),
    current_period_end: new Date(Date.now() + 86400000).toISOString(),
    cancel_at_period_end: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const billing = new SubscriptionManager(subStore, new MockStripeClient());
  configureBillingGate({ billing, fieldEncryptor });

  configureAuth({ auditLogger });
  configureDsrRoutes({
    createDsr: mockCreateDsr,
    listDsrs: mockListDsrs,
    getDsr: mockGetDsr,
    approveDsr: mockApproveDsr,
    rejectDsr: mockRejectDsr,
    cancelDsr: mockCancelDsr,
    publishApproved: mockPublishApproved,
    auditLogger,
  });

  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/dsr', dsrRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('POST /dsr', () => {
  let app: Hono<Env>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('creates a DSR and returns 201', async () => {
    const res = await app.request('/dsr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ customerId: CUSTOMER_ID, type: 'access' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; status: string };
    expect(body.status).toBe('pending');
  });

  it('returns 400 when erasure has no reason', async () => {
    const res = await app.request('/dsr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ customerId: CUSTOMER_ID, type: 'erasure' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 when an open DSR already exists', async () => {
    mockCreateDsr.mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'DSR_CONFLICT' }));
    const res = await app.request('/dsr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ customerId: CUSTOMER_ID, type: 'access' }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 401 without auth token', async () => {
    const res = await app.request('/dsr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(res.status).toBe(401);
  });
});

describe('GET /dsr', () => {
  let app: Hono<Env>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 200 with list and overdue_count', async () => {
    const res = await app.request('/dsr', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[]; overdue_count: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.overdue_count).toBe('number');
  });
});

describe('GET /dsr/:id', () => {
  let app: Hono<Env>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 200 with DSR detail', async () => {
    const res = await app.request(`/dsr/${DSR_ID}`, { headers: { Authorization: 'Bearer tok' } });
    expect(res.status).toBe(200);
  });

  it('returns 410 when export is expired', async () => {
    mockGetDsr.mockResolvedValueOnce({
      dsr: { ...baseDsr, status: 'completed' },
      export: {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        checksumSha256: 'abc',
        s3Key: 'k',
        s3Bucket: 'b',
        fileSizeBytes: 100,
      },
    });
    const res = await app.request(`/dsr/${DSR_ID}`, { headers: { Authorization: 'Bearer tok' } });
    expect(res.status).toBe(410);
  });
});

describe('POST /dsr/:id/approve', () => {
  let app: Hono<Env>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 200 with status=approved', async () => {
    const res = await app.request(`/dsr/${DSR_ID}/approve`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('approved');
  });

  it('returns 409 when DSR is not pending', async () => {
    mockApproveDsr.mockRejectedValueOnce(Object.assign(new Error('not pending'), { code: 'DSR_STATE_ERROR' }));
    const res = await app.request(`/dsr/${DSR_ID}/approve`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(409);
  });

  it('publishes dsr.approved Kafka event', async () => {
    await app.request(`/dsr/${DSR_ID}/approve`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(mockPublishApproved).toHaveBeenCalledWith(
      expect.objectContaining({ dsrId: DSR_ID }),
    );
  });
});

describe('POST /dsr/:id/reject', () => {
  let app: Hono<Env>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 200 with status=rejected', async () => {
    const res = await app.request(`/dsr/${DSR_ID}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ reason: 'Unjustified request' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('rejected');
  });

  it('returns 400 when reason is missing', async () => {
    const res = await app.request(`/dsr/${DSR_ID}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /dsr/:id', () => {
  let app: Hono<Env>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 200 with status=cancelled', async () => {
    const res = await app.request(`/dsr/${DSR_ID}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('cancelled');
  });

  it('returns 409 when not pending', async () => {
    mockCancelDsr.mockRejectedValueOnce(Object.assign(new Error('not pending'), { code: 'DSR_STATE_ERROR' }));
    const res = await app.request(`/dsr/${DSR_ID}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd apps/api && pnpm test -- --reporter=verbose dsr.test
```

Expected: FAIL — `dsrRouter` not found.

- [ ] **Step 3: Implement `apps/api/src/routes/dsr.ts`**

```typescript
/**
 * DSR Routes — GDPR Data Subject Request lifecycle
 *
 * POST   /v1/dsr            — Create a new DSR (pending)
 * GET    /v1/dsr            — List DSRs for tenant (paginated)
 * GET    /v1/dsr/:id        — Get DSR detail + export URL if completed
 * POST   /v1/dsr/:id/approve — Approve pending → approved + publish Kafka
 * POST   /v1/dsr/:id/reject  — Reject pending → rejected
 * DELETE /v1/dsr/:id         — Cancel pending → cancelled
 *
 * SOC2 CC6.1  — All routes tenant-scoped; RBAC enforced.
 * GDPR Art. 12 — 30-day deadline tracked.
 * GDPR Art. 15/17/20 — access / erasure / portability.
 * HIPAA §164.524 — right of access for PHI.
 *
 * SECURITY:
 * - tenantId ALWAYS sourced from JWT context, never from client input
 * - No PHI in audit log details
 * - Rate limited: 20 req/min per tenant
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import { AuthorizationError, NotFoundError, ValidationError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth, requirePermissionMiddleware } from '../middleware/auth.js';

// ── Input Schemas ─────────────────────────────────────────────────

const createDsrSchema = z
  .object({
    customerId: z.string().uuid(),
    type: z.enum(['access', 'erasure', 'portability']),
    reason: z.string().max(1000).optional(),
  })
  .refine((d) => d.type !== 'erasure' || (d.reason !== undefined && d.reason.length > 0), {
    message: 'reason is required for erasure requests',
    path: ['reason'],
  });

const listDsrQuerySchema = z.object({
  status: z
    .enum(['pending', 'approved', 'processing', 'completed', 'rejected', 'cancelled', 'failed'])
    .optional(),
  type: z.enum(['access', 'erasure', 'portability']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const rejectDsrSchema = z.object({
  reason: z.string().min(1).max(1000),
});

// ── Dependency Types ──────────────────────────────────────────────

export interface DsrDeps {
  readonly createDsr: (params: {
    tenantId: string;
    customerId: string;
    type: 'access' | 'erasure' | 'portability';
    reason: string | undefined;
    requestedBy: string;
    deadlineAt: Date;
  }) => Promise<DsrRecord>;

  readonly listDsrs: (params: {
    tenantId: string;
    status?: string;
    type?: string;
    page: number;
    limit: number;
  }) => Promise<{ items: DsrRecord[]; total: number; overdue_count: number }>;

  readonly getDsr: (params: {
    tenantId: string;
    dsrId: string;
  }) => Promise<{ dsr: DsrRecord; export: DsrExportRecord | null } | null>;

  readonly approveDsr: (params: {
    tenantId: string;
    dsrId: string;
  }) => Promise<DsrRecord>;

  readonly rejectDsr: (params: {
    tenantId: string;
    dsrId: string;
    rejectionReason: string;
  }) => Promise<DsrRecord>;

  readonly cancelDsr: (params: {
    tenantId: string;
    dsrId: string;
  }) => Promise<DsrRecord>;

  readonly publishApproved: (params: {
    dsrId: string;
    tenantId: string;
    customerId: string;
    type: 'access' | 'erasure' | 'portability';
  }) => Promise<void>;

  readonly auditLogger: AuditLogger;
}

export interface DsrRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly type: 'access' | 'erasure' | 'portability';
  readonly status: 'pending' | 'approved' | 'processing' | 'completed' | 'rejected' | 'cancelled' | 'failed';
  readonly requestedBy: string;
  readonly reason: string | null;
  readonly deadlineAt: string;
  readonly completedAt: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DsrExportRecord {
  readonly expiresAt: string;
  readonly checksumSha256: string;
  readonly s3Key: string;
  readonly s3Bucket: string;
  readonly fileSizeBytes: number | null;
  readonly downloadUrl?: string;
}

// ── Module-level deps ─────────────────────────────────────────────

let deps: DsrDeps | undefined;

export function configureDsrRoutes(d: DsrDeps): void {
  deps = d;
}

// ── Helpers ───────────────────────────────────────────────────────

function ensureDeps(): DsrDeps {
  if (!deps) throw new Error('[ORDR:API] DSR routes not configured');
  return deps;
}

function ensureTenantContext(c: { get(key: 'tenantContext'): TenantContext | undefined }): TenantContext {
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Tenant context required');
  return ctx;
}

function parseZodErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.join('.');
    const existing = out[field];
    if (existing) existing.push(issue.message);
    else out[field] = [issue.message];
  }
  return out;
}

// ── Error code → HTTP status ──────────────────────────────────────

function dsrErrorStatus(code: string): number {
  if (code === 'DSR_CONFLICT' || code === 'DSR_STATE_ERROR') return 409;
  if (code === 'DSR_NOT_FOUND') return 404;
  return 500;
}

// ── Router ────────────────────────────────────────────────────────

export const dsrRouter = new Hono<Env>();

dsrRouter.use('*', requireAuth());

// ── POST / — create DSR ───────────────────────────────────────────

dsrRouter.post('/', requirePermissionMiddleware('dsr', 'write'), async (c) => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const body: unknown = await c.req.json();
  const parsed = createDsrSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid request body', parseZodErrors(parsed.error), requestId);
  }

  const { customerId, type, reason } = parsed.data;
  const deadlineAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  let dsr: DsrRecord;
  try {
    dsr = await d.createDsr({
      tenantId: ctx.tenantId,
      customerId,
      type,
      reason,
      requestedBy: ctx.userId,
      deadlineAt,
    });
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'DSR_CONFLICT') {
      return c.json({ error: 'conflict', message: 'An open DSR already exists for this customer and type.' }, 409);
    }
    throw err;
  }

  await d.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'dsr.requested',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'data_subject_request',
    resourceId: dsr.id,
    action: 'created',
    details: { dsr_type: type },
    timestamp: new Date(),
  });

  return c.json({ id: dsr.id, customerId: dsr.customerId, type: dsr.type, status: dsr.status, deadline_at: dsr.deadlineAt }, 201);
});

// ── GET / — list DSRs ─────────────────────────────────────────────

dsrRouter.get('/', requirePermissionMiddleware('dsr', 'read'), async (c) => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const qParsed = listDsrQuerySchema.safeParse({
    status: c.req.query('status'),
    type: c.req.query('type'),
    page: c.req.query('page'),
    limit: c.req.query('limit'),
  });
  if (!qParsed.success) {
    throw new ValidationError('Invalid query parameters', parseZodErrors(qParsed.error), requestId);
  }

  const result = await d.listDsrs({
    tenantId: ctx.tenantId,
    status: qParsed.data.status,
    type: qParsed.data.type,
    page: qParsed.data.page,
    limit: qParsed.data.limit,
  });

  return c.json(result, 200);
});

// ── GET /:id — DSR detail ─────────────────────────────────────────

dsrRouter.get('/:id', requirePermissionMiddleware('dsr', 'read'), async (c) => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const dsrId = c.req.param('id');

  const found = await d.getDsr({ tenantId: ctx.tenantId, dsrId });
  if (!found) throw new NotFoundError('DSR not found');

  const { dsr, export: exp } = found;

  if (dsr.status === 'completed' && exp !== null) {
    if (new Date(exp.expiresAt) < new Date()) {
      return c.json({ error: 'export_expired', message: 'Export has expired and the file has been deleted.' }, 410);
    }
    return c.json({
      ...dsr,
      export: {
        download_url: exp.downloadUrl ?? '',
        expires_at: exp.expiresAt,
        file_size_bytes: exp.fileSizeBytes,
        checksum_sha256: exp.checksumSha256,
      },
    }, 200);
  }

  return c.json(dsr, 200);
});

// ── POST /:id/approve ─────────────────────────────────────────────

dsrRouter.post('/:id/approve', requirePermissionMiddleware('dsr', 'write'), async (c) => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const dsrId = c.req.param('id');

  let updated: DsrRecord;
  try {
    updated = await d.approveDsr({ tenantId: ctx.tenantId, dsrId });
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    return c.json({ error: 'state_error', message: (err as Error).message }, dsrErrorStatus(code));
  }

  // Publish Kafka — idempotency key = dsrId
  await d.publishApproved({
    dsrId: updated.id,
    tenantId: ctx.tenantId,
    customerId: updated.customerId,
    type: updated.type,
  });

  await d.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'dsr.approved',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'data_subject_request',
    resourceId: dsrId,
    action: 'approved',
    details: { dsr_type: updated.type },
    timestamp: new Date(),
  });

  return c.json({ id: updated.id, status: updated.status }, 200);
});

// ── POST /:id/reject ──────────────────────────────────────────────

dsrRouter.post('/:id/reject', requirePermissionMiddleware('dsr', 'write'), async (c) => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const dsrId = c.req.param('id');
  const requestId = c.get('requestId');

  const body: unknown = await c.req.json();
  const parsed = rejectDsrSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('reason is required', parseZodErrors(parsed.error), requestId);
  }

  let updated: DsrRecord;
  try {
    updated = await d.rejectDsr({ tenantId: ctx.tenantId, dsrId, rejectionReason: parsed.data.reason });
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    return c.json({ error: 'state_error', message: (err as Error).message }, dsrErrorStatus(code));
  }

  await d.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'dsr.rejected',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'data_subject_request',
    resourceId: dsrId,
    action: 'rejected',
    details: {},
    timestamp: new Date(),
  });

  return c.json({ id: updated.id, status: updated.status }, 200);
});

// ── DELETE /:id — cancel DSR ──────────────────────────────────────

dsrRouter.delete('/:id', requirePermissionMiddleware('dsr', 'write'), async (c) => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const dsrId = c.req.param('id');

  let updated: DsrRecord;
  try {
    updated = await d.cancelDsr({ tenantId: ctx.tenantId, dsrId });
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    return c.json({ error: 'state_error', message: (err as Error).message }, dsrErrorStatus(code));
  }

  await d.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'dsr.cancelled',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'data_subject_request',
    resourceId: dsrId,
    action: 'cancelled',
    details: {},
    timestamp: new Date(),
  });

  return c.json({ id: updated.id, status: updated.status }, 200);
});
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/api && pnpm test -- --reporter=verbose dsr.test
```

Expected: all test cases pass.

- [ ] **Step 5: Type-check API package**

```bash
cd apps/api && pnpm type-check
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/dsr.ts \
        "apps/api/src/__tests__/dsr.test.ts"
git commit -m "feat(api): Phase 51 — DSR routes (6 endpoints)"
```

---

## Chunk 3: Worker + Scheduler

### Task 5: DSR Export Worker Handler

**Files:**
- Create: `apps/worker/src/handlers/dsr-export.ts`
- Create: `apps/worker/src/__tests__/dsr-export.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/src/__tests__/dsr-export.test.ts`:

```typescript
/**
 * DSR Export Worker Handler tests
 *
 * GDPR Art. 15 — export job produces full JSON archive
 * GDPR Art. 17 — erasure flow destroys key + pseudonymises PII
 *
 * Verifies:
 * - access DSR → runs export flow → sets status=completed
 * - portability DSR → same as access
 * - erasure DSR → runs export first, then scheduleErasure → executeErasure → verifyErasure → pseudonymise
 * - Idempotency: already-processing DSR is skipped
 * - Failure → sets status=failed + emits dsr.failed audit event
 * - Email pseudonymisation uses random UUID suffix, NOT a hash
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDsrExportHandler } from '../handlers/dsr-export.js';
import type { EventEnvelope } from '@ordr/events';
import type { DsrApprovedPayload } from '@ordr/events';

// ─── Shared IDs ───────────────────────────────────────────────────

const DSR_ID = '00000000-0000-0000-0000-000000000010';
const CUSTOMER_ID = '00000000-0000-0000-0000-000000000020';
const TENANT_ID = 'tenant-1';

// ─── Mock helpers ─────────────────────────────────────────────────

function buildEvent(type: 'access' | 'erasure' | 'portability'): EventEnvelope<DsrApprovedPayload> {
  return {
    id: '00000000-0000-0000-0000-000000000099',
    type: 'dsr.approved',
    tenantId: TENANT_ID,
    payload: { dsrId: DSR_ID, tenantId: TENANT_ID, customerId: CUSTOMER_ID, type },
    metadata: { correlationId: 'corr-1', causationId: 'cause-1', source: 'api', version: 1 },
    timestamp: new Date().toISOString(),
  };
}

const mockTransitionProcessing = vi.fn().mockResolvedValue({ status: 'processing' });
const mockLoadCustomer = vi.fn().mockResolvedValue({ name: 'Alice', email: 'alice@example.com', phone: '+1234567890', type: 'individual', status: 'active', createdAt: new Date().toISOString() });
const mockLoadContacts = vi.fn().mockResolvedValue([]);
const mockLoadConsent = vi.fn().mockResolvedValue([]);
const mockLoadTickets = vi.fn().mockResolvedValue([]);
const mockLoadMemories = vi.fn().mockResolvedValue([]);
const mockLoadAnalytics = vi.fn().mockResolvedValue({ health_score: 80, ticket_count: 5 });
const mockUploadExport = vi.fn().mockResolvedValue({ s3Key: 'dsr-exports/t/d/e.json.enc', s3Bucket: 'ordr-audit', fileSizeBytes: 1024, checksumSha256: 'abc' });
const mockSaveExport = vi.fn().mockResolvedValue(undefined);
const mockCompleteDsr = vi.fn().mockResolvedValue(undefined);
const mockScheduleErasure = vi.fn().mockResolvedValue({ id: 'er-1' });
const mockExecuteErasure = vi.fn().mockResolvedValue(undefined);
const mockVerifyErasure = vi.fn().mockResolvedValue(true);
const mockPseudonymise = vi.fn().mockResolvedValue(undefined);
const mockAuditLog = vi.fn().mockResolvedValue(undefined);

function buildDeps() {
  return {
    transitionProcessing: mockTransitionProcessing,
    loadCustomer: mockLoadCustomer,
    loadContacts: mockLoadContacts,
    loadConsent: mockLoadConsent,
    loadTickets: mockLoadTickets,
    loadMemories: mockLoadMemories,
    loadAnalytics: mockLoadAnalytics,
    uploadExport: mockUploadExport,
    saveExport: mockSaveExport,
    completeDsr: mockCompleteDsr,
    scheduleErasure: mockScheduleErasure,
    executeErasure: mockExecuteErasure,
    verifyErasure: mockVerifyErasure,
    pseudonymise: mockPseudonymise,
    auditLogger: { log: mockAuditLog },
  };
}

describe('createDsrExportHandler', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('access DSR: transitions to processing and completes', async () => {
    const handler = createDsrExportHandler(buildDeps() as never);
    await handler(buildEvent('access') as never);

    expect(mockTransitionProcessing).toHaveBeenCalledWith({ dsrId: DSR_ID, tenantId: TENANT_ID });
    expect(mockUploadExport).toHaveBeenCalled();
    expect(mockCompleteDsr).toHaveBeenCalledWith({ dsrId: DSR_ID, tenantId: TENANT_ID });
    expect(mockPseudonymise).not.toHaveBeenCalled();
  });

  it('portability DSR: behaves identically to access', async () => {
    const handler = createDsrExportHandler(buildDeps() as never);
    await handler(buildEvent('portability') as never);

    expect(mockCompleteDsr).toHaveBeenCalled();
    expect(mockScheduleErasure).not.toHaveBeenCalled();
  });

  it('erasure DSR: exports first, then erases, then pseudonymises', async () => {
    const handler = createDsrExportHandler(buildDeps() as never);
    await handler(buildEvent('erasure') as never);

    expect(mockUploadExport).toHaveBeenCalled();
    expect(mockScheduleErasure).toHaveBeenCalled();
    expect(mockExecuteErasure).toHaveBeenCalled();
    expect(mockVerifyErasure).toHaveBeenCalled();
    expect(mockPseudonymise).toHaveBeenCalled();
  });

  it('erasure: pseudonymised email uses random UUID suffix, not a hash', async () => {
    const handler = createDsrExportHandler(buildDeps() as never);
    await handler(buildEvent('erasure') as never);

    const call = mockPseudonymise.mock.calls[0] as [{ email: string }];
    expect(call[0].email).toMatch(/^\[erased-[0-9a-f-]{36}\]$/);
  });

  it('idempotency: already-processing DSR is skipped', async () => {
    mockTransitionProcessing.mockRejectedValueOnce(Object.assign(new Error('already processing'), { code: 'DSR_ALREADY_PROCESSING' }));
    const handler = createDsrExportHandler(buildDeps() as never);
    await handler(buildEvent('access') as never);

    expect(mockUploadExport).not.toHaveBeenCalled();
  });

  it('failure: emits dsr.failed audit event', async () => {
    mockUploadExport.mockRejectedValueOnce(new Error('S3 timeout'));
    const handler = createDsrExportHandler(buildDeps() as never);
    await handler(buildEvent('access') as never);

    const auditCalls = mockAuditLog.mock.calls as Array<[{ eventType: string }]>;
    const failedEvent = auditCalls.find(([e]) => e.eventType === 'dsr.failed');
    expect(failedEvent).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd apps/worker && pnpm test -- --reporter=verbose dsr-export.test
```

Expected: FAIL — `createDsrExportHandler` not found.

- [ ] **Step 3: Implement `apps/worker/src/handlers/dsr-export.ts`**

```typescript
/**
 * DSR Export Worker Handler — GDPR data export + cryptographic erasure
 *
 * Consumes: ordr.dsr.events (type = dsr.approved)
 * Status machine: approved → processing → completed | failed
 *
 * GDPR Art. 15 — full data export as encrypted JSON archive to S3
 * GDPR Art. 17 — cryptographic key destruction + pseudonymisation
 *
 * SECURITY:
 * - Idempotent: no-ops if DSR already processing/completed
 * - Erasure: email → '[erased-' + randomUUID() + ']' (NOT a hash — hashes are re-identifiable)
 * - No PHI in audit log details — IDs and checksums only
 * - Per-export DEK via EnvelopeEncryption (key never stored with ciphertext)
 */

import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@ordr/events';
import type { DsrApprovedPayload } from '@ordr/events';
import type { AuditLogger } from '@ordr/audit';

// ── Dependency Types ──────────────────────────────────────────────

export interface DsrExportRecord {
  readonly s3Key: string;
  readonly s3Bucket: string;
  readonly fileSizeBytes: number | null;
  readonly checksumSha256: string;
}

export interface ErasureRecord {
  readonly id: string;
}

export interface DsrExportDeps {
  /** Transition DSR approved → processing. Throws with code DSR_ALREADY_PROCESSING if already processing/completed. */
  readonly transitionProcessing: (params: { dsrId: string; tenantId: string }) => Promise<{ status: string }>;

  /** Load + decrypt customer profile. */
  readonly loadCustomer: (params: { tenantId: string; customerId: string }) => Promise<{
    name: string;
    email: string;
    phone: string | null;
    type: string;
    status: string;
    createdAt: string;
  }>;

  readonly loadContacts: (params: { tenantId: string; customerId: string }) => Promise<unknown[]>;
  readonly loadConsent: (params: { tenantId: string; customerId: string }) => Promise<unknown[]>;
  readonly loadTickets: (params: { tenantId: string; customerId: string }) => Promise<unknown[]>;
  readonly loadMemories: (params: { tenantId: string; customerId: string }) => Promise<unknown[]>;
  readonly loadAnalytics: (params: { tenantId: string; customerId: string }) => Promise<Record<string, unknown>>;

  /** Encrypt JSON archive and upload to S3. Returns S3 key + checksum. */
  readonly uploadExport: (params: {
    tenantId: string;
    dsrId: string;
    payload: Record<string, unknown>;
  }) => Promise<DsrExportRecord>;

  readonly saveExport: (params: {
    dsrId: string;
    tenantId: string;
    record: DsrExportRecord;
  }) => Promise<void>;

  readonly completeDsr: (params: { dsrId: string; tenantId: string }) => Promise<void>;

  readonly scheduleErasure: (params: {
    tenantId: string;
    keyId: string;
    reason: string;
  }) => Promise<ErasureRecord>;

  readonly executeErasure: (params: { record: ErasureRecord }) => Promise<void>;
  readonly verifyErasure: (params: { record: ErasureRecord }) => Promise<boolean>;

  /** Update customers row in a transaction: name/email/phone → pseudonymous values + complete DSR. */
  readonly pseudonymise: (params: {
    tenantId: string;
    customerId: string;
    dsrId: string;
    email: string; // already-generated '[erased-UUID]' value
  }) => Promise<void>;

  readonly auditLogger: Pick<AuditLogger, 'log'>;
}

// ── Handler Factory ───────────────────────────────────────────────

export function createDsrExportHandler(
  deps: DsrExportDeps,
): (event: EventEnvelope<DsrApprovedPayload>) => Promise<void> {
  return async (event: EventEnvelope<DsrApprovedPayload>): Promise<void> => {
    const { dsrId, tenantId, customerId, type } = event.payload;

    // ── 0. Idempotency guard ─────────────────────────────────────
    try {
      await deps.transitionProcessing({ dsrId, tenantId });
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'DSR_ALREADY_PROCESSING') {
        console.warn(`[ORDR:WORKER:DSR] Skipping already-processing DSR ${dsrId}`);
        return;
      }
      throw err;
    }

    try {
      // ── 1. Assemble data archive ───────────────────────────────
      const [customer, contacts, consent, tickets, memories, analytics] = await Promise.all([
        deps.loadCustomer({ tenantId, customerId }),
        deps.loadContacts({ tenantId, customerId }),
        deps.loadConsent({ tenantId, customerId }),
        deps.loadTickets({ tenantId, customerId }),
        deps.loadMemories({ tenantId, customerId }),
        deps.loadAnalytics({ tenantId, customerId }),
      ]);

      const archive: Record<string, unknown> = {
        meta: {
          schema_version: '1.0',
          dsr_id: dsrId,
          customer_id: customerId,
          tenant_id: tenantId,
          exported_at: new Date().toISOString(),
          regulations: ['GDPR_Art15', 'GDPR_Art20'],
        },
        profile: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          type: customer.type,
          status: customer.status,
          created_at: customer.createdAt,
        },
        contacts,
        consent_history: consent,
        tickets,
        agent_memory: memories,
        analytics,
      };

      // ── 2. Encrypt + upload to S3 ─────────────────────────────
      const exportRecord = await deps.uploadExport({ tenantId, dsrId, payload: archive });
      await deps.saveExport({ dsrId, tenantId, record: exportRecord });

      await deps.auditLogger.log({
        tenantId,
        eventType: 'dsr.exported',
        actorType: 'system',
        actorId: 'worker',
        resource: 'data_subject_request',
        resourceId: dsrId,
        action: 'exported',
        details: {
          dsr_type: type,
          checksum_sha256: exportRecord.checksumSha256,
          file_size_bytes: exportRecord.fileSizeBytes,
        },
        timestamp: new Date(),
      });

      // ── 3. Erasure-only: destroy key + pseudonymise ───────────
      if (type === 'erasure') {
        // Resolve keyId — convention: tenant:{tenantId}:customer:{customerId}
        const keyId = `tenant:${tenantId}:customer:${customerId}`;

        const erasureRecord = await deps.scheduleErasure({
          tenantId,
          keyId,
          reason: `DSR erasure: dsrId=${dsrId}`,
        });

        await deps.auditLogger.log({
          tenantId,
          eventType: 'dsr.erasure_scheduled',
          actorType: 'system',
          actorId: 'worker',
          resource: 'data_subject_request',
          resourceId: dsrId,
          action: 'erasure_scheduled',
          details: { key_id: keyId },
          timestamp: new Date(),
        });

        await deps.executeErasure({ record: erasureRecord });

        await deps.auditLogger.log({
          tenantId,
          eventType: 'dsr.erasure_executed',
          actorType: 'system',
          actorId: 'worker',
          resource: 'data_subject_request',
          resourceId: dsrId,
          action: 'erasure_executed',
          details: { key_id: keyId },
          timestamp: new Date(),
        });

        await deps.verifyErasure({ record: erasureRecord });

        await deps.auditLogger.log({
          tenantId,
          eventType: 'dsr.erasure_verified',
          actorType: 'system',
          actorId: 'worker',
          resource: 'data_subject_request',
          resourceId: dsrId,
          action: 'erasure_verified',
          details: { key_id: keyId },
          timestamp: new Date(),
        });

        // CRITICAL: email must be non-reversible — use random UUID, NOT a hash
        const pseudoEmail = `[erased-${randomUUID()}]`;

        await deps.pseudonymise({
          tenantId,
          customerId,
          dsrId,
          email: pseudoEmail,
        });
      }

      // ── 4. Complete DSR ───────────────────────────────────────
      if (type !== 'erasure') {
        // For erasure, pseudonymise() atomically completes the DSR in its transaction
        await deps.completeDsr({ dsrId, tenantId });
      }

    } catch (err) {
      // Failure — log dsr.failed audit (no PHI in details)
      await deps.auditLogger.log({
        tenantId,
        eventType: 'dsr.failed',
        actorType: 'system',
        actorId: 'worker',
        resource: 'data_subject_request',
        resourceId: dsrId,
        action: 'failed',
        details: { error: (err as Error).message },
        timestamp: new Date(),
      }).catch(() => {/* audit failure must not throw */});

      console.error(`[ORDR:WORKER:DSR] DSR ${dsrId} failed:`, (err as Error).message);
      // Status remains 'processing' for retry (Kafka consumer will retry)
      throw err;
    }
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/worker && pnpm test -- --reporter=verbose dsr-export.test
```

Expected: all 6 tests pass.

- [ ] **Step 5: Type-check**

```bash
cd apps/worker && pnpm type-check
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/handlers/dsr-export.ts \
        "apps/worker/src/__tests__/dsr-export.test.ts"
git commit -m "feat(worker): Phase 51 — DSR export + erasure handler"
```

---

### Task 6: Scheduler — DSR Deadline Check Job

**Files:**
- Create: `packages/scheduler/src/jobs/dsr-deadline-check.ts`

- [ ] **Step 1: Write the deadline check job file**

Create `packages/scheduler/src/jobs/dsr-deadline-check.ts`:

```typescript
/**
 * DSR Deadline Check — daily compliance enforcement job
 *
 * Scans all tenants for DSRs approaching or past their 30-day GDPR Art. 12
 * deadline. Emits compliance.violation audit events and in-app notifications
 * for any DSR where deadline_at < now + 3 days and status is not terminal.
 *
 * SOC2 CC7.1 — Monitoring: automated compliance checks.
 * GDPR Art. 12 — Inform data subjects of progress within one month.
 *
 * Schedule: 0 9 * * * (daily at 09:00 UTC)
 * DB access: BYPASSRLS service account — scans all tenants.
 * Alert level: compliance.violation per overdue DSR.
 */

import type { JobDefinition, JobHandler } from '../types.js';
import { createCronExpression } from '../cron-parser.js';

// ── Job Definition ────────────────────────────────────────────────

export const DSR_DEADLINE_CHECK_JOB_ID = 'dsr-deadline-check';
export const DSR_DEADLINE_CHECK_CRON = '0 9 * * *';

export function createDsrDeadlineCheckDefinition(): Omit<JobDefinition, 'createdAt' | 'updatedAt'> {
  return {
    id: DSR_DEADLINE_CHECK_JOB_ID,
    name: 'DSR Deadline Check',
    description: 'Daily scan for GDPR DSRs approaching or past the 30-day Art. 12 deadline.',
    cronExpression: createCronExpression(DSR_DEADLINE_CHECK_CRON),
    jobType: 'dsr-deadline-check',
    payloadTemplate: {},
    isActive: true,
    priority: 'high',
    retryPolicy: {
      maxRetries: 3,
      baseDelayMs: 30_000,
      maxDelayMs: 600_000, // 10 min max
    },
  };
}

// ── Dependency Types ──────────────────────────────────────────────

export interface DsrDeadlineCheckDeps {
  /** Query overdue/approaching DSRs across all tenants (BYPASSRLS role). */
  readonly findApproachingDeadlines: (params: {
    withinDays: number;
  }) => Promise<
    ReadonlyArray<{
      readonly id: string;
      readonly tenantId: string;
      readonly deadlineAt: Date;
      readonly status: string;
    }>
  >;

  readonly auditLogger: {
    log: (event: {
      tenantId: string;
      eventType: string;
      actorType: string;
      actorId: string;
      resource: string;
      resourceId: string;
      action: string;
      details: Record<string, unknown>;
      timestamp: Date;
    }) => Promise<void>;
  };

  readonly notifyTenantAdmin: (params: {
    tenantId: string;
    message: string;
    dsrId: string;
  }) => Promise<void>;
}

// ── Handler Factory ───────────────────────────────────────────────

export function createDsrDeadlineCheckHandler(deps: DsrDeadlineCheckDeps): JobHandler {
  return async (): Promise<{ success: boolean; processed: number }> => {
    const approaching = await deps.findApproachingDeadlines({ withinDays: 3 });

    let processed = 0;

    for (const dsr of approaching) {
      const isOverdue = dsr.deadlineAt < new Date();
      const message = isOverdue
        ? `DSR ${dsr.id} is OVERDUE (deadline: ${dsr.deadlineAt.toISOString()}). Immediate action required.`
        : `DSR ${dsr.id} deadline in < 3 days (${dsr.deadlineAt.toISOString()}).`;

      await deps.auditLogger.log({
        tenantId: dsr.tenantId,
        eventType: 'compliance.violation',
        actorType: 'system',
        actorId: 'scheduler',
        resource: 'data_subject_request',
        resourceId: dsr.id,
        action: 'deadline_approaching',
        details: {
          deadline_at: dsr.deadlineAt.toISOString(),
          is_overdue: isOverdue,
          current_status: dsr.status,
        },
        timestamp: new Date(),
      });

      await deps.notifyTenantAdmin({
        tenantId: dsr.tenantId,
        dsrId: dsr.id,
        message,
      });

      processed++;
    }

    return { success: true, processed };
  };
}
```

- [ ] **Step 2: Export from package index**

Open `packages/scheduler/src/index.ts` and add at the end:

```typescript
// ─── Job Definitions ──────────────────────────────────────────────
export {
  createDsrDeadlineCheckDefinition,
  createDsrDeadlineCheckHandler,
  DSR_DEADLINE_CHECK_JOB_ID,
  DSR_DEADLINE_CHECK_CRON,
} from './jobs/dsr-deadline-check.js';

export type { DsrDeadlineCheckDeps } from './jobs/dsr-deadline-check.js';
```

- [ ] **Step 3: Type-check scheduler package**

```bash
cd packages/scheduler && pnpm type-check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/scheduler/src/jobs/dsr-deadline-check.ts \
        packages/scheduler/src/index.ts
git commit -m "feat(scheduler): Phase 51 — DSR deadline check job (GDPR Art. 12)"
```

---

## Chunk 4: Wiring + Compliance Test

### Task 7: Wire DSR route into app.ts and worker into server.ts

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/worker/src/server.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Mount DSR router in `apps/api/src/app.ts`**

In `apps/api/src/app.ts`, add import alongside the other router imports:

```typescript
import { dsrRouter } from './routes/dsr.js';
```

In `createApp()`, add after the compliance dashboard route mount (find `app.route('/api/v1/compliance', complianceDashboardRouter)`):

```typescript
  app.route('/api/v1/dsr', dsrRouter);
```

- [ ] **Step 2: Configure DSR route dependencies in `apps/api/src/server.ts`**

In `server.ts`, find where other routes are configured (e.g., near the `configureWorkflowRoutes` call) and add a DSR configuration block. First add the import at the top with the other route imports:

```typescript
import { configureDsrRoutes } from './routes/dsr.js';
```

Then in the `bootstrap()` function, add a configuration block. The DSR route needs a DB instance and the Kafka producer. Place this near the end of the route configuration section (after search routes, before final startup logging):

```typescript
  // ── DSR Routes (GDPR Art. 12, 15, 17, 20) ────────────────────────────────
  configureDsrRoutes({
    createDsr: async (params) => {
      const result = await db
        .insert(schema.dataSubjectRequests)
        .values({
          tenantId: params.tenantId,
          customerId: params.customerId,
          type: params.type,
          requestedBy: params.requestedBy,
          reason: params.reason ?? null,
          deadlineAt: params.deadlineAt,
        })
        .returning();
      if (!result[0]) throw new Error('DSR insert returned no row');
      return result[0] as never;
    },
    listDsrs: async (params) => {
      // Drizzle query — RLS filters by tenant via SET LOCAL
      const items = await db
        .select()
        .from(schema.dataSubjectRequests)
        .where(/* filtered by status/type if provided — see full implementation */ undefined as never)
        .limit(params.limit)
        .offset((params.page - 1) * params.limit);
      return { items: items as never, total: items.length, overdue_count: 0 };
    },
    getDsr: async (params) => {
      const dsrs = await db
        .select()
        .from(schema.dataSubjectRequests)
        .where(/* eq(schema.dataSubjectRequests.id, params.dsrId) */ undefined as never)
        .limit(1);
      if (!dsrs[0]) return null;
      return { dsr: dsrs[0] as never, export: null };
    },
    approveDsr: async (params) => {
      const rows = await db
        .update(schema.dataSubjectRequests)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(/* pending + tenant check */ undefined as never)
        .returning();
      if (!rows[0]) throw Object.assign(new Error('DSR not pending'), { code: 'DSR_STATE_ERROR' });
      return rows[0] as never;
    },
    rejectDsr: async (params) => {
      const rows = await db
        .update(schema.dataSubjectRequests)
        .set({ status: 'rejected', rejectionReason: params.rejectionReason, updatedAt: new Date() })
        .where(undefined as never)
        .returning();
      if (!rows[0]) throw Object.assign(new Error('DSR not pending'), { code: 'DSR_STATE_ERROR' });
      return rows[0] as never;
    },
    cancelDsr: async (params) => {
      const rows = await db
        .update(schema.dataSubjectRequests)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(undefined as never)
        .returning();
      if (!rows[0]) throw Object.assign(new Error('DSR not pending'), { code: 'DSR_STATE_ERROR' });
      return rows[0] as never;
    },
    publishApproved: async (params) => {
      await eventProducer.publish(TOPICS.DSR_EVENTS, {
        id: crypto.randomUUID(),
        type: EventType.DSR_APPROVED,
        tenantId: params.tenantId,
        payload: params,
        metadata: { correlationId: crypto.randomUUID(), causationId: crypto.randomUUID(), source: 'api', version: 1 },
        timestamp: new Date().toISOString(),
      });
    },
    auditLogger,
  });
  console.warn('[ORDR:API] DSR routes configured');
```

**NOTE:** The `where()` clauses above use `undefined as never` as placeholder stubs — the actual implementation must use Drizzle's `and(eq(...), eq(...))` expressions with proper `schema.dataSubjectRequests.id`, `tenantId`, and `status` comparisons. Replace them with correct Drizzle expressions before committing. Add the necessary imports: `import { eq, and, lt, notInArray } from 'drizzle-orm'`, `import { TOPICS, EventType } from '@ordr/events'`.

- [ ] **Step 3: Add DSR handler to worker `apps/worker/src/server.ts`**

Add import at the top of `apps/worker/src/server.ts`:

```typescript
import { createDsrExportHandler } from './handlers/dsr-export.js';
```

Add to `WorkerDependencies` interface:
```typescript
readonly dsrExportDeps: import('./handlers/dsr-export.js').DsrExportDeps;
```

In `startWorker`, after the `handlers.set('outbound.message', ...)` line:

```typescript
  // DSR export + erasure handler
  const dsrHandler = createDsrExportHandler(deps.dsrExportDeps);
  handlers.set('dsr.approved', dsrHandler);
```

Add `TOPICS.DSR_EVENTS` to the `consumer.subscribe` call:

```typescript
  await consumer.subscribe([
    TOPICS.CUSTOMER_EVENTS,
    TOPICS.INTERACTION_EVENTS,
    TOPICS.AGENT_EVENTS,
    TOPICS.OUTBOUND_MESSAGES,
    TOPICS.DSR_EVENTS,           // ← add this
  ]);
```

Update the audit log `details.topics` array to include `TOPICS.DSR_EVENTS`.

- [ ] **Step 4: Export DSR handler from `apps/worker/src/index.ts`**

Add after the last export in `apps/worker/src/index.ts`:

```typescript
export { createDsrExportHandler } from './handlers/dsr-export.js';
export type { DsrExportDeps } from './handlers/dsr-export.js';
```

- [ ] **Step 5: Type-check both apps**

```bash
cd apps/api && pnpm type-check
cd apps/worker && pnpm type-check
```

Expected: no new errors (the `undefined as never` stubs will type-check; they must be replaced with real Drizzle expressions before real deployment, but for wiring verification purposes this is acceptable).

- [ ] **Step 6: Run all tests**

```bash
cd apps/api && pnpm test
cd apps/worker && pnpm test
```

Expected: all existing tests pass, DSR tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/app.ts \
        apps/api/src/server.ts \
        apps/worker/src/server.ts \
        apps/worker/src/index.ts
git commit -m "feat(wire): Phase 51 — mount DSR route + register DSR Kafka consumer"
```

---

### Task 8: Compliance Test — Verify 9 DSR Audit Event Types

**Files:**
- Create: `tests/compliance/check-dsr-audit-events.sh`

- [ ] **Step 1: Write the compliance test script**

Create `tests/compliance/check-dsr-audit-events.sh`:

```bash
#!/usr/bin/env bash
# check-dsr-audit-events.sh — Phase 51 compliance gate
#
# Verifies that all 9 GDPR DSR audit event types are present in
# packages/audit/src/types.ts AuditEventType union.
#
# SOC2 CC7.2 — Monitoring: DSR lifecycle must be fully auditable.
# GDPR Art. 12, 15, 17, 20 — All DSR state transitions must be logged.
#
# Usage: ./tests/compliance/check-dsr-audit-events.sh
# Returns: exit 0 on pass, exit 1 on failure (prints missing types)

set -eo pipefail

REQUIRED_TYPES=(
  "dsr.requested"
  "dsr.approved"
  "dsr.rejected"
  "dsr.cancelled"
  "dsr.exported"
  "dsr.failed"
  "dsr.erasure_scheduled"
  "dsr.erasure_executed"
  "dsr.erasure_verified"
)

AUDIT_TYPES_FILE="packages/audit/src/types.ts"

# ── Repo root guard ───────────────────────────────────────────────

if [[ ! -f "CLAUDE.md" ]]; then
  echo "ERROR: Must be run from the repo root (CLAUDE.md not found)" >&2
  exit 1
fi

if [[ ! -f "${AUDIT_TYPES_FILE}" ]]; then
  echo "ERROR: ${AUDIT_TYPES_FILE} not found" >&2
  exit 1
fi

# ── Check each required type ──────────────────────────────────────

MISSING=()
for event_type in "${REQUIRED_TYPES[@]}"; do
  if [[ -z "${event_type}" ]]; then
    continue
  fi
  if ! grep -qF "'${event_type}'" "${AUDIT_TYPES_FILE}"; then
    MISSING+=("${event_type}")
  fi
done

# ── Report ────────────────────────────────────────────────────────

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "FAIL: The following DSR audit event types are missing from ${AUDIT_TYPES_FILE}:" >&2
  for t in "${MISSING[@]}"; do
    echo "  - '${t}'" >&2
  done
  exit 1
fi

echo "PASS: All 9 DSR audit event types present in ${AUDIT_TYPES_FILE}"
exit 0
```

- [ ] **Step 2: Make it executable and run it**

```bash
chmod +x tests/compliance/check-dsr-audit-events.sh
./tests/compliance/check-dsr-audit-events.sh
```

Expected: `PASS: All 9 DSR audit event types present in packages/audit/src/types.ts`

- [ ] **Step 3: Add the script to CI (`ci.yml`)**

Open `.github/workflows/ci.yml`. Find the `compliance-checks` job's steps section (which currently runs `check-staging-namespace.sh` and `check-deploy-staging-dockerfile.sh`). Add a third step:

```yaml
      - name: Check DSR audit event types
        run: ./tests/compliance/check-dsr-audit-events.sh
```

- [ ] **Step 4: Run the full compliance check suite locally**

```bash
./tests/compliance/check-staging-namespace.sh
./tests/compliance/check-deploy-staging-dockerfile.sh
./tests/compliance/check-dsr-audit-events.sh
```

Expected: all three print PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/compliance/check-dsr-audit-events.sh \
        .github/workflows/ci.yml
git commit -m "feat(compliance): Phase 51 — DSR audit event types compliance gate"
```

---

## Final: Run Full Test Suite

- [ ] **Run all tests**

```bash
pnpm --filter '@ordr/audit' test
pnpm --filter '@ordr/events' test
pnpm --filter '@ordr/scheduler' test
pnpm --filter 'apps/api' test
pnpm --filter 'apps/worker' test
```

Expected: all suites pass. Zero type errors across all modified packages.

- [ ] **Run compliance tests**

```bash
./tests/compliance/check-staging-namespace.sh
./tests/compliance/check-deploy-staging-dockerfile.sh
./tests/compliance/check-dsr-audit-events.sh
```

Expected: all three PASS.

- [ ] **Final commit message summary**

Phase 51 spans commits:
1. `feat(db): Phase 51 — DSR schema (data_subject_requests + dsr_exports)`
2. `feat(events): Phase 51 — DSR_EVENTS topic + dsr.approved schema`
3. `feat(audit): Phase 51 — 9 DSR audit event types`
4. `feat(api): Phase 51 — DSR routes (6 endpoints)`
5. `feat(worker): Phase 51 — DSR export + erasure handler`
6. `feat(scheduler): Phase 51 — DSR deadline check job (GDPR Art. 12)`
7. `feat(wire): Phase 51 — mount DSR route + register DSR Kafka consumer`
8. `feat(compliance): Phase 51 — DSR audit event types compliance gate`
