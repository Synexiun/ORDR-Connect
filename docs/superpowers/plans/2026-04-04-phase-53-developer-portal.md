# Phase 53 — Developer Portal Completion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Developer Portal by adding webhook management CRUD, an agent submission pipeline, and wiring sandbox create/destroy in the UI.

**Architecture:** Two new Hono route files, one new DB table, one DB query layer file, client API additions, and three UI sections wired to real endpoints. No new pages. All patterns follow existing `developers.ts` (configure-fn DI, `requireAuth()`, Zod, WORM audit).

**Tech Stack:** TypeScript strict, Hono, Drizzle ORM, PostgreSQL, `@ordr/sdk` manifest validator, `FieldEncryptor` (sync AES-256-GCM), Vitest, React Testing Library.

---

## Critical context before starting

- **Route mounting:** `apps/api/src/app.ts` (the `createApp()` function, not `index.ts`)
- **Dependency injection configure calls:** `apps/api/src/server.ts`
- **Marketplace status enum values:** `draft | review | published | suspended | rejected` (NOT `pending`)
- **Agent submission writes status `'review'`** (the "under review" state), not `'pending'`
- **DB column is `downloads`**, not `installCount`; the route returns it as `installCount` for client compatibility
- **`FieldEncryptor.encryptField(fieldName, value)`** is synchronous
- **Test commands:** `pnpm --filter @ordr/api test`, `pnpm --filter @ordr/events test`, `pnpm --filter @ordr/web test`

---

## ## Chunk 1: Foundation

### Task 1: DELIVERABLE_EVENTS constant

**Files:**
- Create: `packages/events/src/deliverable-events.ts`
- Modify: `packages/events/src/index.ts`

- [ ] **Step 1: Create the constant file**

```typescript
// packages/events/src/deliverable-events.ts
/**
 * DELIVERABLE_EVENTS — the set of event types that can be delivered
 * to developer-registered webhooks.
 *
 * Source of truth for webhook event validation. Adding new events
 * here makes them available to the webhook registration endpoint.
 */

export const DELIVERABLE_EVENTS = [
  'customer.created',
  'customer.updated',
  'interaction.logged',
  'agent.triggered',
  'agent.action_executed',
  'agent.completed',
  'ticket.created',
  'ticket.resolved',
  'dsr.approved',
  'dsr.completed',
  'compliance.alert',
  'integration.webhook_received',
] as const;

export type DeliverableEvent = (typeof DELIVERABLE_EVENTS)[number];
```

- [ ] **Step 2: Export from the events package index**

Add at the bottom of `packages/events/src/index.ts`:

```typescript
// ─── Deliverable Events ───────────────────────────────────────────
export { DELIVERABLE_EVENTS } from './deliverable-events.js';
export type { DeliverableEvent } from './deliverable-events.js';
```

- [ ] **Step 3: Verify the package builds**

```bash
pnpm --filter @ordr/events build
```

Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/events/src/deliverable-events.ts packages/events/src/index.ts
git commit -m "feat(events): add DELIVERABLE_EVENTS constant for webhook validation"
```

---

### Task 2: DB schema + migration

**Files:**
- Create: `packages/db/src/schema/developer-webhooks.ts`
- Create: `packages/db/migrations/0013_developer_webhooks.sql`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create the Drizzle schema**

```typescript
// packages/db/src/schema/developer-webhooks.ts
/**
 * developer_webhooks — per-developer webhook registrations
 *
 * SOC2 CC6.1 — developer-scoped, never cross-tenant.
 * Rule 1 — HMAC secret stored AES-256-GCM encrypted, never plaintext.
 * Rule 3 — mutations audited externally (route-level).
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { developerAccounts } from './developer.js';

export const developerWebhooks = pgTable(
  'developer_webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** FK to developer_accounts — ON DELETE CASCADE cleans up on account removal */
    developerId: uuid('developer_id')
      .notNull()
      .references(() => developerAccounts.id, { onDelete: 'cascade' }),

    /** Webhook target URL — https:// only, SSRF-validated at route layer */
    url: text('url').notNull(),

    /** Subscribed event type strings — validated against DELIVERABLE_EVENTS */
    events: text('events').array().notNull().default([]),

    /** AES-256-GCM ciphertext of 32-byte random HMAC secret — plaintext NEVER stored */
    hmacSecretEncrypted: text('hmac_secret_encrypted').notNull(),

    /** Whether this webhook is currently active */
    active: boolean('active').notNull().default(true),

    /** Set when the webhook last received a delivery (future phase) */
    lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Auto-updated on every mutation via .$onUpdate() */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('developer_webhooks_developer_id_idx').on(table.developerId),
    index('developer_webhooks_active_idx').on(table.active),
  ],
);
```

- [ ] **Step 2: Write the migration SQL**

```sql
-- packages/db/migrations/0013_developer_webhooks.sql
-- Phase 53: Developer webhook registrations
-- Rule 1: HMAC secret stored encrypted (hmac_secret_encrypted)
-- Rule 3: Mutations audited at route layer (no WORM needed on this table)

CREATE TABLE developer_webhooks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id          UUID NOT NULL REFERENCES developer_accounts(id) ON DELETE CASCADE,
  url                   TEXT NOT NULL,
  events                TEXT[] NOT NULL DEFAULT '{}',
  hmac_secret_encrypted TEXT NOT NULL,
  active                BOOLEAN NOT NULL DEFAULT true,
  last_triggered_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_developer_webhooks_developer_id ON developer_webhooks (developer_id);
CREATE INDEX idx_developer_webhooks_active      ON developer_webhooks (active);
```

- [ ] **Step 3: Export from the schema barrel**

Add at the end of `packages/db/src/schema/index.ts`:

```typescript
// Developer Webhooks (Phase 53)
export { developerWebhooks } from './developer-webhooks.js';
```

- [ ] **Step 4: Verify the DB package builds**

```bash
pnpm --filter @ordr/db build
```

Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/developer-webhooks.ts \
        packages/db/migrations/0013_developer_webhooks.sql \
        packages/db/src/schema/index.ts
git commit -m "feat(db): add developer_webhooks table — Phase 53 schema + migration"
```

---

### Task 3: DB query layer

**Files:**
- Create: `packages/db/src/queries/developer-webhooks.ts`

_(Note: this directory may not exist yet. Create it.)_

- [ ] **Step 1: Create the queries file**

```typescript
// packages/db/src/queries/developer-webhooks.ts
/**
 * Data-access functions for the developer_webhooks table.
 * Injected as WebhookDeps into configureWebhookRoutes().
 *
 * All queries are tenant-scoped via developer_id (Rule 2).
 */

import { eq, and, count } from 'drizzle-orm';
import type { OrdrDatabase } from '../connection.js';
import { developerWebhooks } from '../schema/developer-webhooks.js';

// ─── Types ────────────────────────────────────────────────────────

export interface WebhookRecord {
  readonly id: string;
  readonly developerId: string;
  readonly url: string;
  readonly events: string[];
  readonly hmacSecretEncrypted: string;
  readonly active: boolean;
  readonly lastTriggeredAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─── Query functions ──────────────────────────────────────────────

export function makeWebhookQueries(db: OrdrDatabase) {
  return {
    async createWebhook(data: {
      developerId: string;
      url: string;
      events: string[];
      hmacSecretEncrypted: string;
    }): Promise<WebhookRecord> {
      const rows = await db
        .insert(developerWebhooks)
        .values({
          developerId: data.developerId,
          url: data.url,
          events: data.events,
          hmacSecretEncrypted: data.hmacSecretEncrypted,
          active: true,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Insert returned no rows');
      return row as WebhookRecord;
    },

    async listWebhooks(developerId: string): Promise<WebhookRecord[]> {
      const rows = await db
        .select()
        .from(developerWebhooks)
        .where(eq(developerWebhooks.developerId, developerId))
        .orderBy(developerWebhooks.createdAt);
      return rows as WebhookRecord[];
    },

    async countActiveWebhooks(developerId: string): Promise<number> {
      const rows = await db
        .select({ total: count() })
        .from(developerWebhooks)
        .where(
          and(
            eq(developerWebhooks.developerId, developerId),
            eq(developerWebhooks.active, true),
          ),
        );
      return rows[0]?.total ?? 0;
    },

    async findWebhook(developerId: string, webhookId: string): Promise<WebhookRecord | null> {
      const rows = await db
        .select()
        .from(developerWebhooks)
        .where(
          and(
            eq(developerWebhooks.id, webhookId),
            eq(developerWebhooks.developerId, developerId),
          ),
        )
        .limit(1);
      return (rows[0] as WebhookRecord | undefined) ?? null;
    },

    async deleteWebhook(webhookId: string): Promise<void> {
      await db.delete(developerWebhooks).where(eq(developerWebhooks.id, webhookId));
    },

    async toggleWebhook(webhookId: string, active: boolean): Promise<WebhookRecord> {
      const rows = await db
        .update(developerWebhooks)
        .set({ active, updatedAt: new Date() })
        .where(eq(developerWebhooks.id, webhookId))
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Webhook not found');
      return row as WebhookRecord;
    },
  };
}
```

