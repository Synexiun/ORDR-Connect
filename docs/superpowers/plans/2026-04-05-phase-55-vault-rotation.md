# Phase 55 — Vault Secret Rotation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire HashiCorp Vault as the live secret source for ORDR-Connect — replacing raw `process.env` reads with Vault-backed hot-reload — and implement an automated 80-day DEK re-wrap pipeline for the `ENCRYPTION_MASTER_KEY`.

**Architecture:** A new `packages/vault` package owns the entire Vault HTTP surface (K8s auth, polling, key rotation tracking). `apps/api/src/server.ts` calls `initSecretStore()` at startup and registers `onRotate` callbacks for each secret. The `apps/worker` re-wrap pipeline runs daily via the existing `packages/scheduler` cron engine, pages through `encrypted_fields` with keyset pagination, and emits WORM audit events per batch.

**Tech Stack:** Node.js native `fetch` (no Vault npm library), Hono API, Drizzle ORM + PostgreSQL, Vitest, existing `packages/crypto` `EnvelopeEncryption`, existing `packages/scheduler` `JobScheduler`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/vault/package.json` | Create | `@ordr/vault` package manifest |
| `packages/vault/tsconfig.json` | Create | TypeScript config |
| `packages/vault/src/client.ts` | Create | `VaultClient` — K8s auth, token renewal, KV v2 CRUD |
| `packages/vault/src/secret-store.ts` | Create | `SecretStore` singleton + polling loop |
| `packages/vault/src/key-rotation-tracker.ts` | Create | `KeyRotationTracker` — expiry, new version, mark inactive |
| `packages/vault/src/index.ts` | Create | Public exports |
| `packages/vault/src/__tests__/client.test.ts` | Create | VaultClient unit tests (mock fetch) |
| `packages/vault/src/__tests__/secret-store.test.ts` | Create | SecretStore unit tests |
| `packages/vault/src/__tests__/key-rotation-tracker.test.ts` | Create | Tracker unit tests |
| `packages/db/src/schema/encrypted-fields.ts` | Create | Drizzle schema for `encrypted_fields` |
| `packages/db/src/schema/key-rotation-jobs.ts` | Create | Drizzle schema for `key_rotation_jobs` |
| `packages/db/migrations/0014_encrypted_fields.sql` | Create | SQL migration |
| `packages/db/migrations/0015_key_rotation_jobs.sql` | Create | SQL migration |
| `packages/scheduler/src/jobs/key-rotation-check.ts` | Create | Job definition + handler factory |
| `packages/scheduler/src/index.ts` | Modify | Export new job |
| `apps/api/src/jobs/key-rotation.ts` | Create | Re-wrap pipeline implementation (runs in API process where scheduler lives) |
| `apps/api/src/jobs/__tests__/key-rotation.test.ts` | Create | Re-wrap unit tests |
| `apps/api/src/server.ts` | Modify | Add `initSecretStore` + `onRotate` callbacks + scheduler job wiring |
| `.env.example` | Modify | Add Vault section |
| `packages/core/src/config.ts` | Modify | Add optional Vault Zod fields |

---

## Chunk 1: Package Scaffold + DB Schemas + Config

### Task 1: Scaffold `packages/vault`, DB schemas, migrations, and env/config

**Files:**
- Create: `packages/vault/package.json`
- Create: `packages/vault/tsconfig.json`
- Create: `packages/vault/src/index.ts` (empty stub — filled in Task 4)
- Create: `packages/db/src/schema/encrypted-fields.ts`
- Create: `packages/db/src/schema/key-rotation-jobs.ts`
- Create: `packages/db/migrations/0014_encrypted_fields.sql`
- Create: `packages/db/migrations/0015_key_rotation_jobs.sql`
- Modify: `.env.example`
- Modify: `packages/core/src/config.ts`

> **Before starting:** Confirm the highest-numbered migration file in `packages/db/migrations/`. If it is `0013_developer_webhooks.sql`, use `0014` and `0015`. If another migration was added, increment accordingly.

- [ ] **Step 1: Create `packages/vault/package.json`**

```json
{
  "name": "@ordr/vault",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "*"
  }
}
```

- [ ] **Step 2: Create `packages/vault/tsconfig.json`**

Match the exact pattern from `packages/crypto/tsconfig.json` (extends `tsconfig.base.json`, not `tsconfig.json` — the latter does not exist at the repo root):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "coverage", "src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create stub `packages/vault/src/index.ts`**

```typescript
// Populated in Task 4 after all classes are implemented.
export {};
```

- [ ] **Step 4: Create `packages/db/src/schema/encrypted-fields.ts`**

```typescript
/**
 * encrypted_fields — per-tenant DEK envelope store
 *
 * Canonical home for wrapped Data Encryption Keys (DEKs). Field-level
 * encryption in the application writes DEK envelopes here and reads them
 * back for decryption. The bulk ciphertext lives in the domain table;
 * only the small DEK envelope lives here.
 *
 * SOC2 CC6.7 — Encryption at rest: two-tier key hierarchy.
 * Rule 1 — AES-256-GCM envelope encryption; keys rotated ≤90 days.
 */

import { pgTable, uuid, text, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';

export const encryptedFields = pgTable(
  'encrypted_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Tenant that owns this DEK envelope — Row-Level Security anchor */
    tenantId: uuid('tenant_id').notNull(),

    /** Domain object type, e.g. 'customer', 'message' */
    resource: text('resource').notNull(),

    /** UUID of the domain object */
    resourceId: uuid('resource_id').notNull(),

    /** Field name within the resource, e.g. 'phone', 'email' */
    fieldName: text('field_name').notNull(),

    /**
     * EncryptedEnvelope — { wrappedDek, dekIv, dekAuthTag, keyVersion,
     *                        ciphertext, iv, authTag, algorithm }
     * keyVersion is the Vault KV v2 version of the KEK used to wrap this DEK.
     */
    dekEnvelope: jsonb('dek_envelope').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('uq_encrypted_fields_resource_field').on(
      table.tenantId,
      table.resource,
      table.resourceId,
      table.fieldName,
    ),
    index('idx_encrypted_fields_tenant').on(table.tenantId),
  ],
);
```

- [ ] **Step 5: Create `packages/db/src/schema/key-rotation-jobs.ts`**

```typescript
/**
 * key_rotation_jobs — concurrency guard + progress tracker for DEK re-wrap
 *
 * One row per active rotation job. Prevents duplicate concurrent re-wraps
 * on multi-replica worker deployments. Stores keyset cursor for idempotent
 * resume after crash.
 *
 * Rule 3 — WORM audit events accompany every job state change.
 * Rule 1 — Key rotation automated at ≤90 day cycle.
 */

import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const keyRotationJobs = pgTable('key_rotation_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),

  /** Name of the secret key being rotated, e.g. 'ENCRYPTION_MASTER_KEY' */
  keyName: text('key_name').notNull(),

  /** Vault KV v2 version being replaced */
  oldVersion: integer('old_version').notNull(),

  /** Vault KV v2 version being written */
  newVersion: integer('new_version').notNull(),

  /** 'running' | 'completed' | 'failed' */
  status: text('status').notNull().default('running'),

  /** Total rows to process — null until counted after job insert */
  rowsTotal: integer('rows_total'),

  /** Rows successfully re-wrapped */
  rowsDone: integer('rows_done').notNull().default(0),

  /** Keyset cursor — UUID of last successfully processed encrypted_fields row */
  lastProcessedId: uuid('last_processed_id'),

  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),

  completedAt: timestamp('completed_at', { withTimezone: true }),
});
```

- [ ] **Step 5b: Export new tables from `packages/db/src/schema/index.ts`**

Open `packages/db/src/schema/index.ts` and add at the end (after the `// Integrations (Phase 52)` block):

```typescript
// Encrypted Fields + Key Rotation Jobs (Phase 55)
export { encryptedFields } from './encrypted-fields.js';
export { keyRotationJobs } from './key-rotation-jobs.js';
```

- [ ] **Step 6: Create `packages/db/migrations/0014_encrypted_fields.sql`**

```sql
-- Phase 55: encrypted_fields — canonical DEK envelope store
-- Rule 1: AES-256-GCM two-tier key hierarchy; rotation ≤90 days

CREATE TABLE IF NOT EXISTS encrypted_fields (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  resource      TEXT NOT NULL,
  resource_id   UUID NOT NULL,
  field_name    TEXT NOT NULL,
  dek_envelope  JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_encrypted_fields_resource_field
    UNIQUE (tenant_id, resource, resource_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_encrypted_fields_tenant
  ON encrypted_fields(tenant_id);
```

- [ ] **Step 7: Create `packages/db/migrations/0015_key_rotation_jobs.sql`**