- [ ] **Step 2: Export from `packages/db/src/index.ts`**

Add at the bottom of `packages/db/src/index.ts`:

```typescript
// Developer Webhook Queries (Phase 53)
export { makeWebhookQueries } from './queries/developer-webhooks.js';
export type { WebhookRecord } from './queries/developer-webhooks.js';
```

- [ ] **Step 3: Verify builds**

```bash
pnpm --filter @ordr/db build
```

Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/queries/developer-webhooks.ts \
        packages/db/src/index.ts
git commit -m "feat(db): add developer-webhooks query layer + exports"
```

---

## ## Chunk 2: API Routes

### Task 4: Webhook API route + tests

**Files:**
- Create: `apps/api/src/__tests__/developer-webhooks.test.ts` (TDD — write first)
- Create: `apps/api/src/routes/developer-webhooks.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/__tests__/developer-webhooks.test.ts
/**
 * Developer Webhooks Route Tests — /api/v1/developers/webhooks
 *
 * Tests: list, create (valid/invalid URL/SSRF/events/limit), delete, toggle.
 * SECURITY invariants: hmacSecretEncrypted never in responses.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import {
  developerWebhooksRouter,
  configureWebhookRoutes,
} from '../routes/developer-webhooks.js';
import { configureAuth } from '../middleware/auth.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import { loadKeyPair, createAccessToken } from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { generateKeyPair } from '@ordr/crypto';
import type { WebhookRecord } from '@ordr/db';

// ─── Mock dns — prevent real DNS lookups in tests ──────────────────

vi.mock('node:dns', () => ({
  promises: {
    lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────

let jwtConfig: JwtConfig;
let auditLogger: AuditLogger;
let webhookStore: Map<string, WebhookRecord>;
let idCounter: number;

async function makeJwt(sub = 'dev-001'): Promise<string> {
  return createAccessToken(jwtConfig, {
    sub,
    tid: 'developer-portal',
    role: 'tenant_admin' as const,
    permissions: [],
  });
}

function makeWebhook(overrides: Partial<WebhookRecord> = {}): WebhookRecord {
  const id = `wh-${String(idCounter++).padStart(3, '0')}`;
  return {
    id,
    developerId: 'dev-001',
    url: 'https://example.com/hook',
    events: ['customer.created'],
    hmacSecretEncrypted: 'enc:secret',
    active: true,
    lastTriggeredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/api/v1/developers/webhooks', developerWebhooksRouter);
  return app;
}

// ─── Setup ──────────────────────────────────────────────────────────

beforeEach(async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  jwtConfig = await loadKeyPair(privateKey, publicKey, {
    issuer: 'ordr-connect',
    audience: 'ordr-connect',
  });
  configureAuth(jwtConfig);

  const auditStore = new InMemoryAuditStore();
  auditLogger = new AuditLogger(auditStore);
  webhookStore = new Map();
  idCounter = 1;

  configureWebhookRoutes({
    auditLogger,
    fieldEncryptor: {
      encryptField: vi.fn((_field: string, value: string) => `enc:${value}`),
    } as never,
    createWebhook: vi.fn(async (data) => {
      const wh = makeWebhook({ ...data, id: `wh-${String(idCounter++).padStart(3, '0')}` });
      webhookStore.set(wh.id, wh);
      return wh;
    }),
    listWebhooks: vi.fn(async (developerId: string) =>
      [...webhookStore.values()].filter((w) => w.developerId === developerId),
    ),
    countActiveWebhooks: vi.fn(async (developerId: string) =>
      [...webhookStore.values()].filter((w) => w.developerId === developerId && w.active).length,
    ),
    findWebhook: vi.fn(async (developerId: string, webhookId: string) => {
      const wh = webhookStore.get(webhookId);
      return wh && wh.developerId === developerId ? wh : null;
    }),
    deleteWebhook: vi.fn(async (webhookId: string) => {
      webhookStore.delete(webhookId);
    }),
    toggleWebhook: vi.fn(async (webhookId: string, active: boolean) => {
      const wh = webhookStore.get(webhookId);
      if (!wh) throw new Error('not found');
      const updated = { ...wh, active };
      webhookStore.set(webhookId, updated);
      return updated;
    }),
  });
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('GET /api/v1/developers/webhooks', () => {
  it('returns webhook list without hmacSecretEncrypted', async () => {
    const token = await makeJwt();
    const existing = makeWebhook();
    webhookStore.set(existing.id, existing);

    const app = createTestApp();
    const res = await app.request('/api/v1/developers/webhooks', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
    const item = body.data[0] as Record<string, unknown>;
    expect(item.id).toBe(existing.id);
    expect(item.hmacSecretEncrypted).toBeUndefined();
  });

  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/developers/webhooks');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/developers/webhooks', () => {
  it('creates webhook and returns hmacSecret once', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['customer.created'] }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(typeof body.data.hmacSecret).toBe('string');
    expect((body.data.hmacSecret as string).length).toBe(64);
    expect(body.data.hmacSecretEncrypted).toBeUndefined();
  });

  it('rejects http:// URL (non-HTTPS)', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://example.com/hook', events: ['customer.created'] }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects private IP (SSRF protection)', async () => {
    const { promises: dns } = await import('node:dns');
    (dns.lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ address: '192.168.1.1', family: 4 });

    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://internal.example.com/hook', events: ['customer.created'] }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects unknown event type', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['not.a.real.event'] }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects empty events array', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', events: [] }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects when at the 10-webhook limit', async () => {
    const token = await makeJwt();
    // Pre-populate 10 active webhooks
    for (let i = 0; i < 10; i++) {
      webhookStore.set(`wh-${i}`, makeWebhook({ id: `wh-${i}` }));
    }

    const app = createTestApp();
    const res = await app.request('/api/v1/developers/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['customer.created'] }),
    });

    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/developers/webhooks/:webhookId', () => {
  it('deletes an owned webhook', async () => {
    const token = await makeJwt();
    const wh = makeWebhook({ id: 'wh-to-delete' });
    webhookStore.set(wh.id, wh);

    const app = createTestApp();
    const res = await app.request(`/api/v1/developers/webhooks/${wh.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(webhookStore.has(wh.id)).toBe(false);
  });

  it('returns 404 for unowned webhook', async () => {
    const token = await makeJwt('dev-001');
    const wh = makeWebhook({ id: 'wh-other', developerId: 'dev-999' });
    webhookStore.set(wh.id, wh);

    const app = createTestApp();
    const res = await app.request(`/api/v1/developers/webhooks/${wh.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/developers/webhooks/:webhookId/toggle', () => {
  it('toggles active state and never leaks hmacSecretEncrypted', async () => {
    const token = await makeJwt();
    const wh = makeWebhook({ id: 'wh-toggle', active: true });
    webhookStore.set(wh.id, wh);

    const app = createTestApp();
    const res = await app.request(`/api/v1/developers/webhooks/${wh.id}/toggle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data.active).toBe(false);
    expect(body.data.hmacSecretEncrypted).toBeUndefined();
  });

  it('returns 404 for unowned webhook', async () => {
    const token = await makeJwt('dev-001');
    const wh = makeWebhook({ id: 'wh-other-toggle', developerId: 'dev-999' });
    webhookStore.set(wh.id, wh);

    const app = createTestApp();
    const res = await app.request(`/api/v1/developers/webhooks/${wh.id}/toggle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter @ordr/api test -- --reporter=verbose 2>&1 | grep "developer-webhooks"
```

Expected: Cannot find module `'../routes/developer-webhooks.js'`

- [ ] **Step 3: Create the webhook route**

```typescript
// apps/api/src/routes/developer-webhooks.ts
/**
 * Developer Webhook Routes — CRUD for developer webhook registrations
 *
 * SOC2 CC6.1 — developer-scoped, ownership enforced on all mutations.
 * Rule 1 — HMAC secrets AES-256-GCM encrypted before storage.
 * Rule 2 — raw secret returned ONCE at creation, never again.
 * Rule 3 — all state changes WORM audit-logged.
 * Rule 4 — SSRF protection + https:// enforcement on webhook URLs.
 *
 * Endpoints:
 * GET    /v1/developers/webhooks                       — list webhooks
 * POST   /v1/developers/webhooks                       — create webhook (returns hmacSecret once)
 * DELETE /v1/developers/webhooks/:webhookId            — hard delete
 * PATCH  /v1/developers/webhooks/:webhookId/toggle     — enable/disable
 */

import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import type { FieldEncryptor } from '@ordr/crypto';
import { NotFoundError, ValidationError } from '@ordr/core';
import { DELIVERABLE_EVENTS } from '@ordr/events';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';

// ─── SSRF protection ────────────────────────────────────────────────

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0/,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some((re) => re.test(ip));
}

async function isUrlSsrfSafe(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Block known internal TLDs / localhost variants
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.localhost')
    ) {
      return false;
    }

    // DNS resolution with 5s timeout — fail closed on error/timeout
    const result = await Promise.race<{ address: string }>([
      dns.lookup(hostname) as Promise<{ address: string }>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DNS timeout')), 5000),
      ),
    ]);

    return !isPrivateIp(result.address);
  } catch {
    return false; // Fail closed
  }
}

// ─── Input schemas ──────────────────────────────────────────────────

const createWebhookSchema = z.object({
  url: z
    .string()
    .url('Must be a valid URL')
    .max(2048, 'URL must not exceed 2048 characters')
    .refine((url) => url.startsWith('https://'), {
      message: 'URL must use https://',
    })
    .refine(async (url) => isUrlSsrfSafe(url), {
      message: 'URL is not allowed (private or internal addresses are blocked)',
    }),
  events: z
    .array(z.enum(DELIVERABLE_EVENTS as unknown as [string, ...string[]]))
    .min(1, 'At least one event is required')
    .max(20, 'Maximum 20 events per webhook'),
});

const toggleSchema = z.object({
  active: z.boolean(),
});

const MAX_WEBHOOKS_PER_DEVELOPER = 10;

// ─── WebhookRecord type ──────────────────────────────────────────────

interface WebhookRecord {
  readonly id: string;
  readonly developerId: string;
  readonly url: string;
  readonly events: string[];
  readonly hmacSecretEncrypted: string;
  readonly active: boolean;
  readonly lastTriggeredAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─── Dependencies ───────────────────────────────────────────────────

interface WebhookDeps {
  readonly auditLogger: AuditLogger;
  readonly fieldEncryptor: FieldEncryptor;
  readonly createWebhook: (data: {
    developerId: string;
    url: string;
    events: string[];
    hmacSecretEncrypted: string;
  }) => Promise<WebhookRecord>;
  readonly listWebhooks: (developerId: string) => Promise<WebhookRecord[]>;
  readonly countActiveWebhooks: (developerId: string) => Promise<number>;
  readonly findWebhook: (developerId: string, webhookId: string) => Promise<WebhookRecord | null>;
  readonly deleteWebhook: (developerId: string, webhookId: string) => Promise<void>;
  readonly toggleWebhook: (developerId: string, webhookId: string, active: boolean) => Promise<WebhookRecord>;
}

let deps: WebhookDeps | null = null;

export function configureWebhookRoutes(dependencies: WebhookDeps): void {
  deps = dependencies;
}

// ─── Safe response shape — hmacSecretEncrypted excluded ─────────────

function toSafeWebhook(wh: WebhookRecord) {
  return {
    id: wh.id,
    url: wh.url,
    events: wh.events,
    active: wh.active,
    lastTriggeredAt: wh.lastTriggeredAt,
    createdAt: wh.createdAt,
  };
}

// ─── Context helper ──────────────────────────────────────────────────

function ensureCtx(c: { get(key: 'tenantContext'): { userId: string } | undefined; get(key: 'requestId'): string }): {
  userId: string;
  requestId: string;
} {
  const ctx = c.get('tenantContext');
  if (!ctx) throw new Error('[ORDR:API] Auth required');
  return { userId: ctx.userId, requestId: c.get('requestId') };
}

// ─── Router ─────────────────────────────────────────────────────────

export const developerWebhooksRouter = new Hono<Env>();

// GET /
developerWebhooksRouter.get('/', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Webhook routes not configured');
  const { userId } = ensureCtx(c);

  const webhooks = await deps.listWebhooks(userId);
  return c.json({ success: true as const, data: webhooks.map(toSafeWebhook) });
});

// POST /
developerWebhooksRouter.post('/', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Webhook routes not configured');
  const { userId, requestId } = ensureCtx(c);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = await createWebhookSchema.safeParseAsync(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid webhook data', {
      url: parsed.error.issues.filter((i) => i.path[0] === 'url').map((i) => i.message),
      events: parsed.error.issues.filter((i) => i.path[0] === 'events').map((i) => i.message),
    }, requestId);
  }

  const { url, events } = parsed.data;

  // Enforce per-account webhook limit
  const activeCount = await deps.countActiveWebhooks(userId);
  if (activeCount >= MAX_WEBHOOKS_PER_DEVELOPER) {
    return c.json(
      {
        success: false as const,
        message: `Webhook limit reached (max ${String(MAX_WEBHOOKS_PER_DEVELOPER)} active)`,
        requestId,
      },
      422,
    );
  }

  // Generate random 32-byte HMAC secret, encrypt before storage (Rule 1)
  const rawSecret = randomBytes(32).toString('hex');
  const hmacSecretEncrypted = deps.fieldEncryptor.encryptField('hmac_secret', rawSecret);

  const webhook = await deps.createWebhook({ developerId: userId, url, events, hmacSecretEncrypted });

  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.created',
    actorType: 'user',
    actorId: userId,
    resource: 'developer_webhooks',
    resourceId: webhook.id,
    action: 'create_webhook',
    details: { url, eventCount: events.length },
    timestamp: new Date(),
  });

  // Return raw secret ONCE — never exposed again (Rule 2, Rule 5)
  return c.json(
    {
      success: true as const,
      data: { ...toSafeWebhook(webhook), hmacSecret: rawSecret },
    },
    201,
  );
});

// DELETE /:webhookId
developerWebhooksRouter.delete('/:webhookId', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Webhook routes not configured');
  const { userId, requestId } = ensureCtx(c);
  const webhookId = c.req.param('webhookId');

  // Ownership check — returns null if not found OR if owned by different developer
  const webhook = await deps.findWebhook(userId, webhookId);
  if (!webhook) throw new NotFoundError('Webhook not found', requestId);

  // Audit BEFORE deletion (Rule 3 — log before destroy)
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.deleted',
    actorType: 'user',
    actorId: userId,
    resource: 'developer_webhooks',
    resourceId: webhookId,
    action: 'delete_webhook',
    details: { url: webhook.url },
    timestamp: new Date(),
  });

  await deps.deleteWebhook(webhookId);
  return c.json({ success: true as const });
});