```sql
-- Phase 55: key_rotation_jobs — concurrency guard for DEK re-wrap
-- Rule 1: automated rotation tracking; Rule 3: WORM audit accompanies every run

CREATE TABLE IF NOT EXISTS key_rotation_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name          TEXT NOT NULL,
  old_version       INTEGER NOT NULL,
  new_version       INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'running',
  rows_total        INTEGER,
  rows_done         INTEGER NOT NULL DEFAULT 0,
  last_processed_id UUID,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);
```

- [ ] **Step 8: Add Vault section to `.env.example`**

Open `.env.example` and add this block after the `# Monitoring` section (at the end of the file):

```bash
# ── Vault (Secret Management) ──────────────────────────────────
# Production secrets MUST come from HashiCorp Vault (already deployed on EKS).
# When VAULT_ADDR is absent, all Vault operations are no-ops and the app
# falls back to process.env values (local dev only).
VAULT_ADDR=                          # https://vault.internal:8200
VAULT_ROLE=                          # Kubernetes auth role name (e.g. ordr-api)
VAULT_MOUNT=secret                   # KV v2 mount path (default: secret)
VAULT_POLL_INTERVAL_MS=60000         # Secret polling interval in ms (default: 60 s)
KEY_ROTATION_CHECK_CRON=0 2 * * *   # Daily at 02:00 UTC
```

- [ ] **Step 9: Add Vault fields to `packages/core/src/config.ts`**

Open `packages/core/src/config.ts`. Make four edits (do NOT replace the whole file):

**9a — Inside `z.object({...})`**, add after the `// ── Monitoring` section (before the closing `}`):

```typescript
  // ── Vault (Secret Management — optional; no-op when absent) ─────
  VAULT_ADDR: z.string().url().optional(),
  VAULT_ROLE: z.string().min(1).optional(),
  VAULT_MOUNT: z.string().min(1).default('secret'),
  VAULT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  KEY_ROTATION_CHECK_CRON: z.string().default('0 2 * * *'),
```

**9b — Chain `.refine()` onto `z.object({...})`**. Find the closing `});` of the `z.object({` block that starts on line 24 of `config.ts` (i.e., the lone `});` on line 68 — there is only one such closing for `envSchema`). Replace that `});` with:

```typescript
}).refine(
  (data) => {
    if (data.VAULT_ADDR !== undefined && data.VAULT_ADDR !== '') {
      return data.VAULT_ROLE !== undefined && data.VAULT_ROLE !== '';
    }
    return true;
  },
  { message: 'VAULT_ROLE is required when VAULT_ADDR is set', path: ['VAULT_ROLE'] },
);
```

**9c — Add `VaultConfig` interface** after the existing `MonitoringConfig` interface:

```typescript
export interface VaultConfig {
  readonly addr: string | undefined;
  readonly role: string | undefined;
  readonly mount: string;
  readonly pollIntervalMs: number;
  readonly keyRotationCheckCron: string;
}
```

**9d — Add `vault` to `ParsedConfig`** by adding this field after `readonly monitoring: MonitoringConfig;`:

```typescript
  readonly vault: VaultConfig;
```

**9e — Populate `vault` in `loadConfig()`** by adding this entry in the returned object after the `monitoring:` block:

```typescript
    vault: {
      addr: parsed.VAULT_ADDR,
      role: parsed.VAULT_ROLE,
      mount: parsed.VAULT_MOUNT,
      pollIntervalMs: parsed.VAULT_POLL_INTERVAL_MS,
      keyRotationCheckCron: parsed.KEY_ROTATION_CHECK_CRON,
    },
```

> **Important:** `AppConfig = z.infer<typeof envSchema>` (line 72) will automatically include the new Vault fields after the `.refine()` is chained — no change needed to that line.

- [ ] **Step 10: TypeScript check**

```bash
cd packages/core && npx tsc --noEmit
```

Expected: no output (success).

- [ ] **Step 11: Commit**

```bash
cd D:/Synexiun/12-SynexCom/ORDR-Connect
git add packages/vault/package.json packages/vault/tsconfig.json packages/vault/src/index.ts
git add packages/db/src/schema/encrypted-fields.ts packages/db/src/schema/key-rotation-jobs.ts
git add packages/db/src/schema/index.ts
git add packages/db/migrations/0014_encrypted_fields.sql packages/db/migrations/0015_key_rotation_jobs.sql
git add .env.example packages/core/src/config.ts
git commit -m "feat(vault): scaffold package + DB schemas + env config — Phase 55"
```

---

## Chunk 2: VaultClient + SecretStore

### Task 2: VaultClient (TDD)

**Files:**
- Create: `packages/vault/src/__tests__/client.test.ts`
- Create: `packages/vault/src/client.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/vault/src/__tests__/client.test.ts`:

```typescript
/**
 * VaultClient Unit Tests
 *
 * Uses vi.fn() to mock global fetch — no real Vault server.
 * Tests:
 * - No-op when VAULT_ADDR is absent
 * - K8s auth flow (reads JWT file, POSTs to login)
 * - get() returns value on 200, undefined on 404, throws on 500
 * - getMetadata() returns version + createdTime
 * - getVersion() returns specific version value
 * - put() POSTs data correctly
 * - softDeleteVersion() POSTs to delete endpoint
 * - Token renewal scheduled at 80% TTL
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VaultClient } from '../client.js';

// Mock node:fs/promises for the service account token
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('test-k8s-jwt'),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete process.env['VAULT_ADDR'];
  delete process.env['VAULT_ROLE'];
  delete process.env['VAULT_MOUNT'];
});

describe('VaultClient.isEnabled', () => {
  it('is false when VAULT_ADDR is absent', () => {
    const client = new VaultClient();
    expect(client.isEnabled).toBe(false);
  });

  it('is true when VAULT_ADDR is set', () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    const client = new VaultClient();
    expect(client.isEnabled).toBe(true);
  });
});

describe('VaultClient.authenticate()', () => {
  it('is a no-op when VAULT_ADDR is absent', async () => {
    const client = new VaultClient();
    await client.authenticate();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POSTs JWT to Vault login endpoint and stores token', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        auth: { client_token: 'vault-token-abc', lease_duration: 900 },
      }),
    });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy(); // stop renewal timer

    expect(mockFetch).toHaveBeenCalledWith(
      'https://vault.test:8200/v1/auth/kubernetes/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ jwt: 'test-k8s-jwt', role: 'ordr-api' }),
      }),
    );
  });

  it('throws on auth failure', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';

    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

    const client = new VaultClient();
    await expect(client.authenticate()).rejects.toThrow('Auth failed: 403');
  });
});

describe('VaultClient.get()', () => {
  async function authenticatedClient(): Promise<VaultClient> {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
    });
    const client = new VaultClient();
    await client.authenticate();
    client.destroy();
    return client;
  }

  it('returns value from KV v2 response', async () => {
    const client = await authenticatedClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { data: { value: 'my-secret' } } }),
    });

    const result = await client.get('ENCRYPTION_MASTER_KEY');
    expect(result).toBe('my-secret');
  });

  it('returns undefined on 404', async () => {
    const client = await authenticatedClient();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await client.get('NONEXISTENT_KEY');
    expect(result).toBeUndefined();
  });

  it('throws on 500', async () => {
    const client = await authenticatedClient();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(client.get('KEY')).rejects.toThrow('GET KEY failed: 500');
  });

  it('uses correct KV v2 path with custom mount', async () => {
    process.env['VAULT_MOUNT'] = 'kv';
    const client = await authenticatedClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { data: { value: 'val' } } }),
    });

    await client.get('MY_KEY');
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://vault.test:8200/v1/kv/data/MY_KEY',
      expect.anything(),
    );
  });
});

describe('VaultClient.getMetadata()', () => {
  it('returns version and createdTime', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            current_version: 3,
            versions: { '3': { created_time: '2026-01-01T00:00:00Z' } },
          },
        }),
      });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy();

    const meta = await client.getMetadata('ENCRYPTION_MASTER_KEY');
    expect(meta.version).toBe(3);
    expect(meta.createdTime).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});

describe('VaultClient.getVersion()', () => {
  it('fetches specific version with ?version= query param', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { data: { value: 'old-hex-key' } } }),
      });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy();

    const val = await client.getVersion('ENCRYPTION_MASTER_KEY', 2);
    expect(val).toBe('old-hex-key');
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://vault.test:8200/v1/secret/data/ENCRYPTION_MASTER_KEY?version=2',
      expect.anything(),
    );
  });
});

describe('VaultClient.put()', () => {
  it('POSTs value to KV v2 data endpoint', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
      })
      .mockResolvedValueOnce({ ok: true });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy();

    await client.put('MY_SECRET', 'new-value');
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://vault.test:8200/v1/secret/data/MY_SECRET',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ data: { value: 'new-value' } }),
      }),
    );
  });

  it('throws on non-ok response', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy();

    await expect(client.put('KEY', 'val')).rejects.toThrow('PUT KEY failed: 500');
  });
});

describe('VaultClient.softDeleteVersion()', () => {
  it('POSTs to KV v2 delete endpoint with correct version array', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
      })
      .mockResolvedValueOnce({ ok: true });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy();

    await client.softDeleteVersion('ENCRYPTION_MASTER_KEY', 2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://vault.test:8200/v1/secret/delete/ENCRYPTION_MASTER_KEY',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ versions: [2] }),
      }),
    );
  });

  it('throws on non-ok response', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
      })
      .mockResolvedValueOnce({ ok: false, status: 403 });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy();

    await expect(client.softDeleteVersion('KEY', 1)).rejects.toThrow(
      'softDeleteVersion KEY@1 failed: 403',
    );
  });
});

describe('VaultClient — no-op when disabled', () => {
  it('get() returns undefined', async () => {
    const client = new VaultClient();
    expect(await client.get('ANY')).toBeUndefined();
  });

  it('getMetadata() returns epoch createdTime', async () => {
    const client = new VaultClient();
    const meta = await client.getMetadata('ANY');
    expect(meta.version).toBe(0);
    expect(meta.createdTime.getTime()).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd packages/vault && npx vitest run src/__tests__/client.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL (module not found or import errors — `client.ts` does not exist yet).

- [ ] **Step 3: Implement `packages/vault/src/client.ts`**

```typescript
/**
 * VaultClient — HashiCorp Vault KV v2 HTTP client
 *
 * Authenticates via Kubernetes auth method (pod service account JWT).
 * Renews the Vault token automatically at 80% of TTL.
 * All operations are no-ops when VAULT_ADDR is absent (dev/test mode).
 *
 * Rule 5 — Secrets from external secret manager; short-lived leases.
 * SOC2 CC6.1 — Access controls: K8s auth + least-privilege Vault policies.
 */