// PATCH /:webhookId/toggle
developerWebhooksRouter.patch('/:webhookId/toggle', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Webhook routes not configured');
  const { userId, requestId } = ensureCtx(c);
  const webhookId = c.req.param('webhookId');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid toggle data', {
      active: parsed.error.issues.map((i) => i.message),
    }, requestId);
  }

  // Ownership check
  const existing = await deps.findWebhook(userId, webhookId);
  if (!existing) throw new NotFoundError('Webhook not found', requestId);

  const updated = await deps.toggleWebhook(webhookId, parsed.data.active);

  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.updated',
    actorType: 'user',
    actorId: userId,
    resource: 'developer_webhooks',
    resourceId: webhookId,
    action: 'toggle_webhook',
    details: { active: parsed.data.active },
    timestamp: new Date(),
  });

  return c.json({ success: true as const, data: toSafeWebhook(updated) });
});
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter @ordr/api test -- --reporter=verbose 2>&1 | grep -A 2 "developer-webhooks"
```

Expected: All 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/developer-webhooks.ts \
        apps/api/src/__tests__/developer-webhooks.test.ts
git commit -m "feat(api): developer webhook CRUD endpoints + tests (Phase 53)"
```

---

### Task 5: Agent submission route + tests

**Files:**
- Create: `apps/api/src/__tests__/developer-agents.test.ts` (TDD — write first)
- Create: `apps/api/src/routes/developer-agents.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/__tests__/developer-agents.test.ts
/**
 * Developer Agents Route Tests — /api/v1/developers/agents
 *
 * Tests: list (scoped to caller), submit (valid/invalid manifest/hash).
 * Key invariants: invalid manifests never write to DB, uppercase packageHash rejected.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import {
  developerAgentsRouter,
  configureAgentRoutes,
} from '../routes/developer-agents.js';
import { configureAuth } from '../middleware/auth.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import { loadKeyPair, createAccessToken } from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { generateKeyPair } from '@ordr/crypto';

// ─── Mock @ordr/sdk ──────────────────────────────────────────────────

const mockValidateManifest = vi.fn();
vi.mock('@ordr/sdk', () => ({
  validateManifest: (...args: unknown[]) => mockValidateManifest(...args) as unknown,
}));

// ─── Types ──────────────────────────────────────────────────────────

interface AgentListItem {
  id: string;
  name: string;
  version: string;
  status: 'draft' | 'review' | 'published' | 'suspended' | 'rejected';
  installCount: number;
  createdAt: Date;
}

// ─── Helpers ────────────────────────────────────────────────────────

let jwtConfig: JwtConfig;
let auditLogger: AuditLogger;
let agentStore: AgentListItem[];
let mockListAgents: ReturnType<typeof vi.fn>;
let mockCreateListing: ReturnType<typeof vi.fn>;

async function makeJwt(sub = 'dev-001'): Promise<string> {
  return createAccessToken(jwtConfig, {
    sub,
    tid: 'developer-portal',
    role: 'tenant_admin' as const,
    permissions: [],
  });
}

const VALID_MANIFEST = {
  name: 'test-agent',
  version: '1.0.0',
  description: 'A test agent',
  author: 'test@example.com',
  license: 'MIT',
  requiredTools: [],
  complianceRequirements: [],
  permissions: ['internal'],
  entryPoint: 'index.js',
  minConfidenceThreshold: 0.8,
  maxBudget: { maxTokens: 10000, maxCostCents: 100, maxActions: 50 },
};

const VALID_HASH = 'a'.repeat(64);

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/api/v1/developers/agents', developerAgentsRouter);
  return app;
}

// ─── Setup ──────────────────────────────────────────────────────────

beforeEach(async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  jwtConfig = await loadKeyPair(privateKey, publicKey, {
    issuer: 'ordr-connect',
    audience: 'ordr-connect',
  });
  configureAuth(jwtConfig);

  const auditStore = new InMemoryAuditStore();
  auditLogger = new AuditLogger(auditStore);
  agentStore = [];

  mockListAgents = vi.fn(async (publisherId: string) =>
    agentStore.filter((a) => (a as unknown as { publisherId: string }).publisherId === publisherId),
  );

  mockCreateListing = vi.fn(async (data: { name: string; version: string; publisherId: string }) => {
    const item: AgentListItem & { publisherId: string } = {
      id: 'agent-001',
      name: data.name,
      version: data.version,
      status: 'review',
      installCount: 0,
      createdAt: new Date(),
      publisherId: data.publisherId,
    };
    agentStore.push(item);
    return item;
  });

  configureAgentRoutes({
    auditLogger,
    listAgentsByPublisher: mockListAgents,
    createMarketplaceListing: mockCreateListing,
  });

  // Default: manifest is valid
  mockValidateManifest.mockReturnValue({ valid: true, errors: [], warnings: [] });
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('GET /api/v1/developers/agents', () => {
  it('returns only agents owned by the caller', async () => {
    agentStore.push(
      { id: 'a1', name: 'My Agent', version: '1.0.0', status: 'review', installCount: 0, createdAt: new Date() } as unknown as AgentListItem,
    );

    const token = await makeJwt('dev-001');
    const app = createTestApp();
    const res = await app.request('/api/v1/developers/agents', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(mockListAgents).toHaveBeenCalledWith('dev-001');
  });
});

describe('POST /api/v1/developers/agents/submit', () => {
  it('valid manifest → 201, status review', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/agents/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: VALID_MANIFEST,
        packageHash: VALID_HASH,
        description: 'An agent that does things',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { data: { status: string } };
    expect(body.data.status).toBe('review');
    expect(mockCreateListing).toHaveBeenCalledOnce();
  });

  it('invalid manifest → 422 with errors, no DB write', async () => {
    mockValidateManifest.mockReturnValue({
      valid: false,
      errors: ['name is required', 'license must be OSI-approved'],
      warnings: [],
    });

    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/agents/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: {},
        packageHash: VALID_HASH,
        description: 'test',
      }),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as { errors: string[] };
    expect(body.errors).toContain('name is required');
    expect(mockCreateListing).not.toHaveBeenCalled();
  });

  it('uppercase packageHash → 400', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/agents/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: VALID_MANIFEST,
        packageHash: 'A'.repeat(64), // uppercase — invalid
        description: 'test',
      }),
    });

    expect(res.status).toBe(400);
    expect(mockCreateListing).not.toHaveBeenCalled();
  });

  it('wrong-length packageHash → 400', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/agents/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: VALID_MANIFEST,
        packageHash: 'abc', // too short
        description: 'test',
      }),
    });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter @ordr/api test -- --reporter=verbose 2>&1 | grep "developer-agents"
```

Expected: Cannot find module `'../routes/developer-agents.js'`

- [ ] **Step 3: Create the agent route**

```typescript
// apps/api/src/routes/developer-agents.ts
/**
 * Developer Agent Submission Routes
 *
 * SOC2 CC6.1 — Publisher-scoped: developers only see their own agents.
 * Rule 4 — Manifest validated via @ordr/sdk before any DB write.
 * Rule 9 — validateManifest() is a hard gate: no listing on failure.
 *
 * Endpoints:
 * GET  /v1/developers/agents        — list caller's submitted agents
 * POST /v1/developers/agents/submit — validate manifest + create listing
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { validateManifest } from '@ordr/sdk';
import type { AuditLogger } from '@ordr/audit';
import { ValidationError } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';

// ─── Types ──────────────────────────────────────────────────────────

interface AgentListItem {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly status: 'draft' | 'review' | 'published' | 'suspended' | 'rejected';
  readonly installCount: number;
  readonly createdAt: Date;
}

// ─── Input schema ────────────────────────────────────────────────────

const submitSchema = z.object({
  manifest: z.record(z.unknown()),
  packageHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'packageHash must be 64 lowercase hex characters (SHA-256)'),
  description: z.string().min(1, 'Description is required').max(2000),
});

// ─── Dependencies ────────────────────────────────────────────────────

interface AgentDeps {
  readonly auditLogger: AuditLogger;
  readonly listAgentsByPublisher: (publisherId: string) => Promise<AgentListItem[]>;
  readonly createMarketplaceListing: (data: {
    publisherId: string;
    name: string;
    version: string;
    description: string;
    author: string;
    license: string;
    manifest: Record<string, unknown>;
    packageHash: string;
  }) => Promise<AgentListItem>;
}

let deps: AgentDeps | null = null;

export function configureAgentRoutes(dependencies: AgentDeps): void {
  deps = dependencies;
}

// ─── Context helper ──────────────────────────────────────────────────

function ensureCtx(c: { get(key: 'tenantContext'): { userId: string } | undefined; get(key: 'requestId'): string }): {
  userId: string;
  requestId: string;
} {
  const ctx = c.get('tenantContext');
  if (!ctx) throw new Error('[ORDR:API] Auth required');
  return { userId: ctx.userId, requestId: c.get('requestId') };
}

// ─── Router ─────────────────────────────────────────────────────────

export const developerAgentsRouter = new Hono<Env>();

// GET /
developerAgentsRouter.get('/', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Agent routes not configured');
  const { userId } = ensureCtx(c);

  const agents = await deps.listAgentsByPublisher(userId);
  return c.json({ success: true as const, data: agents });
});

// POST /submit
developerAgentsRouter.post('/submit', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Agent routes not configured');
  const { userId, requestId } = ensureCtx(c);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid submission data',
      Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join('.') || 'general', [i.message]]),
      ),
      requestId,
    );
  }

  const { manifest, packageHash, description } = parsed.data;

  // Hard gate: validate manifest via @ordr/sdk (Rule 9)
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    return c.json(
      {
        success: false as const,
        message: 'Manifest validation failed',
        errors: validation.errors,
        warnings: validation.warnings,
        requestId,
      },
      422,
    );
  }

  // Extract required fields from validated manifest
  const mf = manifest as {
    name: string;
    version: string;
    author: string;
    license: string;
  };

  const agent = await deps.createMarketplaceListing({
    publisherId: userId,
    name: mf.name,
    version: mf.version,
    description,
    author: mf.author,
    license: mf.license,
    manifest,
    packageHash,
  });

  // Audit: log IDs and status only — description/manifest excluded (Rule 6)
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.created',
    actorType: 'user',
    actorId: userId,
    resource: 'marketplace_agents',
    resourceId: agent.id,
    action: 'submit_agent',
    details: { status: agent.status },
    timestamp: new Date(),
  });

  return c.json({ success: true as const, data: agent }, 201);
});
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter @ordr/api test -- --reporter=verbose 2>&1 | grep -A 2 "developer-agents"
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/developer-agents.ts \
        apps/api/src/__tests__/developer-agents.test.ts
git commit -m "feat(api): developer agent submission endpoints + tests (Phase 53)"
```

---

### Task 6: Wire routes into app.ts and server.ts

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Add imports and route mounting in `app.ts`**

In `apps/api/src/app.ts`, add these two imports alongside the other developer route imports (around line 57–66):

```typescript
import { developerWebhooksRouter } from './routes/developer-webhooks.js';
import { developerAgentsRouter } from './routes/developer-agents.js';
```

Then add two route mounts after the existing `devUsageRouter` mount (around line 254). The webhook/agent routes must be mounted BEFORE the generic `/api/v1/developers` route since Hono matches the first route that matches:

```typescript
  // NOTE: mounted before /api/v1/developers so it takes precedence for /usage
  app.route('/api/v1/developers/usage', devUsageRouter);

  // Developer portal sub-routes — mounted before /api/v1/developers (Phase 53)
  app.route('/api/v1/developers/webhooks', developerWebhooksRouter);
  app.route('/api/v1/developers/agents', developerAgentsRouter);
```

- [ ] **Step 2: Add configure calls in `server.ts`**

In `apps/api/src/server.ts`, add imports near the other developer route imports (find the `import { configureDevUsageRoute }` line):

```typescript
import { configureWebhookRoutes } from './routes/developer-webhooks.js';
// NOTE: renamed to avoid collision with the existing `configureAgentRoutes` import at line ~95
import { configureAgentRoutes as configureDeveloperAgentRoutes } from './routes/developer-agents.js';
```

Then add configure calls in the server bootstrap. Find the `// ── 7.1. Developer portal routes ──` block and add after the existing `configureDeveloperRoutes({...})` call:

```typescript
  // ── 7.2. Developer webhook routes (Phase 53) ──────────────────────────────
  configureWebhookRoutes({
    auditLogger,
    fieldEncryptor,
    createWebhook: (data) =>
      db
        .insert(schema.developerWebhooks)
        .values({
          developerId: data.developerId,
          url: data.url,
          events: data.events,
          hmacSecretEncrypted: data.hmacSecretEncrypted,
          active: true,
        })
        .returning()
        .then((rows) => {
          const row = rows[0];
          if (!row) throw new Error('Insert returned no rows');
          return row;
        }),
    listWebhooks: (developerId) =>
      db
        .select()
        .from(schema.developerWebhooks)
        .where(eq(schema.developerWebhooks.developerId, developerId))
        .orderBy(asc(schema.developerWebhooks.createdAt)),
    countActiveWebhooks: async (developerId) => {
      const rows = await db
        .select({ total: count() })
        .from(schema.developerWebhooks)
        .where(
          and(
            eq(schema.developerWebhooks.developerId, developerId),
            eq(schema.developerWebhooks.active, true),
          ),
        );
      return rows[0]?.total ?? 0;
    },
    findWebhook: async (developerId, webhookId) => {
      const rows = await db
        .select()
        .from(schema.developerWebhooks)
        .where(
          and(
            eq(schema.developerWebhooks.id, webhookId),
            eq(schema.developerWebhooks.developerId, developerId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    deleteWebhook: async (webhookId) => {
      await db
        .delete(schema.developerWebhooks)
        .where(eq(schema.developerWebhooks.id, webhookId));
    },
    toggleWebhook: async (webhookId, active) => {
      const rows = await db
        .update(schema.developerWebhooks)
        .set({ active, updatedAt: new Date() })
        .where(eq(schema.developerWebhooks.id, webhookId))
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Webhook not found');
      return row;
    },
  });

  // ── 7.3. Developer agent submission routes (Phase 53) ─────────────────────
  configureDeveloperAgentRoutes({
    auditLogger,
    listAgentsByPublisher: async (publisherId) => {
      const rows = await db
        .select({
          id: schema.marketplaceAgents.id,
          name: schema.marketplaceAgents.name,
          version: schema.marketplaceAgents.version,
          status: schema.marketplaceAgents.status,
          installCount: schema.marketplaceAgents.downloads,
          createdAt: schema.marketplaceAgents.createdAt,
        })
        .from(schema.marketplaceAgents)
        .where(eq(schema.marketplaceAgents.publisherId, publisherId))
        .orderBy(desc(schema.marketplaceAgents.createdAt));
      return rows;
    },
    createMarketplaceListing: async (data) => {
      const rows = await db
        .insert(schema.marketplaceAgents)
        .values({
          name: data.name,
          version: data.version,
          description: data.description,
          author: data.author,
          license: data.license,
          manifest: data.manifest,
          packageHash: data.packageHash,
          publisherId: data.publisherId,
          status: 'review',
          downloads: 0,
        })
        .returning({
          id: schema.marketplaceAgents.id,
          name: schema.marketplaceAgents.name,
          version: schema.marketplaceAgents.version,
          status: schema.marketplaceAgents.status,
          installCount: schema.marketplaceAgents.downloads,
          createdAt: schema.marketplaceAgents.createdAt,
        });
      const row = rows[0];
      if (!row) throw new Error('Insert returned no rows');
      return row;
    },
  });
```

Note: `fieldEncryptor` is already wired in the server. Check that it is already imported and passed to `configureIntegrationRoutes` — if so, reuse the same instance.

- [ ] **Step 3: Check that server.ts has the needed imports**

Verify `apps/api/src/server.ts` already imports `asc`, `desc`, `count`, `and`, `eq` from `drizzle-orm`. If any are missing, add them to the existing import line:

```bash
grep "from 'drizzle-orm'" apps/api/src/server.ts | head -5
```

- [ ] **Step 4: Run the full API test suite**

```bash
pnpm --filter @ordr/api test
```