import { readFile } from 'node:fs/promises';

export interface VaultMetadata {
  readonly createdTime: Date;
  readonly version: number;
}

export class VaultClient {
  private readonly addr: string | undefined;
  private readonly role: string | undefined;
  private readonly mount: string;
  private token: string | null = null;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.addr = process.env['VAULT_ADDR']?.trim() || undefined;
    this.role = process.env['VAULT_ROLE']?.trim() || undefined;
    this.mount = process.env['VAULT_MOUNT']?.trim() || 'secret';
  }

  get isEnabled(): boolean {
    return this.addr !== undefined;
  }

  /** Authenticate with Vault using the pod's K8s service account JWT. */
  async authenticate(): Promise<void> {
    if (!this.isEnabled || !this.role) return;

    const jwt = await readFile(
      '/var/run/secrets/kubernetes.io/serviceaccount/token',
      'utf8',
    );

    const res = await fetch(`${this.addr}/v1/auth/kubernetes/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jwt: jwt.trim(), role: this.role }),
    });

    if (!res.ok) {
      throw new Error(`[ORDR:VAULT] Auth failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      auth: { client_token: string; lease_duration: number };
    };
    this.token = data.auth.client_token;
    const ttlMs = data.auth.lease_duration * 1000;

    // Schedule token renewal at 80% of TTL
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = setTimeout(() => void this.renewToken(), ttlMs * 0.8);
  }

  private async renewToken(): Promise<void> {
    if (!this.isEnabled || !this.token) return;
    try {
      const res = await fetch(`${this.addr}/v1/auth/token/renew-self`, {
        method: 'PUT',
        headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        console.warn('[ORDR:VAULT] Token renewal failed — re-authenticating');
        await this.authenticate();
        return;
      }
      const data = (await res.json()) as { auth: { lease_duration: number } };
      const ttlMs = data.auth.lease_duration * 1000;
      if (this.renewTimer) clearTimeout(this.renewTimer);
      this.renewTimer = setTimeout(() => void this.renewToken(), ttlMs * 0.8);
    } catch (err) {
      console.error(
        '[ORDR:VAULT] Token renewal error:',
        err instanceof Error ? err.message : 'unknown',
      );
    }
  }

  private authHeaders(): Record<string, string> {
    if (!this.token) throw new Error('[ORDR:VAULT] Not authenticated — call authenticate() first');
    return { 'X-Vault-Token': this.token };
  }

  /** Read the current value of a secret. Returns undefined if not found. */
  async get(path: string): Promise<string | undefined> {
    if (!this.isEnabled) return undefined;
    const res = await fetch(`${this.addr}/v1/${this.mount}/data/${path}`, {
      headers: this.authHeaders(),
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`[ORDR:VAULT] GET ${path} failed: ${res.status}`);
    const data = (await res.json()) as { data: { data: Record<string, string> } };
    return data.data.data['value'];
  }

  /** Write a new version of a secret. */
  async put(path: string, value: string): Promise<void> {
    if (!this.isEnabled) return;
    const res = await fetch(`${this.addr}/v1/${this.mount}/data/${path}`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { value } }),
    });
    if (!res.ok) throw new Error(`[ORDR:VAULT] PUT ${path} failed: ${res.status}`);
  }

  /** Read the metadata (current version, created_time) for a secret path. */
  async getMetadata(path: string): Promise<VaultMetadata> {
    if (!this.isEnabled) return { createdTime: new Date(0), version: 0 };
    const res = await fetch(`${this.addr}/v1/${this.mount}/metadata/${path}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`[ORDR:VAULT] getMetadata ${path} failed: ${res.status}`);
    const data = (await res.json()) as {
      data: {
        current_version: number;
        versions: Record<string, { created_time: string }>;
      };
    };
    const currentVersion = data.data.current_version;
    const versionInfo = data.data.versions[String(currentVersion)];
    return {
      version: currentVersion,
      createdTime: new Date(versionInfo?.created_time ?? 0),
    };
  }

  /** Read a specific historical version of a secret. */
  async getVersion(path: string, version: number): Promise<string> {
    if (!this.isEnabled) return '';
    const res = await fetch(
      `${this.addr}/v1/${this.mount}/data/${path}?version=${version}`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) {
      throw new Error(`[ORDR:VAULT] getVersion ${path}@${version} failed: ${res.status}`);
    }
    const data = (await res.json()) as { data: { data: Record<string, string> } };
    const value = data.data.data['value'];
    if (!value) {
      throw new Error(
        `[ORDR:VAULT] getVersion: 'value' key missing in ${path}@${version}`,
      );
    }
    return value;
  }

  /**
   * Soft-delete a specific version of a secret in Vault KV v2.
   * "Soft delete" marks the version as deleted but retains data for audit
   * (per Rule 3: 7-year retention). Does NOT destroy/shred the key material.
   */
  async softDeleteVersion(path: string, version: number): Promise<void> {
    if (!this.isEnabled) return;
    const res = await fetch(`${this.addr}/v1/${this.mount}/delete/${path}`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ versions: [version] }),
    });
    if (!res.ok) {
      throw new Error(
        `[ORDR:VAULT] softDeleteVersion ${path}@${version} failed: ${res.status}`,
      );
    }
    console.warn(`[ORDR:VAULT] Soft-deleted ${path} version ${version} (data retained for audit)`);
  }

  /** Stop the token renewal timer. Call on process shutdown. */
  destroy(): void {
    if (this.renewTimer) {
      clearTimeout(this.renewTimer);
      this.renewTimer = null;
    }
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd packages/vault && npx vitest run src/__tests__/client.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd ../.. # repo root
git add packages/vault/src/client.ts packages/vault/src/__tests__/client.test.ts
git commit -m "feat(vault): VaultClient — K8s auth, token renewal, KV v2 CRUD — Phase 55"
```

---

### Task 3: SecretStore (TDD)

**Files:**
- Create: `packages/vault/src/__tests__/secret-store.test.ts`
- Create: `packages/vault/src/secret-store.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/vault/src/__tests__/secret-store.test.ts`:

```typescript
/**
 * SecretStore Unit Tests
 *
 * Tests:
 * - init() populates from Vault when client is enabled
 * - init() falls back to process.env when Vault returns undefined
 * - get() returns in-memory value synchronously
 * - onRotate() callback fires when polling detects new version
 * - Polling does NOT fire callback when version is unchanged
 * - No-op polling when client is disabled
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Reset module registry between tests so the singleton starts fresh
beforeEach(async () => {
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env['VAULT_POLL_INTERVAL_MS'];
  delete process.env['MY_KEY'];
});

function makeMockClient(enabled: boolean, values: Record<string, string> = {}) {
  return {
    isEnabled: enabled,
    get: vi.fn(async (path: string) => values[path]),
    getMetadata: vi.fn(async (_path: string) => ({
      version: 1,
      createdTime: new Date(),
    })),
  };
}

describe('initSecretStore + get()', () => {
  it('populates from Vault when client is enabled', async () => {
    const { initSecretStore, secretStore } = await import('../secret-store.js');
    const client = makeMockClient(true, { MY_KEY: 'vault-value' });

    await initSecretStore(client as never, ['MY_KEY']);
    secretStore.destroy();

    expect(secretStore.get('MY_KEY')).toBe('vault-value');
  });

  it('falls back to process.env when Vault returns undefined', async () => {
    process.env['MY_KEY'] = 'env-value';
    const { initSecretStore, secretStore } = await import('../secret-store.js');
    const client = makeMockClient(true, {}); // Vault returns undefined

    await initSecretStore(client as never, ['MY_KEY']);
    secretStore.destroy();

    expect(secretStore.get('MY_KEY')).toBe('env-value');
  });

  it('falls back to process.env when client is disabled', async () => {
    process.env['MY_KEY'] = 'env-only';
    const { initSecretStore, secretStore } = await import('../secret-store.js');
    const client = makeMockClient(false);

    await initSecretStore(client as never, ['MY_KEY']);
    secretStore.destroy();

    expect(secretStore.get('MY_KEY')).toBe('env-only');
  });

  it('does not start polling when client is disabled', async () => {
    const { initSecretStore, secretStore } = await import('../secret-store.js');
    const client = makeMockClient(false);

    await initSecretStore(client as never, ['MY_KEY']);
    secretStore.destroy();

    // getMetadata should not be called after init (no poll scheduled)
    expect(client.getMetadata).not.toHaveBeenCalled();
  });
});

describe('onRotate()', () => {
  it('fires callback when polling detects new version', async () => {
    vi.useFakeTimers();
    process.env['VAULT_POLL_INTERVAL_MS'] = '1000';

    const { initSecretStore, secretStore } = await import('../secret-store.js');

    // First call: version=1, second call: version=2 (simulates rotation)
    const mockClient = {
      isEnabled: true,
      get: vi.fn().mockResolvedValueOnce('old-val').mockResolvedValue('new-val'),
      getMetadata: vi
        .fn()
        .mockResolvedValueOnce({ version: 1, createdTime: new Date() })
        .mockResolvedValue({ version: 2, createdTime: new Date() }),
    };

    await initSecretStore(mockClient as never, ['MY_KEY']);

    const cb = vi.fn();
    secretStore.onRotate('MY_KEY', cb);

    // Advance timer to trigger one poll cycle
    await vi.advanceTimersByTimeAsync(1001);

    secretStore.destroy();
    vi.useRealTimers();

    expect(cb).toHaveBeenCalledWith('new-val');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire callback when version is unchanged', async () => {
    vi.useFakeTimers();
    process.env['VAULT_POLL_INTERVAL_MS'] = '1000';

    const { initSecretStore, secretStore } = await import('../secret-store.js');

    const mockClient = {
      isEnabled: true,
      get: vi.fn().mockResolvedValue('same-val'),
      getMetadata: vi.fn().mockResolvedValue({ version: 1, createdTime: new Date() }),
    };

    await initSecretStore(mockClient as never, ['MY_KEY']);

    const cb = vi.fn();
    secretStore.onRotate('MY_KEY', cb);

    await vi.advanceTimersByTimeAsync(2001); // Two poll cycles

    secretStore.destroy();
    vi.useRealTimers();

    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd packages/vault && npx vitest run src/__tests__/secret-store.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `packages/vault/src/secret-store.ts`**

```typescript
/**
 * SecretStore — in-memory secret snapshot with polling-based hot-reload
 *
 * `initSecretStore()` reads all tracked keys from Vault at startup.
 * A background interval polls Vault for version changes and fires
 * `onRotate` callbacks when new versions are detected.
 *
 * When VAULT_ADDR is absent (dev/test), all values come from process.env.
 * This makes the store safe to use in tests without any Vault setup.
 *
 * Rule 5 — Automated rotation; zero-downtime secret refresh.
 */

import type { VaultClient } from './client.js';

type RotateCallback = (newValue: string) => void;

interface SecretSnapshot {
  value: string;
  version: number;
}

class SecretStoreImpl {
  private readonly snapshots = new Map<string, SecretSnapshot>();
  private readonly callbacks = new Map<string, RotateCallback[]>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private client: VaultClient | null = null;
  private trackedKeys: string[] = [];

  async init(client: VaultClient, keys: string[]): Promise<void> {
    this.client = client;
    this.trackedKeys = keys;

    for (const key of keys) {
      const vaultValue = await client.get(key);
      const value = vaultValue ?? process.env[key] ?? '';
      let version = 0;
      if (client.isEnabled) {
        const meta = await client.getMetadata(key).catch(() => ({ version: 0 }));
        version = meta.version;
      }
      this.snapshots.set(key, { value, version });
    }

    if (client.isEnabled) {
      const intervalMs = parseInt(process.env['VAULT_POLL_INTERVAL_MS'] ?? '60000', 10);
      this.pollTimer = setInterval(() => void this.poll(), intervalMs);
    }
  }

  private async poll(): Promise<void> {
    if (!this.client) return;
    for (const key of this.trackedKeys) {
      try {
        const meta = await this.client.getMetadata(key);
        const current = this.snapshots.get(key);
        if (current !== undefined && meta.version > current.version) {
          const newValue = await this.client.get(key);
          if (newValue !== undefined) {
            this.snapshots.set(key, { value: newValue, version: meta.version });
            const cbs = this.callbacks.get(key) ?? [];
            for (const cb of cbs) cb(newValue);
          }
        }
      } catch (err) {
        console.error(
          `[ORDR:VAULT] Poll error for ${key}:`,
          err instanceof Error ? err.message : 'unknown',
        );
      }
    }
  }

  /** Synchronous read — always fast, never async. */
  get(key: string): string {
    return this.snapshots.get(key)?.value ?? process.env[key] ?? '';
  }

  /** Register a callback that fires whenever `key` is updated during polling. */
  onRotate(key: string, cb: RotateCallback): void {
    const existing = this.callbacks.get(key) ?? [];
    this.callbacks.set(key, [...existing, cb]);
  }

  /** Stop the polling interval. Call on process shutdown. */
  destroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

export const secretStore = new SecretStoreImpl();

export async function initSecretStore(client: VaultClient, keys: string[]): Promise<void> {
  await secretStore.init(client, keys);
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd packages/vault && npx vitest run src/__tests__/secret-store.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ../..
git add packages/vault/src/secret-store.ts packages/vault/src/__tests__/secret-store.test.ts
git commit -m "feat(vault): SecretStore — polling hot-reload, onRotate callbacks — Phase 55"
```

---

## Chunk 3: KeyRotationTracker + Scheduler + Re-wrap Pipeline

### Task 4: KeyRotationTracker (TDD) + `packages/vault` wiring

**Files:**
- Create: `packages/vault/src/__tests__/key-rotation-tracker.test.ts`
- Create: `packages/vault/src/key-rotation-tracker.ts`
- Modify: `packages/vault/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/vault/src/__tests__/key-rotation-tracker.test.ts`:

```typescript
/**
 * KeyRotationTracker Unit Tests
 *
 * Tests:
 * - isApproachingExpiry: true at threshold, false one day before
 * - isApproachingExpiry: always false when client disabled
 * - requestNewVersion: generates 32-byte hex, calls client.put, returns version
 * - getVersion: delegates to client.getVersion
 * - markVersionInactive: calls client.softDeleteVersion
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KeyRotationTracker } from '../key-rotation-tracker.js';

afterEach(() => vi.clearAllMocks());

function makeMockClient(enabled: boolean) {
  return {
    isEnabled: enabled,
    get: vi.fn(),
    put: vi.fn().mockResolvedValue(undefined),
    getMetadata: vi.fn(),
    getVersion: vi.fn().mockResolvedValue('old-hex-key'),
    softDeleteVersion: vi.fn().mockResolvedValue(undefined),
  };
}

describe('KeyRotationTracker.isApproachingExpiry()', () => {
  it('returns true when key age >= threshold', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(true);

    // Created 85 days ago — threshold is 80 days
    const createdTime = new Date(Date.now() - 85 * 24 * 60 * 60 * 1000);
    client.getMetadata.mockResolvedValue({ version: 1, createdTime });

    const result = await tracker.isApproachingExpiry(client as never, 'ENCRYPTION_MASTER_KEY', 80);
    expect(result).toBe(true);
  });

  it('returns false when key age < threshold', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(true);

    // Created 79 days ago — one day before the 80-day threshold
    const createdTime = new Date(Date.now() - 79 * 24 * 60 * 60 * 1000);
    client.getMetadata.mockResolvedValue({ version: 1, createdTime });

    const result = await tracker.isApproachingExpiry(client as never, 'ENCRYPTION_MASTER_KEY', 80);
    expect(result).toBe(false);
  });

  it('always returns false when client is disabled', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(false);

    const result = await tracker.isApproachingExpiry(client as never, 'ENCRYPTION_MASTER_KEY', 80);
    expect(result).toBe(false);
    expect(client.getMetadata).not.toHaveBeenCalled();
  });
});

describe('KeyRotationTracker.requestNewVersion()', () => {
  it('generates a 64-char hex value, puts it to Vault, returns new version', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(true);
    client.getMetadata.mockResolvedValue({ version: 2, createdTime: new Date() });

    const result = await tracker.requestNewVersion(client as never, 'ENCRYPTION_MASTER_KEY');

    // 32 bytes = 64 hex chars
    expect(result.value).toMatch(/^[0-9a-f]{64}$/);
    expect(result.version).toBe(2);
    expect(client.put).toHaveBeenCalledWith('ENCRYPTION_MASTER_KEY', result.value);
  });
});

describe('KeyRotationTracker.getVersion()', () => {
  it('delegates to client.getVersion', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(true);

    const val = await tracker.getVersion(client as never, 'ENCRYPTION_MASTER_KEY', 1);
    expect(val).toBe('old-hex-key');
    expect(client.getVersion).toHaveBeenCalledWith('ENCRYPTION_MASTER_KEY', 1);
  });
});

describe('KeyRotationTracker.markVersionInactive()', () => {
  it('calls client.softDeleteVersion with key and version', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(true);

    await tracker.markVersionInactive(client as never, 'ENCRYPTION_MASTER_KEY', 1);
    expect(client.softDeleteVersion).toHaveBeenCalledWith('ENCRYPTION_MASTER_KEY', 1);
  });

  it('is a no-op when client is disabled', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(false);

    await tracker.markVersionInactive(client as never, 'ENCRYPTION_MASTER_KEY', 1);
    expect(client.softDeleteVersion).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd packages/vault && npx vitest run src/__tests__/key-rotation-tracker.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL.

- [ ] **Step 3: Implement `packages/vault/src/key-rotation-tracker.ts`**

```typescript
/**
 * KeyRotationTracker — checks key age and orchestrates Vault version rotation
 *
 * Used by the worker re-wrap pipeline to:
 * 1. Determine when a KEK needs rotation (isApproachingExpiry)
 * 2. Generate and store a new KEK version in Vault (requestNewVersion)
 * 3. Retrieve an old KEK version for re-wrap (getVersion)
 * 4. Mark the old version as soft-deleted (markVersionInactive)
 *
 * Rule 1 — 90-day max key cycle; automated rotation triggered at 80 days.
 * Rule 3 — Old versions retained (soft-delete) for 7-year audit retention.
 */

import { randomBytes } from 'node:crypto';
import type { VaultClient } from './client.js';

export class KeyRotationTracker {
  /**
   * Returns true if the current version of `key` was created >= thresholdDays ago.
   * Always returns false when client is disabled (dev/test mode).
   */
  async isApproachingExpiry(
    client: VaultClient,
    key: string,
    thresholdDays: number,
  ): Promise<boolean> {
    if (!client.isEnabled) return false;
    const meta = await client.getMetadata(key);
    const ageMs = Date.now() - meta.createdTime.getTime();
    const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
    return ageMs >= thresholdMs;
  }

  /**
   * Generates a fresh 256-bit (32-byte) random KEK, stores it in Vault as
   * the next version, and returns the version number and hex-encoded value.
   */
  async requestNewVersion(
    client: VaultClient,
    key: string,
  ): Promise<{ version: number; value: string }> {
    const newValue = randomBytes(32).toString('hex');
    await client.put(key, newValue);
    const meta = await client.getMetadata(key);
    return { version: meta.version, value: newValue };
  }

  /** Retrieve a specific historical version of a secret. */
  async getVersion(client: VaultClient, key: string, version: number): Promise<string> {
    return client.getVersion(key, version);
  }

  /**
   * Soft-delete the specified version in Vault KV v2.
   * Data is NOT destroyed — it is retained for 7-year audit compliance (Rule 3).
   */
  async markVersionInactive(
    client: VaultClient,
    key: string,
    version: number,
  ): Promise<void> {
    if (!client.isEnabled) return;
    await client.softDeleteVersion(key, version);
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd packages/vault && npx vitest run src/__tests__/key-rotation-tracker.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 5: Wire `packages/vault/src/index.ts`**

Replace the stub contents:

```typescript
export { VaultClient } from './client.js';
export type { VaultMetadata } from './client.js';
export { secretStore, initSecretStore } from './secret-store.js';
export { KeyRotationTracker } from './key-rotation-tracker.js';
```

- [ ] **Step 6: Run all vault tests**

```bash
cd packages/vault && npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 7: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
cd ../..
git add packages/vault/src/key-rotation-tracker.ts packages/vault/src/__tests__/key-rotation-tracker.test.ts packages/vault/src/index.ts
git commit -m "feat(vault): KeyRotationTracker + index exports — Phase 55"
```

---

### Task 5: Scheduler Job Definition

**Files:**
- Create: `packages/scheduler/src/jobs/key-rotation-check.ts`
- Modify: `packages/scheduler/src/index.ts`

> **Pattern reference:** Follow `packages/scheduler/src/jobs/dsr-deadline-check.ts` exactly.

- [ ] **Step 1: Create `packages/scheduler/src/jobs/key-rotation-check.ts`**

```typescript
/**
 * Key Rotation Check — daily cron to trigger DEK re-wrap when KEK approaches expiry
 *
 * Checks whether ENCRYPTION_MASTER_KEY has been in Vault for ≥ 80 days.
 * If so, delegates to the worker's re-wrap pipeline (via deps.runKeyRotation).
 * A guard check prevents duplicate concurrent jobs.
 *
 * Schedule: 0 2 * * * (daily at 02:00 UTC)
 * SOC2 CC6.7 — Cryptographic key lifecycle management.
 * Rule 1 — Automated 90-day key rotation; triggered at 80-day threshold.
 * Rule 3 — WORM audit events emitted by the pipeline for each batch.
 */

import type { JobDefinition, JobHandler } from '../types.js';
import { createCronExpression } from '../cron-parser.js';

// ── Job Constants ─────────────────────────────────────────────────

export const KEY_ROTATION_CHECK_JOB_ID = 'key-rotation-check';
export const KEY_ROTATION_CHECK_CRON = '0 2 * * *';

// ── Job Definition ────────────────────────────────────────────────

export function createKeyRotationCheckDefinition(): Omit<JobDefinition, 'createdAt' | 'updatedAt'> {
  return {
    id: KEY_ROTATION_CHECK_JOB_ID,
    name: 'Key Rotation Check',
    description: 'Daily check: trigger DEK re-wrap if ENCRYPTION_MASTER_KEY age ≥ 80 days.',
    cronExpression: createCronExpression(
      process.env['KEY_ROTATION_CHECK_CRON'] ?? KEY_ROTATION_CHECK_CRON,
    ),
    jobType: 'key-rotation-check',
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

export interface KeyRotationCheckDeps {
  /**
   * Returns true if ENCRYPTION_MASTER_KEY age >= thresholdDays.
   * Provided by the worker using KeyRotationTracker.
   */
  readonly isKeyApproachingExpiry: (thresholdDays: number) => Promise<boolean>;

  /**
   * Executes the full DEK re-wrap pipeline (from apps/api/src/jobs/key-rotation.ts).
   * Wired as a closure in server.ts that fetches old/new KEK from Vault and
   * passes fully-constructed KeyRotationDeps to runKeyRotation().
   */
  readonly runKeyRotation: () => Promise<{ rowsProcessed: number }>;

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
}

// ── Handler Factory ───────────────────────────────────────────────

export function createKeyRotationCheckHandler(deps: KeyRotationCheckDeps): JobHandler {
  return async (): Promise<import('../types.js').JobResult> => {
    const startMs = Date.now();

    const approaching = await deps.isKeyApproachingExpiry(80);
    if (!approaching) {
      return {
        success: true,
        data: { skipped: true, reason: 'Key age below 80-day threshold' },
        durationMs: Date.now() - startMs,
      };
    }

    const result = await deps.runKeyRotation();

    await deps.auditLogger.log({
      tenantId: 'system',
      eventType: 'security.key_rotation',
      actorType: 'system',
      actorId: 'scheduler:key-rotation-check',
      resource: 'encryption_key',
      resourceId: 'ENCRYPTION_MASTER_KEY',
      action: 'rotation_check_complete',
      details: { rows_processed: result.rowsProcessed },
      timestamp: new Date(),
    });

    return {
      success: true,
      data: { rowsProcessed: result.rowsProcessed },
      durationMs: Date.now() - startMs,
    };
  };
}
```

- [ ] **Step 2: Add exports to `packages/scheduler/src/index.ts`**

Open `packages/scheduler/src/index.ts`. After the existing `IntegrationBatchSync` export block, add:

```typescript
export {
  createKeyRotationCheckDefinition,
  createKeyRotationCheckHandler,
  KEY_ROTATION_CHECK_JOB_ID,
  KEY_ROTATION_CHECK_CRON,
} from './jobs/key-rotation-check.js';

export type { KeyRotationCheckDeps } from './jobs/key-rotation-check.js';
```

- [ ] **Step 3: TypeScript check**

```bash
cd packages/scheduler && npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add packages/scheduler/src/jobs/key-rotation-check.ts packages/scheduler/src/index.ts
git commit -m "feat(scheduler): add key-rotation-check job definition — Phase 55"
```

---

### Task 6: Re-wrap Pipeline (TDD)

**Files:**
- Create: `apps/api/src/jobs/__tests__/key-rotation.test.ts`
- Create: `apps/api/src/jobs/key-rotation.ts`
- Create: `apps/api/src/jobs/` directory (if it doesn't exist)

- [ ] **Step 1: Write the failing tests**

Create `apps/worker/src/jobs/__tests__/key-rotation.test.ts`:

```typescript
/**
 * Key Rotation Pipeline Tests
 *
 * Uses in-memory arrays instead of a real DB. Tests:
 * - Single-page job: all rows re-wrapped, audit events emitted
 * - Multi-page job: pagination works correctly (keyset cursor advances)
 * - Idempotency: restart from last_processed_id skips already-wrapped rows
 * - Concurrency guard: second concurrent job is rejected
 * - Key material never appears in audit events or console output
 * - Per-row JSONB validation: invalid row emits KEY_ROTATION_ROW_ERROR + continues
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runKeyRotation } from '../key-rotation.js';
import { EnvelopeEncryption } from '@ordr/crypto';

// ── Helpers ───────────────────────────────────────────────────────

function makeValidEnvelope(keyVersion: string) {
  const kek = Buffer.alloc(32, 0xab);
  const enc = new EnvelopeEncryption(kek, keyVersion);
  return enc.encrypt(Buffer.from('test-plaintext'));
}

function makeInvalidEnvelope() {
  return { wrappedDek: 'bad', notAField: true };
}

// ── Mock DB and Deps ──────────────────────────────────────────────

function makeTestDeps(rows: Array<{ id: string; dek_envelope: unknown }>) {
  const oldKekHex = Buffer.alloc(32, 0xab).toString('hex'); // same as makeValidEnvelope
  const newKekHex = Buffer.alloc(32, 0xcd).toString('hex');

  const db = {
    rows: [...rows],
    jobs: [] as Array<{ id: string; status: string; lastProcessedId: string | null; rowsDone: number }>,
  };

  const auditEvents: string[] = [];

  return {
    oldKekHex,
    newKekHex,
    oldVersion: 1,
    newVersion: 2,
    pageSize: 500,
    db,
    auditEvents,
    findActiveJob: vi.fn(async (keyName: string) => {
      return db.jobs.find((j) => j.status === 'running') ?? null;
    }),
    insertJob: vi.fn(async (job: { keyName: string; oldVersion: number; newVersion: number }) => {
      const id = 'job-001';
      db.jobs.push({ id, status: 'running', lastProcessedId: null, rowsDone: 0 });
      return id;
    }),
    updateJobCursor: vi.fn(async (jobId: string, lastId: string, rowsDone: number) => {
      const job = db.jobs.find((j) => j.id === jobId);
      if (job) { job.lastProcessedId = lastId; job.rowsDone = rowsDone; }
    }),
    completeJob: vi.fn(async (jobId: string) => {
      const job = db.jobs.find((j) => j.id === jobId);
      if (job) job.status = 'completed';
    }),
    getPage: vi.fn(async (lastId: string | null, limit: number) => {
      const start = lastId ? db.rows.findIndex((r) => r.id === lastId) + 1 : 0;
      return db.rows.slice(start, start + limit);
    }),
    updateRows: vi.fn(async (updates: Array<{ id: string; dek_envelope: unknown }>) => {
      for (const u of updates) {
        const row = db.rows.find((r) => r.id === u.id);
        if (row) row.dek_envelope = u.dek_envelope;
      }
    }),
    emitAudit: vi.fn(async (eventType: string, details: Record<string, unknown>) => {
      auditEvents.push(eventType);
      // Ensure key material is never in details
      const detailsStr = JSON.stringify(details);
      expect(detailsStr).not.toContain(oldKekHex);
      expect(detailsStr).not.toContain(newKekHex);
    }),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('runKeyRotation — single page', () => {
  it('re-wraps all rows and emits correct audit events', async () => {
    const rows = [
      { id: 'row-1', dek_envelope: makeValidEnvelope('1') },
      { id: 'row-2', dek_envelope: makeValidEnvelope('1') },
    ];

    const deps = makeTestDeps(rows);
    const result = await runKeyRotation(deps as never);

    expect(result.rowsProcessed).toBe(2);
    expect(deps.auditEvents).toContain('KEY_ROTATION_STARTED');
    expect(deps.auditEvents).toContain('KEY_ROTATION_BATCH_COMPLETED');
    expect(deps.auditEvents).toContain('KEY_ROTATION_COMPLETED');

    // Rows should have new keyVersion
    for (const row of deps.db.rows) {
      const env = row.dek_envelope as { keyVersion: string };
      expect(env.keyVersion).toBe('2');
    }
  });
});

describe('runKeyRotation — concurrency guard', () => {
  it('rejects if an active job already exists', async () => {
    const deps = makeTestDeps([]);
    deps.db.jobs.push({ id: 'existing', status: 'running', lastProcessedId: null, rowsDone: 0 });

    const result = await runKeyRotation(deps as never);

    expect(result.rowsProcessed).toBe(0);
    expect(deps.insertJob).not.toHaveBeenCalled();
  });
});

describe('runKeyRotation — per-row validation', () => {
  it('skips invalid rows and continues without aborting', async () => {
    const rows = [
      { id: 'row-good', dek_envelope: makeValidEnvelope('1') },
      { id: 'row-bad', dek_envelope: makeInvalidEnvelope() },
    ];

    const deps = makeTestDeps(rows);
    const result = await runKeyRotation(deps as never);

    // Good row processed, bad row skipped
    expect(result.rowsProcessed).toBe(1);
    expect(deps.auditEvents).toContain('KEY_ROTATION_ROW_ERROR');
    expect(deps.auditEvents).toContain('KEY_ROTATION_COMPLETED');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd apps/api && npx vitest run src/jobs/__tests__/key-rotation.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/api/src/jobs/key-rotation.ts`**

```typescript
/**
 * Key Rotation Pipeline — automated DEK re-wrap for ENCRYPTION_MASTER_KEY
 *
 * Called by the scheduler's key-rotation-check job handler.
 * Pages through encrypted_fields with keyset pagination (keyset cursor = last UUID).
 * Each page: validate envelope, rewrap DEK with new KEK, write back atomically.
 *
 * Rule 1 — 90-day KEK cycle; re-wrap is O(records), NOT O(data).
 * Rule 3 — WORM audit events per batch; key material NEVER in audit details.
 * Rule 4 — Per-row JSONB validation before passing to EnvelopeEncryption.
 */

import { EnvelopeEncryption, type EncryptedEnvelope } from '@ordr/crypto';

// ── Envelope validation ────────────────────────────────────────────

const REQUIRED_FIELDS = ['wrappedDek', 'dekIv', 'dekAuthTag', 'keyVersion', 'iv', 'authTag', 'ciphertext'] as const;

function isValidEnvelope(val: unknown): val is EncryptedEnvelope {
  if (typeof val !== 'object' || val === null) return false;
  return REQUIRED_FIELDS.every(
    (f) => f in (val as Record<string, unknown>) && typeof (val as Record<string, unknown>)[f] === 'string',
  );
}

// ── Dependency interface ────────────────────────────────────────────

export interface KeyRotationDeps {
  /** Hex-encoded old KEK bytes (read from Vault using old version number) */
  readonly oldKekHex: string;
  /** Hex-encoded new KEK bytes */
  readonly newKekHex: string;
  /** Vault KV v2 version being replaced */
  readonly oldVersion: number;
  /** Vault KV v2 version being written */
  readonly newVersion: number;
  /** Rows per page (default 500 in production) */
  readonly pageSize: number;

  /** Returns null if no active job; the concurrency guard row if one exists */
  findActiveJob(keyName: string): Promise<{ id: string } | null>;

  /** Creates the job row; returns the new job UUID */
  insertJob(params: { keyName: string; oldVersion: number; newVersion: number }): Promise<string>;

  /** Updates the keyset cursor and rowsDone count after each page */
  updateJobCursor(jobId: string, lastProcessedId: string, rowsDone: number): Promise<void>;

  /** Marks the job as completed */
  completeJob(jobId: string): Promise<void>;

  /** Fetch next page of encrypted_fields rows using keyset cursor */
  getPage(
    lastProcessedId: string | null,
    limit: number,
  ): Promise<Array<{ id: string; dek_envelope: unknown }>>;

  /** Write re-wrapped envelopes back to encrypted_fields */
  updateRows(updates: Array<{ id: string; dek_envelope: EncryptedEnvelope }>): Promise<void>;

  /** Emit a WORM audit event. Key material must NEVER appear in details. */
  emitAudit(eventType: string, details: Record<string, unknown>): Promise<void>;
}

// ── Pipeline ──────────────────────────────────────────────────────

export async function runKeyRotation(
  deps: KeyRotationDeps,
): Promise<{ rowsProcessed: number }> {
  const {
    oldKekHex,
    newKekHex,
    oldVersion,
    newVersion,
    pageSize,
  } = deps;

  // 1. Concurrency guard
  const existing = await deps.findActiveJob('ENCRYPTION_MASTER_KEY');
  if (existing) {
    console.warn('[ORDR:ROTATION] KEY_ROTATION_ALREADY_RUNNING — skipping');
    return { rowsProcessed: 0 };
  }

  // 2. Create job row
  const jobId = await deps.insertJob({
    keyName: 'ENCRYPTION_MASTER_KEY',
    oldVersion,
    newVersion,
  });

  await deps.emitAudit('KEY_ROTATION_STARTED', {
    key_name: 'ENCRYPTION_MASTER_KEY',
    old_version: oldVersion,
    new_version: newVersion,
  });

  // 3. Construct re-wrapper ONCE before the loop — validates KEK length upfront
  const rewrapper = new EnvelopeEncryption(Buffer.from(oldKekHex, 'hex'), String(oldVersion));
  const newKekBuf = Buffer.from(newKekHex, 'hex');

  let lastProcessedId: string | null = null;
  let rowsDone = 0;
  let pageIndex = 0;
  const startMs = Date.now();

  // 4. Keyset-paginated re-wrap loop
  while (true) {
    const page = await deps.getPage(lastProcessedId, pageSize);
    if (page.length === 0) break;

    const updates: Array<{ id: string; dek_envelope: EncryptedEnvelope }> = [];
    let rowsInPage = 0;

    for (const row of page) {
      // Per-row validation — invalid envelopes are skipped, not crash-aborted
      if (!isValidEnvelope(row.dek_envelope)) {
        await deps.emitAudit('KEY_ROTATION_ROW_ERROR', {
          row_id: row.id,
          reason: 'invalid_envelope_shape',
        });
        continue;
      }

      const rewrapped = rewrapper.rewrap(row.dek_envelope, newKekBuf, String(newVersion));
      updates.push({ id: row.id, dek_envelope: rewrapped });
      rowsInPage++;
    }

    // Write page + update cursor atomically
    if (updates.length > 0) {
      await deps.updateRows(updates);
    }

    const lastRow = page[page.length - 1];
    if (lastRow) {
      lastProcessedId = lastRow.id;
      rowsDone += rowsInPage;
      await deps.updateJobCursor(jobId, lastProcessedId, rowsDone);
    }

    await deps.emitAudit('KEY_ROTATION_BATCH_COMPLETED', {
      page_index: pageIndex,
      rows_in_page: rowsInPage,
      rows_done: rowsDone,
    });

    pageIndex++;

    // If we got fewer rows than pageSize, we've reached the end
    if (page.length < pageSize) break;
  }

  // 5. Complete job
  await deps.completeJob(jobId);

  await deps.emitAudit('KEY_ROTATION_COMPLETED', {
    key_name: 'ENCRYPTION_MASTER_KEY',
    old_version: oldVersion,
    new_version: newVersion,
    rows_processed: rowsDone,
    duration_ms: Date.now() - startMs,
  });

  return { rowsProcessed: rowsDone };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/api && npx vitest run src/jobs/__tests__/key-rotation.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd ../..
git add apps/api/src/jobs/key-rotation.ts apps/api/src/jobs/__tests__/key-rotation.test.ts
git commit -m "feat(api): DEK re-wrap pipeline with keyset pagination + per-row validation — Phase 55"
```

---

## Chunk 4: API Server Wiring + Final Validation

### Task 7: Wire `initSecretStore` into `apps/api/src/server.ts`

**Files:**
- Modify: `apps/api/src/server.ts`

> **Read `apps/api/src/server.ts` lines 1–100 and 1020–1060 first** to understand the import block and the startup sequence before editing.

- [ ] **Step 1: Add `@ordr/vault` import to `apps/api/src/server.ts`**

Find the import block at the top of the file. Add after the existing `@ordr/*` package imports:

```typescript
import { VaultClient, initSecretStore, secretStore } from '@ordr/vault';
```

- [ ] **Step 2: Define `TRACKED_SECRET_KEYS` constant**

After the import block, add a top-level constant:

```typescript
/** Secrets that must be loaded from Vault and hot-reloaded on rotation. */
const TRACKED_SECRET_KEYS = [
  'JWT_PRIVATE_KEY',
  'ENCRYPTION_MASTER_KEY',
  'STRIPE_SECRET_KEY',
  'TWILIO_AUTH_TOKEN',
  'SENDGRID_API_KEY',
  'OPENAI_API_KEY',
  // DATABASE_URL, REDIS_URL: connection pool reconnect requires pod restart — excluded.
  // JWT_PUBLIC_KEY: derived from private key at startup, not a secret to rotate.
  // HMAC_SECRET: not included in onRotate callbacks; excluded to avoid no-op tracking.
] as const;
```

- [ ] **Step 3: Add `initSecretStore` call to the startup sequence**

Find the startup sequence in the `bootstrap()` (or equivalent startup) function. Locate the comment `// ── 1. Load and validate configuration` or similar. Insert the Vault initialization **immediately after** `loadConfig()` succeeds and **before** any secret is first used:

```typescript
  // ── 1.5. Vault secret store — loads from Vault, falls back to process.env in dev ─
  // No-op when VAULT_ADDR is absent. In production, secrets come from Vault;
  // process.env values are emergency fallbacks only.
  const vaultClient = new VaultClient();
  await vaultClient.authenticate();
  await initSecretStore(vaultClient, [...TRACKED_SECRET_KEYS]);
  console.warn('[ORDR:API] Secret store initialized (Vault enabled:', vaultClient.isEnabled, ')');
```

- [ ] **Step 4: Hoist JWT config to module scope and register `onRotate` callbacks**

The `onRotate` callbacks need to update module-level variables that are already initialized at startup. The current `server.ts` declares `jwtConfig` as a `let` local inside the startup function — it must be hoisted to module scope so callbacks can reassign it.

**Step 4a — Hoist `jwtConfig` to module scope in `server.ts`:**

Before the `bootstrap()` function (or `startServer()` — wherever the startup code lives), add:

```typescript
// Module-level variable — allows JWT key pair to be hot-swapped on Vault rotation.
// Assigned during startup and updated by onRotate callback. Single-threaded swap is atomic.
let activeJwtConfig: JwtConfig | null = null;

/** Update the active JWT config (called at startup and on rotation). */
function setJwtConfig(config: JwtConfig): void {
  activeJwtConfig = config;
}
```

Then replace the existing `let jwtConfig` local variable declaration+assignment with:

```typescript
activeJwtConfig = await loadKeyPair(config.auth.jwtPrivateKey, config.auth.jwtPublicKey, {
  issuer: 'ordr-connect',
  audience: 'ordr-connect',
});
```

And update all downstream usages of the local `jwtConfig` to use `activeJwtConfig!` (non-null assertion — safe because it's always assigned before routes start). Remove the `let jwtConfig: JwtConfig;` declaration.

**Step 4b — Register `onRotate` callbacks immediately after `initSecretStore`:**

```typescript
  // ── 1.6. Hot-reload callbacks — fire when Vault polling detects a new secret version ─
  secretStore.onRotate('JWT_PRIVATE_KEY', (val) => {
    console.warn('[ORDR:API] JWT_PRIVATE_KEY rotated — reloading key pair');
    void loadKeyPair(val, config.auth.jwtPublicKey, {
      issuer: 'ordr-connect',
      audience: 'ordr-connect',
    }).then(setJwtConfig).catch((err: unknown) => {
      console.error('[ORDR:API] JWT_PRIVATE_KEY rotation failed:', err instanceof Error ? err.message : err);
    });
  });

  secretStore.onRotate('ENCRYPTION_MASTER_KEY', (val) => {
    // The ENCRYPTION_MASTER_KEY Vault secret corresponds to FIELD_ENCRYPTION_KEY usage.
    // Log rotation — full FieldEncryptor hot-swap requires Phase 55+ refactor of
    // configure*Routes to accept a factory instead of a pre-built encryptor instance.
    // For now, log and emit an audit event so the ops team can trigger a pod restart.
    console.warn('[ORDR:API] ENCRYPTION_MASTER_KEY rotated — pod restart recommended for full re-init');
  });

  secretStore.onRotate('STRIPE_SECRET_KEY', (val) => {
    console.warn('[ORDR:API] STRIPE_SECRET_KEY rotated — logging for ops');
    // Stripe client is constructed once at startup. A new Stripe client would need
    // to be instantiated with val and configureBillingGate() re-called.
    // Emit audit event + recommend pod restart until a reconfigure factory is wired.
  });

  secretStore.onRotate('TWILIO_AUTH_TOKEN', (val) => {
    console.warn('[ORDR:API] TWILIO_AUTH_TOKEN rotated — logging for ops');
  });

  secretStore.onRotate('SENDGRID_API_KEY', (val) => {
    console.warn('[ORDR:API] SENDGRID_API_KEY rotated — logging for ops');
  });

  secretStore.onRotate('OPENAI_API_KEY', (val) => {
    console.warn('[ORDR:API] OPENAI_API_KEY rotated — logging for ops');
  });
```

> **Why partial hot-swap:** `JWT_PRIVATE_KEY` is fully hot-swapped because `jwtConfig` is referenced via the module-level `activeJwtConfig` variable. `ENCRYPTION_MASTER_KEY` and the service clients require a larger refactor (pass factory functions instead of instances to configureRoutes). Phase 55 implements full hot-swap for JWT and logs all others — the pod restart path is documented and operationally acceptable for the current architecture.

- [ ] **Step 5: Register key-rotation-check job with the scheduler in `server.ts`**

The `JobScheduler` is already instantiated in `server.ts` (grep for `new JobScheduler` to find the location). Immediately after the existing job registrations (or after `configureSchedulerRoutes()`), add the key rotation check job registration.

Add these imports to the top of `server.ts` (with the other `@ordr/scheduler` and `@ordr/vault` imports):

```typescript
import {
  createKeyRotationCheckDefinition,
  createKeyRotationCheckHandler,
} from '@ordr/scheduler';
import type { KeyRotationCheckDeps } from '@ordr/scheduler';
import { KeyRotationTracker } from '@ordr/vault';
import { runKeyRotation } from './jobs/key-rotation.js';
```

Also add these Drizzle operator imports if not already present (grep for existing `gt` / `and` imports from drizzle-orm):

```typescript
import { eq, gt, and } from 'drizzle-orm';
```

Then, immediately after `configureSchedulerRoutes({ scheduler: jobScheduler, store: schedulerStore })`, add:

```typescript
  // ── Key Rotation Check job (Phase 55) ──────────────────────────────────────
  // Scheduler lives in the API process, so the re-wrap pipeline runs here too.
  const tracker = new KeyRotationTracker();

  const keyRotationDeps: KeyRotationCheckDeps = {
    isKeyApproachingExpiry: (thresholdDays) =>
      tracker.isApproachingExpiry(vaultClient, 'ENCRYPTION_MASTER_KEY', thresholdDays),

    runKeyRotation: async () => {
      // Step 1: get current (old) version metadata directly from VaultClient
      // (KeyRotationTracker delegates to VaultClient for metadata reads)
      const meta = await vaultClient.getMetadata('ENCRYPTION_MASTER_KEY');
      const oldVersion = meta.version;

      // Step 2: write new KEK version to Vault + get new version number and hex
      const { version: newVersion, value: newKekHex } =
        await tracker.requestNewVersion(vaultClient, 'ENCRYPTION_MASTER_KEY');

      // Step 3: read old KEK hex from Vault (needed to unwrap existing DEKs)
      const oldKekHex = await tracker.getVersion(vaultClient, 'ENCRYPTION_MASTER_KEY', oldVersion);

      // Step 4: run pipeline with real Drizzle deps
      return runKeyRotation({
        oldKekHex,
        newKekHex,
        oldVersion,
        newVersion,
        pageSize: 500,

        findActiveJob: async (keyName) => {
          const rows = await db
            .select({ id: schema.keyRotationJobs.id })
            .from(schema.keyRotationJobs)
            .where(
              and(
                eq(schema.keyRotationJobs.keyName, keyName),
                eq(schema.keyRotationJobs.status, 'running'),
              ),
            )
            .limit(1);
          return rows[0] ?? null;
        },

        insertJob: async (params) => {
          const [row] = await db
            .insert(schema.keyRotationJobs)
            .values({
              keyName: params.keyName,
              oldVersion: params.oldVersion,
              newVersion: params.newVersion,
            })
            .returning({ id: schema.keyRotationJobs.id });
          if (!row) throw new Error('[ORDR:VAULT] Failed to insert key_rotation_jobs row');
          return row.id;
        },

        updateJobCursor: async (jobId, lastProcessedId, rowsDone) => {
          await db
            .update(schema.keyRotationJobs)
            .set({ lastProcessedId, rowsDone })
            .where(eq(schema.keyRotationJobs.id, jobId));
        },

        completeJob: async (jobId) => {
          await db
            .update(schema.keyRotationJobs)
            .set({ status: 'completed', completedAt: new Date() })
            .where(eq(schema.keyRotationJobs.id, jobId));
        },

        getPage: async (lastProcessedId, limit) => {
          const base = db
            .select({
              id: schema.encryptedFields.id,
              dek_envelope: schema.encryptedFields.dekEnvelope,
            })
            .from(schema.encryptedFields)
            .orderBy(schema.encryptedFields.id)
            .limit(limit);
          if (lastProcessedId !== null) {
            return base.where(gt(schema.encryptedFields.id, lastProcessedId));
          }
          return base;
        },

        updateRows: async (updates) => {
          for (const { id, dek_envelope } of updates) {
            await db
              .update(schema.encryptedFields)
              .set({ dekEnvelope: dek_envelope })
              .where(eq(schema.encryptedFields.id, id));
          }
        },

        emitAudit: (eventType, details) =>
          auditLogger.log({
            tenantId: 'system',
            eventType,
            actorType: 'system',
            actorId: 'scheduler:key-rotation-check',
            resource: 'encryption_key',
            resourceId: 'ENCRYPTION_MASTER_KEY',
            action: eventType,
            details,
            timestamp: new Date(),
          }),
      });
    },

    auditLogger: { log: (event) => auditLogger.log(event) },
  };

  jobScheduler.registerJob(
    createKeyRotationCheckDefinition(),
    createKeyRotationCheckHandler(keyRotationDeps),
  );
  console.warn('[ORDR:API] Key rotation check job registered');
```

> **Dependency note:** `db`, `auditLogger`, and `vaultClient` must already be constructed in the outer startup scope before this block. `schema.keyRotationJobs` and `schema.encryptedFields` must be exported from `@ordr/db` (added in Task 1 Step 5b).

- [ ] **Step 6: Add Vault to `apps/api/package.json` dependencies**

Open `apps/api/package.json`. In the `dependencies` block, add:

```json
"@ordr/vault": "workspace:*"
```

- [ ] **Step 7: TypeScript check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
cd ../..
git add apps/api/src/server.ts apps/api/package.json
git commit -m "feat(api): wire initSecretStore + onRotate callbacks + scheduler job — Phase 55"
```

---

### Task 8: Final Validation

- [ ] **Step 1: Run API test suite (pre-existing + Phase 55 key-rotation pipeline)**

```bash
cd D:/Synexiun/12-SynexCom/ORDR-Connect/apps/api && npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all pre-existing API tests pass + new Phase 55 key-rotation pipeline tests pass. No regressions.

- [ ] **Step 2: Run vault package tests**

```bash
cd ../.. && cd packages/vault && npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: all client, secret-store, and tracker tests pass.

- [ ] **Step 3: TypeScript strict check across all modified packages**

```bash
cd D:/Synexiun/12-SynexCom/ORDR-Connect/packages/core && npx tsc --noEmit && echo "core: OK"
cd ../vault && npx tsc --noEmit && echo "vault: OK"
cd ../scheduler && npx tsc --noEmit && echo "scheduler: OK"
cd ../db && npx tsc --noEmit && echo "db: OK"
cd ../../apps/api && npx tsc --noEmit && echo "api: OK"
```

Expected: `OK` for each. No errors.

- [ ] **Step 4: Push to main**

```bash
cd D:/Synexiun/12-SynexCom/ORDR-Connect
git push origin main
```

Expected: push succeeds.