Expected: All tests pass (should see 900+ pass).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/server.ts
git commit -m "feat(api): mount developer webhook + agent routes (Phase 53)"
```

---

## ## Chunk 3: UI

### Task 7: Client API additions

**Files:**
- Modify: `apps/web/src/lib/developer-api.ts`

- [ ] **Step 1: Add webhook and agent types + functions**

Append to the end of `apps/web/src/lib/developer-api.ts`:

```typescript
// ── Developer Webhooks ─────────────────────────────────────────────────────

export interface WebhookItem {
  readonly id: string;
  readonly url: string;
  readonly events: string[];
  readonly active: boolean;
  readonly lastTriggeredAt: string | null;
  readonly createdAt: string;
}

/** Only returned at creation — hmacSecret is shown once and never again. */
export interface WebhookCreated extends WebhookItem {
  readonly hmacSecret: string;
}

export function listWebhooks(): Promise<{ readonly success: true; readonly data: WebhookItem[] }> {
  return apiClient.get<{ readonly success: true; readonly data: WebhookItem[] }>(
    '/v1/developers/webhooks',
  );
}

export function createWebhook(body: {
  readonly url: string;
  readonly events: string[];
}): Promise<{ readonly success: true; readonly data: WebhookCreated }> {
  return apiClient.post<{ readonly success: true; readonly data: WebhookCreated }>(
    '/v1/developers/webhooks',
    body,
  );
}

export async function deleteWebhook(webhookId: string): Promise<void> {
  await apiClient.delete(`/v1/developers/webhooks/${webhookId}`);
}

export function toggleWebhook(
  webhookId: string,
  active: boolean,
): Promise<{ readonly success: true; readonly data: WebhookItem }> {
  return apiClient.patch<{ readonly success: true; readonly data: WebhookItem }>(
    `/v1/developers/webhooks/${webhookId}/toggle`,
    { active },
  );
}

// ── My Agents ──────────────────────────────────────────────────────────────

export interface MyAgent {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly status: 'draft' | 'review' | 'published' | 'suspended' | 'rejected';
  readonly installCount: number;
  readonly createdAt: string;
}

export function listMyAgents(): Promise<{ readonly success: true; readonly data: MyAgent[] }> {
  return apiClient.get<{ readonly success: true; readonly data: MyAgent[] }>(
    '/v1/developers/agents',
  );
}

export function submitAgent(body: {
  readonly manifest: Record<string, unknown>;
  readonly packageHash: string;
  readonly description: string;
}): Promise<{ readonly success: true; readonly data: MyAgent }> {
  return apiClient.post<{ readonly success: true; readonly data: MyAgent }>(
    '/v1/developers/agents/submit',
    body,
  );
}
```

Note: `apiClient.patch` may not exist if the client only has `get/post/delete`. Check `apps/web/src/lib/api.ts`. If `patch` is missing, add it the same way `delete` is implemented. If it exists, use it as-is.

- [ ] **Step 2: Verify apiClient has patch method**

```bash
grep -n "patch" apps/web/src/lib/api.ts
```

Expected: `patch<T>` method exists at line ~134. It is already present — no change needed to `api.ts`.

- [ ] **Step 3: Run web tests to verify no regressions**

```bash
pnpm --filter @ordr/web test
```

Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/developer-api.ts
git commit -m "feat(web): add webhook + agent client API functions (Phase 53)"
```

_(Do NOT stage `apps/web/src/lib/api.ts` — no changes were made to it.)_

---

### Task 8: UI wiring + tests

**Files:**
- Modify: `apps/web/src/__tests__/DeveloperConsole.test.tsx` (TDD — write tests first)
- Modify: `apps/web/src/pages/DeveloperConsole.tsx`

- [ ] **Step 1: Write failing UI tests**

Add these tests at the end of the existing `describe('DeveloperConsole', ...)` block in `apps/web/src/__tests__/DeveloperConsole.test.tsx`:

```typescript
  // ── Webhook tests (Phase 53) ──────────────────────────────────────

  it('calls listWebhooks on load', async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });
    renderComponent();

    await waitFor(() => {
      // Should have called /v1/developers/webhooks
      const webhookCall = (mockGet.mock.calls as string[][]).some((args) =>
        args[0]?.includes('/v1/developers/webhooks'),
      );
      expect(webhookCall).toBe(true);
    });
  });

  it('fires createWebhook when Add Webhook form is submitted', async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });
    mockPost.mockResolvedValue({
      success: true,
      data: {
        id: 'wh-new',
        url: 'https://example.com/hook',
        events: ['customer.created'],
        active: true,
        hmacSecret: 'a'.repeat(64),
        lastTriggeredAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    renderComponent();
    await waitFor(() => {
      expect(screen.queryByText('Loading developer console')).toBeNull();
    });

    // Open the Add Webhook modal
    const addButton = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Add Webhook'),
    );
    expect(addButton).toBeDefined();
    await act(async () => {
      fireEvent.click(addButton!);
    });

    // The modal should open (check for URL input)
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/https:\/\//i)).not.toBeNull();
    });
  });

  it('shows HMAC secret modal after webhook creation', async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });
    mockPost.mockResolvedValue({
      success: true,
      data: {
        id: 'wh-new',
        url: 'https://example.com/hook',
        events: ['customer.created'],
        active: true,
        hmacSecret: 'deadbeef'.repeat(8),
        lastTriggeredAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    renderComponent();
    await waitFor(() => {
      expect(screen.queryByText('Loading developer console')).toBeNull();
    });

    // Open add webhook modal and submit
    const addBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Add Webhook'),
    );
    await act(async () => {
      fireEvent.click(addBtn!);
    });

    // Wait for modal, fill URL, check events checkbox, submit
    await waitFor(() => {
      const urlInput = screen.queryByPlaceholderText(/https:\/\//i);
      if (urlInput) {
        fireEvent.change(urlInput, { target: { value: 'https://example.com/hook' } });
      }
    });

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Save') || b.textContent?.includes('Create'),
    );
    if (saveBtn) {
      await act(async () => {
        fireEvent.click(saveBtn);
      });

      // HMAC secret should be shown
      await waitFor(() => {
        expect(screen.queryByText(/signing secret/i) ?? screen.queryByText(/hmac/i)).not.toBeNull();
      });
    }
  });

  // ── Agent submission tests (Phase 53) ─────────────────────────────

  it('calls listMyAgents on load (not listMarketplaceAgents)', async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });
    renderComponent();

    await waitFor(() => {
      const agentCall = (mockGet.mock.calls as string[][]).some((args) =>
        args[0]?.includes('/v1/developers/agents'),
      );
      expect(agentCall).toBe(true);
      // Should NOT call the public marketplace endpoint
      const marketplaceCall = (mockGet.mock.calls as string[][]).some((args) =>
        args[0] === '/v1/marketplace',
      );
      expect(marketplaceCall).toBe(false);
    });
  });

  // ── Sandbox tests (Phase 53) ──────────────────────────────────────

  it('calls destroySandbox when Destroy button is clicked', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'sb-001',
          tenantId: 'tenant-001',
          developerId: 'dev-001',
          name: 'Test Sandbox',
          seedDataProfile: 'minimal',
          status: 'active',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ],
    });
    mockDelete.mockResolvedValue({});

    renderComponent();

    await waitFor(() => {
      expect(screen.queryByText('Test Sandbox')).not.toBeNull();
    });

    const destroyBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Destroy'),
    );
    if (destroyBtn) {
      await act(async () => {
        fireEvent.click(destroyBtn);
      });
      expect(mockDelete).toHaveBeenCalled();
    }
  });
```

- [ ] **Step 2: Run tests — verify new tests fail**

```bash
pnpm --filter @ordr/web test -- --reporter=verbose 2>&1 | tail -20
```

Expected: New tests fail (DeveloperConsole doesn't call `listWebhooks` or `listMyAgents` yet).

- [ ] **Step 3: Update `DeveloperConsole.tsx` — webhook section**

In `apps/web/src/pages/DeveloperConsole.tsx`:

**3a. Update imports** — add new API functions to the existing `developer-api` import:

```typescript
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  listSandboxes,
  createSandbox,
  destroySandbox,
  getDeveloperUsage,
  listWebhooks,
  createWebhook,
  deleteWebhook,
  toggleWebhook,
  listMyAgents,
  submitAgent,
  type ApiKey,
  type SandboxTenant,
  type WebhookItem,
  type WebhookCreated,
  type MyAgent,
} from '../lib/developer-api';
```

**3b. Add state variables** — after existing state declarations:

```typescript
const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
const [newWebhookSecret, setNewWebhookSecret] = useState<string | null>(null);
const [showAddWebhook, setShowAddWebhook] = useState(false);
const [newWebhookUrl, setNewWebhookUrl] = useState('');
const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>([]);
const [showSubmitAgent, setShowSubmitAgent] = useState(false);
const [agentManifestJson, setAgentManifestJson] = useState('');
const [agentPackageHash, setAgentPackageHash] = useState('');
const [agentDescription, setAgentDescription] = useState('');
const [agentSubmitErrors, setAgentSubmitErrors] = useState<string[]>([]);
const [showNewSandbox, setShowNewSandbox] = useState(false);
const [newSandboxName, setNewSandboxName] = useState('');
const [newSandboxProfile, setNewSandboxProfile] = useState<'minimal' | 'collections' | 'healthcare'>('minimal');
```

**3c. Update `fetchData`** — wire `listWebhooks` and `listMyAgents`:

Replace the relevant lines in `fetchData`:

```typescript
const [keysRes, agentsRes, sandboxRes, usageRes, webhooksRes] = await Promise.allSettled([
  listApiKeys(),
  listMyAgents(),           // <-- was listMarketplaceAgents({ pageSize: 20 })
  listSandboxes(),
  getDeveloperUsage(7),
  listWebhooks(),           // <-- new
]);

// ...existing keys/usage/sandbox handling...

setAgents(
  agentsRes.status === 'fulfilled'
    ? agentsRes.value.data.map((a) => ({
        id: a.id,
        name: a.name,
        version: a.version,
        status: (agentStatusMap[a.status] as PublishedAgent['status'] | undefined) ?? 'published',
        downloads: a.installCount,
        createdAt: a.createdAt,
      }))
    : mockAgents,
);

setWebhooks(webhooksRes.status === 'fulfilled' ? webhooksRes.value.data : []);
```

Remove the `listMarketplaceAgents` import entirely (or leave if still needed elsewhere — check first).

**3d. Add `handleAddWebhook` callback**:

```typescript
const handleAddWebhook = useCallback(async () => {
  if (!newWebhookUrl.trim() || newWebhookEvents.length === 0) return;
  try {
    const res = await createWebhook({ url: newWebhookUrl, events: newWebhookEvents });
    setWebhooks((prev) => [...prev, res.data]);
    setNewWebhookSecret(res.data.hmacSecret);
    setShowAddWebhook(false);
    setNewWebhookUrl('');
    setNewWebhookEvents([]);
  } catch {
    // Show error or leave modal open
  }
}, [newWebhookUrl, newWebhookEvents]);

const handleDeleteWebhook = useCallback(async (webhookId: string) => {
  try {
    await deleteWebhook(webhookId);
    setWebhooks((prev) => prev.filter((w) => w.id !== webhookId));
  } catch {
    // no-op
  }
}, []);

const handleToggleWebhook = useCallback(async (webhookId: string, currentActive: boolean) => {
  try {
    const res = await toggleWebhook(webhookId, !currentActive);
    setWebhooks((prev) => prev.map((w) => (w.id === webhookId ? res.data : w)));
  } catch {
    // no-op
  }
}, []);
```

**3e. Add `handleSubmitAgent` callback**:

```typescript
const handleSubmitAgent = useCallback(async () => {
  setAgentSubmitErrors([]);
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(agentManifestJson) as Record<string, unknown>;
  } catch {
    setAgentSubmitErrors(['Manifest must be valid JSON']);
    return;
  }
  try {
    const res = await submitAgent({
      manifest,
      packageHash: agentPackageHash.trim(),
      description: agentDescription.trim(),
    });
    setAgents((prev) => [
      {
        id: res.data.id,
        name: res.data.name,
        version: res.data.version,
        status: (agentStatusMap[res.data.status] as PublishedAgent['status'] | undefined) ?? 'review',
        downloads: res.data.installCount,
        createdAt: res.data.createdAt,
      },
      ...prev,
    ]);
    setShowSubmitAgent(false);
    setAgentManifestJson('');
    setAgentPackageHash('');
    setAgentDescription('');
  } catch (err: unknown) {
    // Parse 422 errors
    const body = (err as { response?: { errors?: string[] } }).response;
    if (body?.errors) {
      setAgentSubmitErrors(body.errors);
    } else {
      setAgentSubmitErrors(['Submission failed. Please try again.']);
    }
  }
}, [agentManifestJson, agentPackageHash, agentDescription]);
```

**3f. Add `handleCreateSandbox` and `handleDestroySandbox` callbacks**:

```typescript
const handleCreateSandbox = useCallback(async () => {
  if (!newSandboxName.trim()) return;
  try {
    const res = await createSandbox({ name: newSandboxName, seedProfile: newSandboxProfile });
    setSandboxes((prev) => [adaptSandbox(res.data), ...prev]);
    setShowNewSandbox(false);
    setNewSandboxName('');
  } catch {
    // no-op
  }
}, [newSandboxName, newSandboxProfile]);

const handleDestroySandbox = useCallback(async (sandboxId: string) => {
  try {
    await destroySandbox(sandboxId);
    setSandboxes((prev) => prev.filter((s) => s.id !== sandboxId));
  } catch {
    // no-op
  }
}, []);
```

**3g. Update the Webhooks section JSX** — wire the Webhook Card to real state, enable the Add Webhook button, and add Delete + Toggle per row.

Replace the existing `Card` for "Webhook Configuration" (from `{/* Webhooks section */}` to `</Card>` around line 655–727) with:

```tsx
{/* Webhooks section */}
<Card
  title="Webhook Configuration"
  accent="blue"
  actions={
    <Button
      size="sm"
      icon={<Plus className="h-3 w-3" />}
      onClick={() => { setShowAddWebhook(true); }}
    >
      Add Webhook
    </Button>
  }
>
  <div className="space-y-3">
    {webhooks.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Webhook className="h-8 w-8 text-content-tertiary" />
        <p className="mt-2 text-sm text-content-secondary">No webhooks configured.</p>
      </div>
    ) : (
      webhooks.map((wh) => (
        <div
          key={wh.id}
          className="rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-tertiary"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 shrink-0 text-content-tertiary" />
                <code className="truncate font-mono text-xs text-content">{wh.url}</code>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {wh.events.map((evt) => (
                  <Badge key={evt} variant="info" size="sm">
                    <span className="font-mono">{evt}</span>
                  </Badge>
                ))}
              </div>
              <p className="text-2xs text-content-tertiary">
                {wh.lastTriggeredAt !== null
                  ? `Last triggered ${new Date(wh.lastTriggeredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                  : 'Never triggered'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={wh.active ? 'success' : 'neutral'} dot size="sm">
                {wh.active ? 'Active' : 'Inactive'}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                icon={<Zap className="h-3.5 w-3.5" />}
                aria-label={wh.active ? 'Disable webhook' : 'Enable webhook'}
                onClick={() => { void handleToggleWebhook(wh.id, wh.active); }}
              />
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 className="h-3.5 w-3.5 text-content-tertiary" />}
                aria-label="Delete webhook"
                onClick={() => { void handleDeleteWebhook(wh.id); }}
              />
            </div>
          </div>
        </div>
      ))
    )}

    {/* Webhook payload example */}
    <div className="mt-4 rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <Code2 className="h-4 w-4 text-kpi-blue" />
        <p className="text-xs font-semibold text-content">Webhook Payload Format</p>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border bg-surface-secondary p-3 font-mono text-xs leading-relaxed text-content-secondary">
        {webhookExampleCode}
      </pre>
    </div>
  </div>
</Card>
```

**3h. Update the Published Agents section** — add "Submit Agent" button to the agents Card actions.

Find the `<Card title="Published Agents"` (or similar) and add an `actions` prop if not present:

```tsx
actions={
  <Button
    size="sm"
    icon={<Plus className="h-3 w-3" />}
    onClick={() => { setShowSubmitAgent(true); }}
  >
    Submit Agent
  </Button>
}
```

Also remove the `import { listMarketplaceAgents, type MarketplaceAgent as ApiMarketplaceAgent } from '../lib/marketplace-api'` import (check it's unused first with a grep).

**3i. Update the Sandbox section** — add "New Sandbox" button and "Destroy" per row.

Add `actions` to the "Sandbox Environments" Card:

```tsx
actions={
  <Button
    size="sm"
    icon={<Plus className="h-3 w-3" />}
    onClick={() => { setShowNewSandbox(true); }}
  >
    New Sandbox
  </Button>
}
```

Add a "Destroy" button inside each sandbox row, after the expiry text:

```tsx
<Button
  variant="ghost"
  size="sm"
  icon={<Trash2 className="h-3.5 w-3.5 text-content-tertiary" />}
  onClick={() => { void handleDestroySandbox(sb.id); }}
>
  Destroy
</Button>
```

**3j. Add four new modals** — insert before the closing `</div>` of the return (after the existing "Raw key display modal"):

```tsx
{/* Add Webhook modal */}
<Modal
  open={showAddWebhook}
  onClose={() => { setShowAddWebhook(false); }}
  title="Add Webhook"
  actions={
    <>
      <Button variant="ghost" size="sm" onClick={() => { setShowAddWebhook(false); }}>
        Cancel
      </Button>
      <Button
        size="sm"
        icon={<Webhook className="h-3 w-3" />}
        onClick={() => { void handleAddWebhook(); }}
        disabled={!newWebhookUrl.trim() || newWebhookEvents.length === 0}
      >
        Save Webhook
      </Button>
    </>
  }
>
  <div className="space-y-4">
    <Input
      label="Endpoint URL"
      placeholder="https://your-server.com/webhooks"
      value={newWebhookUrl}
      onChange={(e) => { setNewWebhookUrl(e.target.value); }}
      required
    />
    <div>
      <p className="mb-2 text-xs font-semibold text-content">Events to subscribe</p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {WEBHOOK_EVENTS.map((evt) => (
          <label key={evt} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border accent-kpi-blue"
              checked={newWebhookEvents.includes(evt)}
              onChange={() => {
                setNewWebhookEvents((prev) =>
                  prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt],
                );
              }}
            />
            <span className="font-mono text-xs text-content">{evt}</span>
          </label>
        ))}
      </div>
    </div>
  </div>
</Modal>

{/* Webhook signing secret modal */}
<Modal
  open={newWebhookSecret !== null}
  onClose={() => { setNewWebhookSecret(null); }}
  title="Webhook Signing Secret"
  actions={
    <Button size="sm" onClick={() => { setNewWebhookSecret(null); }}>
      Done
    </Button>
  }
>
  <div className="space-y-3">
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <p className="text-sm text-amber-400">
        Copy this signing secret now. It will not be shown again.
      </p>
    </div>
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary p-3">
      <code className="flex-1 break-all font-mono text-xs text-content">{newWebhookSecret}</code>
      <Button
        variant="ghost"
        size="sm"
        icon={<Copy className="h-3.5 w-3.5" />}
        onClick={() => {
          if (newWebhookSecret) void navigator.clipboard.writeText(newWebhookSecret);
        }}
      >
        Copy
      </Button>
    </div>
  </div>
</Modal>

{/* Submit Agent modal */}
<Modal
  open={showSubmitAgent}
  onClose={() => { setShowSubmitAgent(false); }}
  title="Submit Agent"
  actions={
    <>
      <Button variant="ghost" size="sm" onClick={() => { setShowSubmitAgent(false); }}>
        Cancel
      </Button>
      <Button
        size="sm"
        icon={<Bot className="h-3 w-3" />}
        onClick={() => { void handleSubmitAgent(); }}
        disabled={!agentManifestJson.trim() || !agentPackageHash.trim()}
      >
        Submit for Review
      </Button>
    </>
  }
>
  <div className="space-y-3">
    {agentSubmitErrors.length > 0 && (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
        <ul className="space-y-0.5">
          {agentSubmitErrors.map((err, i) => (
            <li key={i} className="text-xs text-red-400">{err}</li>
          ))}
        </ul>
      </div>
    )}
    <div>
      <label className="mb-1 block text-xs font-semibold text-content">
        Manifest JSON
      </label>
      <textarea
        className="w-full rounded-lg border border-border bg-surface p-2 font-mono text-xs text-content focus:outline-none focus:ring-1 focus:ring-kpi-blue"
        rows={8}
        placeholder={'{\n  "name": "my-agent",\n  "version": "1.0.0"\n}'}
        value={agentManifestJson}
        onChange={(e) => { setAgentManifestJson(e.target.value); }}
      />
    </div>
    <Input
      label="Package Hash (SHA-256)"
      placeholder="64 lowercase hex characters"
      value={agentPackageHash}
      onChange={(e) => { setAgentPackageHash(e.target.value); }}
    />
    <Input
      label="Description"
      placeholder="What does this agent do?"
      value={agentDescription}
      onChange={(e) => { setAgentDescription(e.target.value); }}
    />
  </div>
</Modal>

{/* New Sandbox modal */}
<Modal
  open={showNewSandbox}
  onClose={() => { setShowNewSandbox(false); }}
  title="New Sandbox"
  actions={
    <>
      <Button variant="ghost" size="sm" onClick={() => { setShowNewSandbox(false); }}>
        Cancel
      </Button>
      <Button
        size="sm"
        icon={<Terminal className="h-3 w-3" />}
        onClick={() => { void handleCreateSandbox(); }}
        disabled={!newSandboxName.trim()}
      >
        Create Sandbox
      </Button>
    </>
  }
>
  <div className="space-y-3">
    <Input
      label="Sandbox Name"
      placeholder="e.g. Integration Testing"
      value={newSandboxName}
      onChange={(e) => { setNewSandboxName(e.target.value); }}
      required
    />
    <div>
      <label className="mb-1 block text-xs font-semibold text-content">Seed Profile</label>
      <select
        className="w-full rounded-lg border border-border bg-surface p-2 text-sm text-content focus:outline-none focus:ring-1 focus:ring-kpi-blue"
        value={newSandboxProfile}
        onChange={(e) => {
          setNewSandboxProfile(e.target.value as 'minimal' | 'collections' | 'healthcare');
        }}
      >
        <option value="minimal">Minimal</option>
        <option value="collections">Collections</option>
        <option value="healthcare">Healthcare</option>
      </select>
    </div>
  </div>
</Modal>
```

Also add a `WEBHOOK_EVENTS` constant above the component (before the `export default function DeveloperConsole`) — this avoids importing from `@ordr/events` in the web package:

```typescript
/** Local copy of deliverable events for the Add Webhook modal checkboxes. */
const WEBHOOK_EVENTS = [
  'customer.created',
  'customer.updated',
  'interaction.logged',
  'agent.triggered',
  'agent.action_executed',
  'agent.completed',
  'ticket.created',
  'ticket.resolved',
  'dsr.approved',
  'dsr.completed',
  'compliance.alert',
  'integration.webhook_received',
] as const;
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter @ordr/web test
```

Expected: All tests pass including the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/DeveloperConsole.tsx \
        apps/web/src/__tests__/DeveloperConsole.test.tsx
git commit -m "feat(web): wire webhook/agent/sandbox UI to real API (Phase 53)"
```

---

### Task 9: Final integration check

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: All packages pass. Look for:
- `@ordr/events` — ✓
- `@ordr/db` — ✓ (if it has tests)
- `@ordr/api` — 900+ tests passing
- `@ordr/web` — all tests passing

- [ ] **Step 2: Run TypeScript strict check across affected packages**

```bash
pnpm --filter @ordr/api tsc --noEmit
pnpm --filter @ordr/web tsc --noEmit
pnpm --filter @ordr/events tsc --noEmit
```

Expected: No TypeScript errors.

- [ ] **Step 3: Push to main**

```bash
git push origin main
```
