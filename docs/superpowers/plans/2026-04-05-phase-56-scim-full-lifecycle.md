# Phase 56 — SCIM Full Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete SCIM 2.0 server with full Group CRUD + PatchOps, atomic deprovisioning cascade, WorkOS Directory Sync webhook receiver, Kafka identity events, SQL-translated filters, and Drizzle-backed stores replacing all in-memory stores.

**Architecture:** Split `packages/auth/src/scim.ts` (747 lines) into a `packages/auth/src/scim/` directory. Replace in-memory stores with Drizzle implementations. Wire a WorkOS webhook receiver at `POST /webhooks/workos` that normalises events into the same SCIM handler methods used by the SCIM server. Emit Kafka events to `ordr.identity.events` for every group/user lifecycle change.

**Tech Stack:** TypeScript strict, Drizzle ORM, Hono, WorkOS SDK, Apache Kafka (`@ordr/events`), Node.js `crypto.timingSafeEqual`, PostgreSQL RLS, Vitest

**Spec:** `docs/superpowers/specs/2026-04-05-phase-56-scim-full-lifecycle-design.md`

---

## Chunk 1: Database Schema + Kafka Topic

### Task 1: Four SQL Migrations (0016–0019)

**Files:**
- Create: `packages/db/src/migrations/0016_scim_external_id.sql`
- Create: `packages/db/src/migrations/0017_scim_tokens_directory.sql`
- Create: `packages/db/src/migrations/0018_groups_and_members.sql`
- Create: `packages/db/src/migrations/0019_workos_events.sql`

- [ ] **Step 1: Write migration 0016 — scim_external_id on users**

```sql
-- 0016_scim_external_id.sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS scim_external_id TEXT,
  ADD COLUMN IF NOT EXISTS scim_source TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_scim_external_id_idx
  ON users (tenant_id, scim_external_id)
  WHERE scim_external_id IS NOT NULL;
```

- [ ] **Step 2: Write migration 0017 — directory_id on scim_tokens**

```sql
-- 0017_scim_tokens_directory.sql
ALTER TABLE scim_tokens
  ADD COLUMN IF NOT EXISTS directory_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS scim_tokens_directory_id_idx
  ON scim_tokens (directory_id)
  WHERE directory_id IS NOT NULL;
```

- [ ] **Step 3: Write migration 0018 — groups + group_members + RLS**

```sql
-- 0018_groups_and_members.sql
CREATE TABLE IF NOT EXISTS groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  scim_external_id TEXT,
  scim_source TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS groups_scim_external_id_idx
  ON groups (tenant_id, scim_external_id)
  WHERE scim_external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS group_members (
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by  TEXT NOT NULL DEFAULT 'scim',
  PRIMARY KEY (group_id, user_id)
);

-- RLS on groups (tenant-scoped)
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY groups_tenant_isolation ON groups
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- RLS on group_members (no tenant_id column — subquery through groups)
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_members_tenant_isolation ON group_members
  USING (
    group_id IN (
      SELECT id FROM groups
      WHERE tenant_id = current_setting('app.current_tenant')::uuid
    )
  );

```

- [ ] **Step 4: Write migration 0019 — workos_events WORM table**

```sql
-- 0019_workos_events.sql
CREATE TABLE IF NOT EXISTS workos_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_id    TEXT NOT NULL UNIQUE,
  event_type   TEXT NOT NULL,
  directory_id TEXT,
  payload      JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON workos_events FROM PUBLIC;
GRANT INSERT, SELECT ON workos_events TO ordr_api_role;

-- WORM: block UPDATE
CREATE OR REPLACE FUNCTION block_workos_events_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workos_events rows are immutable (WORM)';
END;
$$;
CREATE TRIGGER workos_events_no_update
  BEFORE UPDATE ON workos_events
  FOR EACH ROW EXECUTE FUNCTION block_workos_events_update();

-- WORM: block DELETE
CREATE OR REPLACE FUNCTION block_workos_events_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workos_events rows are immutable (WORM)';
END;
$$;
CREATE TRIGGER workos_events_no_delete
  BEFORE DELETE ON workos_events
  FOR EACH ROW EXECUTE FUNCTION block_workos_events_delete();
```

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/
git commit -m "feat(db): Phase 56 migrations 0016-0019 — scim columns, groups, workos_events WORM"
```

---

### Task 2: Drizzle Schemas + RLS Update + IDENTITY_EVENTS Topic

**Files:**
- Create: `packages/db/src/schema/groups.ts`
- Create: `packages/db/src/schema/group-members.ts`
- Create: `packages/db/src/schema/workos-events.ts`
- Modify: `packages/db/src/schema/users.ts` — add `scimExternalId`, `scimSource` columns
- Modify: `packages/db/src/schema/scim-tokens.ts` — add `directoryId` column
- Modify: `packages/db/src/rls.ts` — add `'groups'` to `RLS_TABLES`
- Modify: `packages/events/src/topics.ts` — add `IDENTITY_EVENTS`

- [ ] **Step 1: Add scim columns to users schema**

In `packages/db/src/schema/users.ts`, add after the existing columns (before closing of `pgTable` call):

```typescript
scimExternalId: text('scim_external_id'),
scimSource: text('scim_source'),
```

- [ ] **Step 2: Add directoryId to scim-tokens schema**

In `packages/db/src/schema/scim-tokens.ts`, add:

```typescript
directoryId: text('directory_id'),
```

- [ ] **Step 3: Write groups schema**

```typescript
// packages/db/src/schema/groups.ts
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  scimExternalId: text('scim_external_id'),
  scimSource: text('scim_source'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Write group-members schema**

```typescript
// packages/db/src/schema/group-members.ts
import { pgTable, uuid, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { groups } from './groups';
import { users } from './users';

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    addedBy: text('added_by').notNull().default('scim'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.groupId, t.userId] }) }),
);
```

- [ ] **Step 5: Write workos-events schema**

```typescript
// packages/db/src/schema/workos-events.ts
import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const workosEvents = pgTable('workos_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workosId: text('workos_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  directoryId: text('directory_id'),
  payload: jsonb('payload').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 6: Update db/src/schema/index.ts to export new schemas**

Add exports for `groups`, `groupMembers`, `workosEvents`.

- [ ] **Step 7: Add 'groups' to RLS_TABLES in packages/db/src/rls.ts**

```typescript
// In the RLS_TABLES array, add:
'groups',
```

Note: Do NOT add `'group_members'` — it uses a custom subquery policy in the migration (no `tenant_id` column).

- [ ] **Step 8: Add IDENTITY_EVENTS to packages/events/src/topics.ts**

```typescript
// Add to TOPICS object:
IDENTITY_EVENTS: 'ordr.identity.events',
```

Also add the corresponding config entry with the same partition/replication settings as other topics.

- [ ] **Step 9: Run type-check to verify schema changes compile**

```bash
cd packages/db && npx tsc --noEmit
cd packages/events && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 10: Commit**

```bash
git add packages/db/ packages/events/
git commit -m "feat(db): Phase 56 Drizzle schemas — groups, group_members, workos_events + IDENTITY_EVENTS topic"
```

---

## Chunk 2: SCIM Type Definitions + Filter Engine + Token Store

### Task 3: SCIM Types and In-Memory Store Removal

**Files:**
- Create: `packages/auth/src/scim/types.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/auth/src/scim/__tests__/types.test.ts
import { describe, it, expect } from 'vitest';
import type { SCIMUserRecord, SCIMGroupRecord, SCIMPatchOp } from '../types';

describe('SCIM types', () => {
  it('SCIMUserRecord has externalId and active fields', () => {
    const user: SCIMUserRecord = {
      id: 'u1',
      tenantId: 't1',
      externalId: 'ext-1',
      userName: 'alice@example.com',
      displayName: 'Alice',
      emails: [{ value: 'alice@example.com', primary: true }],
      active: true,
      externalSource: 'workos',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(user.externalId).toBe('ext-1');
    expect(user.active).toBe(true);
  });

  it('SCIMGroupRecord has externalId and members array', () => {
    const group: SCIMGroupRecord = {
      id: 'g1',
      tenantId: 't1',
      displayName: 'Admins',
      externalId: 'ext-g1',
      externalSource: 'workos',
      members: [{ value: 'u1', display: 'Alice' }],
      memberCount: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(group.members).toHaveLength(1);
    expect(group.memberCount).toBe(1);
  });

  it('SCIMPatchOp discriminates add/remove/replace', () => {
    const addOp: SCIMPatchOp = { op: 'add', path: 'members', value: [{ value: 'u1' }] };
    const removeOp: SCIMPatchOp = { op: 'remove', path: 'members', value: [{ value: 'u1' }] };
    expect(addOp.op).toBe('add');
    expect(removeOp.op).toBe('remove');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/types.test.ts
```

Expected: FAIL — cannot find module `../types`.

- [ ] **Step 3: Implement types.ts**

```typescript
// packages/auth/src/scim/types.ts

export interface SCIMEmail {
  value: string;
  primary: boolean;
}

export interface SCIMUserRecord {
  id: string;
  tenantId: string;
  externalId: string | null;
  externalSource: string | null;
  userName: string;
  displayName: string;
  emails: SCIMEmail[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SCIMGroupMember {
  value: string;  // user ID
  display?: string;
}

export interface SCIMGroupRecord {
  id: string;
  tenantId: string;
  displayName: string;
  externalId: string | null;
  externalSource: string | null;
  members: SCIMGroupMember[];
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type SCIMPatchOpType = 'add' | 'remove' | 'replace';

export interface SCIMPatchOp {
  op: SCIMPatchOpType;
  path: string;
  value?: unknown;
}

export interface SCIMPatchRequest {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'];
  Operations: SCIMPatchOp[];
}

export interface SCIMListResponse<T> {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface SCIMFilter {
  field: string;
  operator: 'eq' | 'ne' | 'co' | 'sw' | 'pr';
  value?: string;
}

export interface SCIMListParams {
  filter?: SCIMFilter;
  startIndex: number;
  count: number;
}

// Store interfaces (implemented by Drizzle stores)
export interface SCIMUserStore {
  create(tenantId: string, record: Omit<SCIMUserRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>): Promise<SCIMUserRecord>;
  getById(tenantId: string, id: string): Promise<SCIMUserRecord | null>;
  getByExternalId(tenantId: string, externalId: string): Promise<SCIMUserRecord | null>;
  getByUserName(tenantId: string, userName: string): Promise<SCIMUserRecord | null>;
  update(tenantId: string, id: string, patch: Partial<SCIMUserRecord>): Promise<SCIMUserRecord | null>;
  list(tenantId: string, params: SCIMListParams): Promise<{ records: SCIMUserRecord[]; total: number }>;
}

export interface SCIMGroupStore {
  create(tenantId: string, record: Omit<SCIMGroupRecord, 'id' | 'tenantId' | 'members' | 'memberCount' | 'createdAt' | 'updatedAt'>): Promise<SCIMGroupRecord>;
  getById(tenantId: string, id: string): Promise<SCIMGroupRecord | null>;
  getByExternalId(tenantId: string, externalId: string): Promise<SCIMGroupRecord | null>;
  update(tenantId: string, id: string, patch: Partial<Pick<SCIMGroupRecord, 'displayName' | 'externalId' | 'externalSource'>>): Promise<SCIMGroupRecord | null>;
  delete(tenantId: string, id: string): Promise<void>;
  syncMembers(groupId: string, userIds: string[]): Promise<void>;
  addMember(groupId: string, userId: string): Promise<void>;
  removeMember(groupId: string, userId: string): Promise<void>;
  list(tenantId: string, params: SCIMListParams): Promise<{ records: SCIMGroupRecord[]; total: number }>;
}

export interface SCIMTokenStore {
  /** Look up a SCIM bearer token (by its SHA-256 hash) to get tenantId + directoryId */
  findByToken(hashedToken: string): Promise<{ tenantId: string; directoryId: string | null } | null>;
  /** Look up a WorkOS directory_id to resolve tenantId for webhook delivery */
  findByDirectoryId(directoryId: string): Promise<{ tenantId: string } | null>;
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/types.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/scim/
git commit -m "feat(scim): Phase 56 Task 3 — SCIM type definitions and store interfaces"
```

---

### Task 4: SCIM SQL Filter Translator

**Files:**
- Create: `packages/auth/src/scim/filters.ts`
- Create: `packages/auth/src/scim/__tests__/filters.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/auth/src/scim/__tests__/filters.test.ts
import { describe, it, expect } from 'vitest';
import { parseSCIMFilter, buildFilterSQL } from '../filters';

describe('parseSCIMFilter', () => {
  it('parses eq operator', () => {
    expect(parseSCIMFilter('userName eq "alice@example.com"')).toEqual({
      field: 'userName', operator: 'eq', value: 'alice@example.com',
    });
  });

  it('parses ne operator', () => {
    expect(parseSCIMFilter('active ne "false"')).toEqual({
      field: 'active', operator: 'ne', value: 'false',
    });
  });

  it('parses co operator (contains)', () => {
    expect(parseSCIMFilter('displayName co "alice"')).toEqual({
      field: 'displayName', operator: 'co', value: 'alice',
    });
  });

  it('parses sw operator (starts-with)', () => {
    expect(parseSCIMFilter('emails.value sw "alice"')).toEqual({
      field: 'emails.value', operator: 'sw', value: 'alice',
    });
  });

  it('parses pr operator (present)', () => {
    expect(parseSCIMFilter('externalId pr')).toEqual({
      field: 'externalId', operator: 'pr', value: undefined,
    });
  });

  it('returns null for unsupported filter', () => {
    expect(parseSCIMFilter('unknown gt "5"')).toBeNull();
  });
});

describe('buildFilterSQL', () => {
  it('eq produces = clause', () => {
    const result = buildFilterSQL({ field: 'userName', operator: 'eq', value: 'alice' }, {
      userName: 'user_name',
    });
    expect(result?.clause).toBe('user_name = $1');
    expect(result?.params).toEqual(['alice']);
  });

  it('ne produces <> clause', () => {
    const result = buildFilterSQL({ field: 'active', operator: 'ne', value: 'false' }, {
      active: 'status',
    });
    expect(result?.clause).toBe('status <> $1');
    expect(result?.params).toEqual(['false']);
  });

  it('co produces ILIKE %val% clause', () => {
    const result = buildFilterSQL({ field: 'displayName', operator: 'co', value: 'alice' }, {
      displayName: 'display_name',
    });
    expect(result?.clause).toBe('display_name ILIKE $1');
    expect(result?.params).toEqual(['%alice%']);
  });

  it('sw produces ILIKE val% clause', () => {
    const result = buildFilterSQL({ field: 'displayName', operator: 'sw', value: 'ali' }, {
      displayName: 'display_name',
    });
    expect(result?.clause).toBe('display_name ILIKE $1');
    expect(result?.params).toEqual(['ali%']);
  });

  it('pr produces IS NOT NULL clause', () => {
    const result = buildFilterSQL({ field: 'externalId', operator: 'pr' }, {
      externalId: 'scim_external_id',
    });
    expect(result?.clause).toBe('scim_external_id IS NOT NULL');
    expect(result?.params).toEqual([]);
  });

  it('returns null for unmapped field', () => {
    const result = buildFilterSQL({ field: 'unknown', operator: 'eq', value: 'x' }, {});
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/filters.test.ts
```

Expected: FAIL — cannot find module `../filters`.

- [ ] **Step 3: Implement filters.ts**

```typescript
// packages/auth/src/scim/filters.ts
import type { SCIMFilter } from './types';

const FILTER_REGEX = /^(\S+)\s+(eq|ne|co|sw|pr)(?:\s+"([^"]*)")?$/;

export function parseSCIMFilter(filterStr: string): SCIMFilter | null {
  const match = FILTER_REGEX.exec(filterStr.trim());
  if (!match) return null;
  const [, field, operator, value] = match;
  return { field, operator: operator as SCIMFilter['operator'], value };
}

export interface FilterSQLResult {
  clause: string;
  params: string[];
}

/**
 * Translates a SCIMFilter into a SQL WHERE clause fragment.
 * @param filter  Parsed SCIM filter
 * @param fieldMap Map of SCIM field name → SQL column name
 * @param paramOffset Starting $N offset (default 1)
 */
export function buildFilterSQL(
  filter: SCIMFilter,
  fieldMap: Record<string, string>,
  paramOffset = 1,
): FilterSQLResult | null {
  const col = fieldMap[filter.field];
  if (!col) return null;

  switch (filter.operator) {
    case 'eq':
      return { clause: `${col} = $${paramOffset}`, params: [filter.value ?? ''] };
    case 'ne':
      return { clause: `${col} <> $${paramOffset}`, params: [filter.value ?? ''] };
    case 'co':
      return { clause: `${col} ILIKE $${paramOffset}`, params: [`%${filter.value ?? ''}%`] };
    case 'sw':
      return { clause: `${col} ILIKE $${paramOffset}`, params: [`${filter.value ?? ''}%`] };
    case 'pr':
      return { clause: `${col} IS NOT NULL`, params: [] };
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/filters.test.ts
```

Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/scim/filters.ts packages/auth/src/scim/__tests__/filters.test.ts
git commit -m "feat(scim): Phase 56 Task 4 — SQL filter translator with all SCIM operators"
```

---

### Task 5: DrizzleTokenStore

**Files:**
- Create: `packages/auth/src/scim/token-store.ts`
- Create: `packages/auth/src/scim/__tests__/token-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/auth/src/scim/__tests__/token-store.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DrizzleTokenStore } from '../token-store';

const makeDb = (row: unknown) => ({
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(row ? [row] : []),
});

describe('DrizzleTokenStore', () => {
  it('findByToken returns tenantId + directoryId when token found', async () => {
    const db = makeDb({ tenantId: 'tenant-1', directoryId: 'dir-1' });
    const store = new DrizzleTokenStore(db as never);
    const result = await store.findByToken('hashed-token');
    expect(result).toEqual({ tenantId: 'tenant-1', directoryId: 'dir-1' });
  });

  it('findByToken returns null when token not found', async () => {
    const db = makeDb(null);
    const store = new DrizzleTokenStore(db as never);
    const result = await store.findByToken('unknown-token');
    expect(result).toBeNull();
  });

  it('findByDirectoryId returns tenantId when directory_id matches', async () => {
    const db = makeDb({ tenantId: 'tenant-1' });
    const store = new DrizzleTokenStore(db as never);
    const result = await store.findByDirectoryId('dir_01HXYZ');
    expect(result).toEqual({ tenantId: 'tenant-1' });
  });

  it('findByDirectoryId returns null when directory_id not found', async () => {
    const db = makeDb(null);
    const store = new DrizzleTokenStore(db as never);
    const result = await store.findByDirectoryId('dir_unknown');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/token-store.test.ts
```

Expected: FAIL — cannot find module `../token-store`.

- [ ] **Step 3: Implement token-store.ts**

```typescript
// packages/auth/src/scim/token-store.ts
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { scimTokens } from '@ordr/db';
import type { SCIMTokenStore } from './types';

export class DrizzleTokenStore implements SCIMTokenStore {
  constructor(private readonly db: NodePgDatabase) {}

  async findByToken(hashedToken: string): Promise<{ tenantId: string; directoryId: string | null } | null> {
    const rows = await this.db
      .select({ tenantId: scimTokens.tenantId, directoryId: scimTokens.directoryId })
      .from(scimTokens)
      .where(eq(scimTokens.tokenHash, hashedToken));
    return rows[0] ?? null;
  }

  /** Used by WorkOS webhook handler to resolve directory_id → tenantId */
  async findByDirectoryId(directoryId: string): Promise<{ tenantId: string } | null> {
    const rows = await this.db
      .select({ tenantId: scimTokens.tenantId })
      .from(scimTokens)
      .where(eq(scimTokens.directoryId, directoryId));
    return rows[0] ?? null;
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/token-store.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/scim/token-store.ts packages/auth/src/scim/__tests__/token-store.test.ts
git commit -m "feat(scim): Phase 56 Task 5 — DrizzleTokenStore with findByToken + findByDirectoryId"
```

---

## Chunk 3: DrizzleUserStore + DrizzleGroupStore

### Task 6: DrizzleUserStore with SQL Filter Translation

**Files:**
- Create: `packages/auth/src/scim/user-store.ts`
- Create: `packages/auth/src/scim/__tests__/user-store.test.ts`

- [ ] **Step 1: Write failing tests (integration-style with mock db)**

```typescript
// packages/auth/src/scim/__tests__/user-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrizzleUserStore } from '../user-store';

// Minimal mock that returns controlled results
function makeDb(selectRows: unknown[] = [], updateRow?: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue(selectRows),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([selectRows[0] ?? {}]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
  };
  // Allow where().returning() for update path
  chain.where = vi.fn().mockReturnValue({
    ...chain,
    returning: vi.fn().mockResolvedValue(updateRow ? [updateRow] : []),
  });
  return chain;
}

describe('DrizzleUserStore', () => {
  it('create inserts and returns mapped record', async () => {
    const dbRow = {
      id: 'u1', tenantId: 't1', scimExternalId: 'ext-1', scimSource: 'workos',
      userName: 'alice@example.com', displayName: 'Alice',
      emails: [{ value: 'alice@example.com', primary: true }],
      status: 'active', createdAt: new Date(), updatedAt: new Date(),
    };
    const db = makeDb([dbRow]);
    const store = new DrizzleUserStore(db as never);
    const result = await store.create('t1', {
      externalId: 'ext-1', externalSource: 'workos',
      userName: 'alice@example.com', displayName: 'Alice',
      emails: [{ value: 'alice@example.com', primary: true }],
      active: true,
    });
    expect(result.id).toBe('u1');
    expect(result.externalId).toBe('ext-1');
    expect(result.active).toBe(true);
  });

  it('getById returns null for missing user', async () => {
    const db = makeDb([]);
    const store = new DrizzleUserStore(db as never);
    const result = await store.getById('t1', 'missing-id');
    expect(result).toBeNull();
  });

  it('list applies eq filter via SQL (not in-memory)', async () => {
    const db = makeDb([]);
    const querySpy = vi.spyOn(db, 'select');
    const store = new DrizzleUserStore(db as never);
    await store.list('t1', {
      filter: { field: 'userName', operator: 'eq', value: 'alice@example.com' },
      startIndex: 1,
      count: 10,
    });
    // select was called (SQL path exercised)
    expect(querySpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/user-store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement user-store.ts**

```typescript
// packages/auth/src/scim/user-store.ts
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, ilike, isNotNull, ne, sql, type SQL } from 'drizzle-orm';
import { users } from '@ordr/db';
import type { SCIMUserRecord, SCIMUserStore, SCIMListParams, SCIMFilter } from './types';

/**
 * Translates a SCIMFilter into a Drizzle SQL expression using typed operators.
 * Rule 4 — parameterized queries only; never sql.raw() with user values.
 */
function scimFilterToUserSQL(filter: SCIMFilter): SQL | null {
  const v = filter.value ?? '';
  switch (filter.field) {
    case 'userName':
      if (filter.operator === 'eq') return eq(users.userName, v);
      if (filter.operator === 'ne') return ne(users.userName, v);
      if (filter.operator === 'co') return ilike(users.userName, `%${v}%`);
      if (filter.operator === 'sw') return ilike(users.userName, `${v}%`);
      if (filter.operator === 'pr') return isNotNull(users.userName);
      break;
    case 'displayName':
      if (filter.operator === 'eq') return eq(users.displayName, v);
      if (filter.operator === 'ne') return ne(users.displayName, v);
      if (filter.operator === 'co') return ilike(users.displayName, `%${v}%`);
      if (filter.operator === 'sw') return ilike(users.displayName, `${v}%`);
      if (filter.operator === 'pr') return isNotNull(users.displayName);
      break;
    case 'emails.value':
      if (filter.operator === 'eq') return eq(users.email, v);
      if (filter.operator === 'ne') return ne(users.email, v);
      if (filter.operator === 'co') return ilike(users.email, `%${v}%`);
      if (filter.operator === 'sw') return ilike(users.email, `${v}%`);
      if (filter.operator === 'pr') return isNotNull(users.email);
      break;
    case 'active':
      if (filter.operator === 'eq') return eq(users.status, v === 'true' ? 'active' : 'inactive');
      if (filter.operator === 'ne') return ne(users.status, v === 'true' ? 'active' : 'inactive');
      if (filter.operator === 'pr') return isNotNull(users.status);
      break;
    case 'externalId':
      if (filter.operator === 'eq') return eq(users.scimExternalId, v);
      if (filter.operator === 'ne') return ne(users.scimExternalId, v);
      if (filter.operator === 'co') return ilike(users.scimExternalId, `%${v}%`);
      if (filter.operator === 'sw') return ilike(users.scimExternalId, `${v}%`);
      if (filter.operator === 'pr') return isNotNull(users.scimExternalId);
      break;
  }
  return null;
}

function rowToRecord(row: typeof users.$inferSelect): SCIMUserRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    externalId: row.scimExternalId ?? null,
    externalSource: row.scimSource ?? null,
    userName: row.userName,
    displayName: row.displayName ?? row.userName,
    emails: row.email ? [{ value: row.email, primary: true }] : [],
    active: row.status === 'active',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleUserStore implements SCIMUserStore {
  constructor(private readonly db: NodePgDatabase) {}

  async create(
    tenantId: string,
    record: Omit<SCIMUserRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<SCIMUserRecord> {
    const rows = await this.db
      .insert(users)
      .values({
        tenantId,
        userName: record.userName,
        displayName: record.displayName,
        email: record.emails[0]?.value,
        status: record.active ? 'active' : 'inactive',
        scimExternalId: record.externalId ?? undefined,
        scimSource: record.externalSource ?? undefined,
      })
      .returning();
    return rowToRecord(rows[0]);
  }

  async getById(tenantId: string, id: string): Promise<SCIMUserRecord | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async getByExternalId(tenantId: string, externalId: string): Promise<SCIMUserRecord | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.scimExternalId, externalId)));
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async getByUserName(tenantId: string, userName: string): Promise<SCIMUserRecord | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.userName, userName)));
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<SCIMUserRecord>,
  ): Promise<SCIMUserRecord | null> {
    const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (patch.displayName !== undefined) set.displayName = patch.displayName;
    if (patch.active !== undefined) set.status = patch.active ? 'active' : 'inactive';
    if (patch.externalId !== undefined) set.scimExternalId = patch.externalId ?? undefined;
    if (patch.externalSource !== undefined) set.scimSource = patch.externalSource ?? undefined;
    if (patch.emails) set.email = patch.emails[0]?.value;

    const rows = await this.db
      .update(users)
      .set(set)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)))
      .returning();
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async list(
    tenantId: string,
    params: SCIMListParams,
  ): Promise<{ records: SCIMUserRecord[]; total: number }> {
    const offset = Math.max(0, params.startIndex - 1);

    // Build conditions using Drizzle typed operators (Rule 4 — no sql.raw with user values)
    const conditions: SQL[] = [eq(users.tenantId, tenantId)];
    if (params.filter) {
      const filterExpr = scimFilterToUserSQL(params.filter);
      if (filterExpr) conditions.push(filterExpr);
    }

    const whereClause = and(...conditions);

    const [rows, countRows] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(whereClause)
        .limit(params.count)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(whereClause),
    ]);

    return {
      records: rows.map(rowToRecord),
      total: countRows[0]?.count ?? 0,
    };
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/user-store.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/scim/user-store.ts packages/auth/src/scim/__tests__/user-store.test.ts
git commit -m "feat(scim): Phase 56 Task 6 — DrizzleUserStore with SQL filter translation"
```

---

### Task 7: DrizzleGroupStore with syncMembers Transaction

**Files:**
- Create: `packages/auth/src/scim/group-store.ts`
- Create: `packages/auth/src/scim/__tests__/group-store.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/auth/src/scim/__tests__/group-store.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DrizzleGroupStore } from '../group-store';

const makeTx = () => ({
  delete: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue([]),
});

const makeDb = (selectRows: unknown[] = []) => {
  const tx = makeTx();
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(selectRows),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(selectRows[0] ? [selectRows[0]] : []),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(tx);
    }),
  };
};

describe('DrizzleGroupStore', () => {
  it('create inserts group and returns record', async () => {
    const dbRow = {
      id: 'g1', tenantId: 't1', displayName: 'Admins',
      scimExternalId: 'ext-g1', scimSource: 'workos',
      createdAt: new Date(), updatedAt: new Date(),
    };
    const db = makeDb([dbRow]);
    const store = new DrizzleGroupStore(db as never);
    const result = await store.create('t1', {
      displayName: 'Admins', externalId: 'ext-g1', externalSource: 'workos',
    });
    expect(result.id).toBe('g1');
    expect(result.displayName).toBe('Admins');
    expect(result.members).toEqual([]);
    expect(result.memberCount).toBe(0);
  });

  it('syncMembers calls transaction with delete then insert', async () => {
    const db = makeDb([]);
    const store = new DrizzleGroupStore(db as never);
    await store.syncMembers('g1', ['u1', 'u2']);
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('delete removes the group row', async () => {
    const db = makeDb([]);
    const deleteSpy = vi.spyOn(db, 'delete');
    const store = new DrizzleGroupStore(db as never);
    await store.delete('t1', 'g1');
    expect(deleteSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/group-store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement group-store.ts**

```typescript
// packages/auth/src/scim/group-store.ts
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { groups, groupMembers, users } from '@ordr/db';
import type { SCIMGroupRecord, SCIMGroupStore, SCIMListParams } from './types';

function rowToRecord(
  row: typeof groups.$inferSelect,
  members: Array<{ userId: string; displayName: string | null }> = [],
): SCIMGroupRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    displayName: row.displayName,
    externalId: row.scimExternalId ?? null,
    externalSource: row.scimSource ?? null,
    members: members.map((m) => ({ value: m.userId, display: m.displayName ?? undefined })),
    memberCount: members.length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleGroupStore implements SCIMGroupStore {
  constructor(private readonly db: NodePgDatabase) {}

  private async loadMembers(groupId: string): Promise<Array<{ userId: string; displayName: string | null }>> {
    const rows = await this.db
      .select({ userId: groupMembers.userId, displayName: users.displayName })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
      .innerJoin(users, eq(users.id, groupMembers.userId));
    return rows;
  }

  async create(
    tenantId: string,
    record: Omit<SCIMGroupRecord, 'id' | 'tenantId' | 'members' | 'memberCount' | 'createdAt' | 'updatedAt'>,
  ): Promise<SCIMGroupRecord> {
    const rows = await this.db
      .insert(groups)
      .values({
        tenantId,
        displayName: record.displayName,
        scimExternalId: record.externalId ?? undefined,
        scimSource: record.externalSource ?? undefined,
      })
      .returning();
    return rowToRecord(rows[0], []);
  }

  async getById(tenantId: string, id: string): Promise<SCIMGroupRecord | null> {
    const rows = await this.db
      .select()
      .from(groups)
      .where(and(eq(groups.tenantId, tenantId), eq(groups.id, id)));
    if (!rows[0]) return null;
    const members = await this.loadMembers(id);
    return rowToRecord(rows[0], members);
  }

  async getByExternalId(tenantId: string, externalId: string): Promise<SCIMGroupRecord | null> {
    const rows = await this.db
      .select()
      .from(groups)
      .where(and(eq(groups.tenantId, tenantId), eq(groups.scimExternalId, externalId)));
    if (!rows[0]) return null;
    const members = await this.loadMembers(rows[0].id);
    return rowToRecord(rows[0], members);
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<SCIMGroupRecord, 'displayName' | 'externalId' | 'externalSource'>>,
  ): Promise<SCIMGroupRecord | null> {
    const set: Partial<typeof groups.$inferInsert> = { updatedAt: new Date() };
    if (patch.displayName !== undefined) set.displayName = patch.displayName;
    if (patch.externalId !== undefined) set.scimExternalId = patch.externalId ?? undefined;
    if (patch.externalSource !== undefined) set.scimSource = patch.externalSource ?? undefined;

    const rows = await this.db
      .update(groups)
      .set(set)
      .where(and(eq(groups.tenantId, tenantId), eq(groups.id, id)))
      .returning();
    if (!rows[0]) return null;
    const members = await this.loadMembers(id);
    return rowToRecord(rows[0], members);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.db
      .delete(groups)
      .where(and(eq(groups.tenantId, tenantId), eq(groups.id, id)));
  }

  /** Atomic full replacement of group_members (used by PUT /Groups/:id and WorkOS group.updated) */
  async syncMembers(groupId: string, userIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(groupMembers).where(eq(groupMembers.groupId, groupId));
      if (userIds.length > 0) {
        await tx.insert(groupMembers).values(userIds.map((userId) => ({ groupId, userId })));
      }
    });
  }

  async addMember(groupId: string, userId: string): Promise<void> {
    await this.db
      .insert(groupMembers)
      .values({ groupId, userId })
      .onConflictDoNothing();
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    await this.db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  }

  async list(
    tenantId: string,
    params: SCIMListParams,
  ): Promise<{ records: SCIMGroupRecord[]; total: number }> {
    const offset = Math.max(0, params.startIndex - 1);
    const whereClause = eq(groups.tenantId, tenantId);

    const [rows, countRows] = await Promise.all([
      this.db.select().from(groups).where(whereClause).limit(params.count).offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(groups)
        .where(whereClause),
    ]);

    const records = await Promise.all(
      rows.map(async (row) => {
        const members = await this.loadMembers(row.id);
        return rowToRecord(row, members);
      }),
    );

    return { records, total: countRows[0]?.count ?? 0 };
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/group-store.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/scim/group-store.ts packages/auth/src/scim/__tests__/group-store.test.ts
git commit -m "feat(scim): Phase 56 Task 7 — DrizzleGroupStore with syncMembers transaction"
```

---

## Chunk 4: SCIMHandler + WorkOS Event Normaliser

### Task 8: SCIMHandler — All 10 Operations + Deprovisioning Cascade

**Files:**
- Create: `packages/auth/src/scim/handler.ts`
- Create: `packages/auth/src/scim/__tests__/handler.test.ts`

- [ ] **Step 1: Write failing tests for the key paths**

```typescript
// packages/auth/src/scim/__tests__/handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SCIMHandler } from '../handler';
import type { SCIMHandlerDeps } from '../handler';

function makeDeps(overrides: Partial<SCIMHandlerDeps> = {}): SCIMHandlerDeps {
  const user = {
    id: 'u1', tenantId: 't1', externalId: 'ext-1', externalSource: 'workos',
    userName: 'alice@example.com', displayName: 'Alice',
    emails: [{ value: 'alice@example.com', primary: true }],
    active: true, createdAt: new Date(), updatedAt: new Date(),
  };
  const group = {
    id: 'g1', tenantId: 't1', displayName: 'Admins',
    externalId: 'ext-g1', externalSource: 'workos',
    members: [], memberCount: 0, createdAt: new Date(), updatedAt: new Date(),
  };
  return {
    userStore: {
      create: vi.fn().mockResolvedValue(user),
      getById: vi.fn().mockResolvedValue(user),
      getByExternalId: vi.fn().mockResolvedValue(null),
      getByUserName: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(user),
      list: vi.fn().mockResolvedValue({ records: [user], total: 1 }),
    },
    groupStore: {
      create: vi.fn().mockResolvedValue(group),
      getById: vi.fn().mockResolvedValue(group),
      getByExternalId: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(group),
      delete: vi.fn().mockResolvedValue(undefined),
      syncMembers: vi.fn().mockResolvedValue(undefined),
      addMember: vi.fn().mockResolvedValue(undefined),
      removeMember: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ records: [group], total: 1 }),
    },
    db: {
      transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
        await fn({
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([]),
          delete: vi.fn().mockReturnThis(),
        });
      }),
    } as never,
    eventProducer: {
      send: vi.fn().mockResolvedValue(undefined),
    } as never,
    auditLogger: {
      log: vi.fn().mockResolvedValue(undefined),
    } as never,
    ...overrides,
  };
}

describe('SCIMHandler.createUser', () => {
  it('creates user and returns SCIM resource', async () => {
    const deps = makeDeps();
    const handler = new SCIMHandler(deps);
    const result = await handler.createUser('t1', {
      externalId: 'ext-1', externalSource: 'workos',
      userName: 'alice@example.com', displayName: 'Alice',
      emails: [{ value: 'alice@example.com', primary: true }], active: true,
    });
    expect(result.id).toBe('u1');
    expect(deps.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'SCIM_USER_CREATED' }),
    );
  });
});

describe('SCIMHandler.deleteUser (deprovisioning cascade)', () => {
  it('runs atomic transaction covering deactivate + session delete + group_members delete', async () => {
    const deps = makeDeps();
    const handler = new SCIMHandler(deps);
    await handler.deleteUser('t1', 'u1');
    expect(deps.db.transaction).toHaveBeenCalledOnce();
  });

  it('is idempotent — returns ok when user already inactive', async () => {
    const inactiveUser = {
      id: 'u1', tenantId: 't1', externalId: null, externalSource: null,
      userName: 'alice@example.com', displayName: 'Alice', emails: [],
      active: false, createdAt: new Date(), updatedAt: new Date(),
    };
    const deps = makeDeps({
      userStore: { ...makeDeps().userStore, getById: vi.fn().mockResolvedValue(inactiveUser) },
    });
    const handler = new SCIMHandler(deps);
    await handler.deleteUser('t1', 'u1');
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('does not include key material in audit event', async () => {
    const deps = makeDeps();
    const handler = new SCIMHandler(deps);
    await handler.deleteUser('t1', 'u1');
    const auditCall = (deps.auditLogger.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const serialized = JSON.stringify(auditCall);
    expect(serialized).not.toMatch(/password|secret|key|token/i);
  });
});

describe('SCIMHandler.patchGroup', () => {
  it('handles add members PatchOp', async () => {
    const deps = makeDeps();
    const handler = new SCIMHandler(deps);
    await handler.patchGroup('t1', 'g1', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'add', path: 'members', value: [{ value: 'u1' }] }],
    });
    expect(deps.groupStore.addMember).toHaveBeenCalledWith('g1', 'u1');
  });

  it('handles remove members PatchOp', async () => {
    const deps = makeDeps();
    const handler = new SCIMHandler(deps);
    await handler.patchGroup('t1', 'g1', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'remove', path: 'members', value: [{ value: 'u2' }] }],
    });
    expect(deps.groupStore.removeMember).toHaveBeenCalledWith('g1', 'u2');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/handler.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement handler.ts**

```typescript
// packages/auth/src/scim/handler.ts
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { users, sessions, groupMembers } from '@ordr/db';
import type { EventProducer } from '@ordr/events';
import { TOPICS } from '@ordr/events';
import type {
  SCIMUserRecord, SCIMGroupRecord, SCIMPatchRequest,
  SCIMUserStore, SCIMGroupStore, SCIMListParams, SCIMListResponse,
} from './types';

export interface AuditLogger {
  log(event: { eventType: string; tenantId: string; details: Record<string, unknown> }): Promise<void>;
}

export interface SCIMHandlerDeps {
  userStore: SCIMUserStore;
  groupStore: SCIMGroupStore;
  db: NodePgDatabase;
  eventProducer: EventProducer;
  auditLogger: AuditLogger;
}

export class SCIMHandler {
  constructor(private readonly deps: SCIMHandlerDeps) {}

  // ── User operations ────────────────────────────────────────────────

  async createUser(
    tenantId: string,
    data: Omit<SCIMUserRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<SCIMUserRecord> {
    // Check idempotency by externalId
    if (data.externalId) {
      const existing = await this.deps.userStore.getByExternalId(tenantId, data.externalId);
      if (existing) return existing;
    }
    const user = await this.deps.userStore.create(tenantId, data);
    await this.deps.auditLogger.log({
      eventType: 'SCIM_USER_CREATED',
      tenantId,
      details: { userId: user.id, userName: user.userName },
    });
    await this.deps.eventProducer.send(TOPICS.IDENTITY_EVENTS, {
      type: 'user.provisioned', tenantId, userId: user.id,
    }).catch(() => undefined);
    return user;
  }

  async getUser(tenantId: string, id: string): Promise<SCIMUserRecord | null> {
    return this.deps.userStore.getById(tenantId, id);
  }

  async updateUser(
    tenantId: string,
    id: string,
    patch: Partial<SCIMUserRecord>,
  ): Promise<SCIMUserRecord | null> {
    const user = await this.deps.userStore.update(tenantId, id, patch);
    if (user) {
      await this.deps.auditLogger.log({
        eventType: 'SCIM_USER_UPDATED',
        tenantId,
        details: { userId: user.id },
      });
    }
    return user;
  }

  /** Deprovisioning cascade — atomic transaction then best-effort Kafka */
  async deleteUser(tenantId: string, userId: string): Promise<void> {
    const user = await this.deps.userStore.getById(tenantId, userId);
    if (!user) return;
    if (!user.active) return; // idempotent

    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ status: 'inactive', scimExternalId: null, scimSource: null, updatedAt: new Date() })
        .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await tx.delete(groupMembers).where(eq(groupMembers.userId, userId));
      // WORM audit inside transaction (Rule 3 — atomic with state change)
      await this.deps.auditLogger.log({
        eventType: 'SCIM_USER_DEPROVISIONED',
        tenantId,
        details: { userId, userName: user.userName },
      });
    });

    // Kafka is best-effort — after commit, never blocks the cascade
    await this.deps.eventProducer.send(TOPICS.IDENTITY_EVENTS, {
      type: 'user.deprovisioned', tenantId, userId,
    }).catch(() => undefined);
  }

  async listUsers(
    tenantId: string,
    params: SCIMListParams,
  ): Promise<SCIMListResponse<SCIMUserRecord>> {
    const { records, total } = await this.deps.userStore.list(tenantId, params);
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: total,
      startIndex: params.startIndex,
      itemsPerPage: records.length,
      Resources: records,
    };
  }

  // ── Group operations ───────────────────────────────────────────────

  async createGroup(
    tenantId: string,
    data: Omit<SCIMGroupRecord, 'id' | 'tenantId' | 'members' | 'memberCount' | 'createdAt' | 'updatedAt'>,
    memberIds: string[] = [],
  ): Promise<SCIMGroupRecord> {
    if (data.externalId) {
      const existing = await this.deps.groupStore.getByExternalId(tenantId, data.externalId);
      if (existing) return existing;
    }
    const group = await this.deps.groupStore.create(tenantId, data);
    if (memberIds.length > 0) {
      await this.deps.groupStore.syncMembers(group.id, memberIds);
    }
    await this.deps.auditLogger.log({
      eventType: 'SCIM_GROUP_CREATED',
      tenantId,
      details: { groupId: group.id, displayName: group.displayName },
    });
    await this.deps.eventProducer.send(TOPICS.IDENTITY_EVENTS, {
      type: 'group.created', tenantId, groupId: group.id,
    }).catch(() => undefined);
    return { ...group, memberCount: memberIds.length };
  }

  async getGroup(tenantId: string, id: string): Promise<SCIMGroupRecord | null> {
    return this.deps.groupStore.getById(tenantId, id);
  }

  /** PUT /Groups/:id — full replace including member sync */
  async updateGroup(
    tenantId: string,
    id: string,
    data: Partial<Pick<SCIMGroupRecord, 'displayName' | 'externalId' | 'externalSource'>>,
    memberIds: string[],
  ): Promise<SCIMGroupRecord | null> {
    const group = await this.deps.groupStore.update(tenantId, id, data);
    if (!group) return null;
    await this.deps.groupStore.syncMembers(id, memberIds);
    await this.deps.auditLogger.log({
      eventType: 'SCIM_GROUP_UPDATED',
      tenantId,
      details: { groupId: id },
    });
    await this.deps.eventProducer.send(TOPICS.IDENTITY_EVENTS, {
      type: 'group.updated', tenantId, groupId: id,
    }).catch(() => undefined);
    return { ...group, members: memberIds.map((v) => ({ value: v })), memberCount: memberIds.length };
  }

  /** PATCH /Groups/:id — apply PatchOps (add/remove members, replace displayName) */
  async patchGroup(
    tenantId: string,
    id: string,
    patch: SCIMPatchRequest,
  ): Promise<SCIMGroupRecord | null> {
    const group = await this.deps.groupStore.getById(tenantId, id);
    if (!group) return null;

    for (const op of patch.Operations) {
      if (op.path === 'members') {
        const memberValues = (Array.isArray(op.value) ? op.value : []) as Array<{ value: string }>;
        if (op.op === 'add') {
          for (const m of memberValues) {
            await this.deps.groupStore.addMember(id, m.value);
          }
        } else if (op.op === 'remove') {
          for (const m of memberValues) {
            await this.deps.groupStore.removeMember(id, m.value);
          }
        }
      } else if (op.path === 'displayName' && op.op === 'replace') {
        await this.deps.groupStore.update(tenantId, id, { displayName: op.value as string });
      }
    }

    await this.deps.auditLogger.log({
      eventType: 'SCIM_GROUP_PATCHED',
      tenantId,
      details: { groupId: id, opsCount: patch.Operations.length },
    });
    return this.deps.groupStore.getById(tenantId, id);
  }

  async deleteGroup(tenantId: string, id: string): Promise<void> {
    await this.deps.groupStore.delete(tenantId, id);
    await this.deps.auditLogger.log({
      eventType: 'SCIM_GROUP_DELETED',
      tenantId,
      details: { groupId: id },
    });
    await this.deps.eventProducer.send(TOPICS.IDENTITY_EVENTS, {
      type: 'group.deleted', tenantId, groupId: id,
    }).catch(() => undefined);
  }

  async listGroups(
    tenantId: string,
    params: SCIMListParams,
  ): Promise<SCIMListResponse<SCIMGroupRecord>> {
    const { records, total } = await this.deps.groupStore.list(tenantId, params);
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: total,
      startIndex: params.startIndex,
      itemsPerPage: records.length,
      Resources: records,
    };
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/handler.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/scim/handler.ts packages/auth/src/scim/__tests__/handler.test.ts
git commit -m "feat(scim): Phase 56 Task 8 — SCIMHandler all 10 ops + atomic deprovisioning cascade"
```

---

### Task 9: WorkOS Event Normaliser

**Files:**
- Create: `packages/auth/src/scim/workos-normaliser.ts`
- Create: `packages/auth/src/scim/__tests__/workos-normaliser.test.ts`

- [ ] **Step 1: Write failing tests for all 8 event types**

```typescript
// packages/auth/src/scim/__tests__/workos-normaliser.test.ts
import { describe, it, expect, vi } from 'vitest';
import { normaliseWorkOSEvent } from '../workos-normaliser';
import type { SCIMHandler } from '../handler';

function makeHandler(): SCIMHandler {
  return {
    createUser: vi.fn().mockResolvedValue({ id: 'u1' }),
    updateUser: vi.fn().mockResolvedValue({ id: 'u1' }),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    createGroup: vi.fn().mockResolvedValue({ id: 'g1' }),
    updateGroup: vi.fn().mockResolvedValue({ id: 'g1' }),
    deleteGroup: vi.fn().mockResolvedValue(undefined),
    patchGroup: vi.fn().mockResolvedValue({ id: 'g1' }),
    getUser: vi.fn().mockResolvedValue(null),
    getGroup: vi.fn().mockResolvedValue(null),
    listUsers: vi.fn().mockResolvedValue({ Resources: [] }),
    listGroups: vi.fn().mockResolvedValue({ Resources: [] }),
  } as unknown as SCIMHandler;
}

describe('normaliseWorkOSEvent', () => {
  it('dsync.user.created → createUser', async () => {
    const handler = makeHandler();
    await normaliseWorkOSEvent('t1', { event: 'dsync.user.created', data: { id: 'wu1', username: 'alice@example.com', first_name: 'Alice', last_name: 'Smith', emails: [{ value: 'alice@example.com', primary: true }], state: 'active' } }, handler);
    expect(handler.createUser).toHaveBeenCalledWith('t1', expect.objectContaining({ userName: 'alice@example.com' }));
  });

  it('dsync.user.updated → updateUser', async () => {
    const handler = makeHandler();
    await normaliseWorkOSEvent('t1', { event: 'dsync.user.updated', data: { id: 'wu1', username: 'alice@example.com', first_name: 'Alice', last_name: 'Smith', emails: [{ value: 'alice@example.com', primary: true }], state: 'active' } }, handler);
    expect(handler.updateUser).toHaveBeenCalled();
  });

  it('dsync.user.deleted → deleteUser', async () => {
    const handler = makeHandler();
    await normaliseWorkOSEvent('t1', { event: 'dsync.user.deleted', data: { id: 'wu1' } }, handler);
    expect(handler.deleteUser).toHaveBeenCalledWith('t1', 'wu1');
  });

  it('dsync.group.created → createGroup', async () => {
    const handler = makeHandler();
    await normaliseWorkOSEvent('t1', { event: 'dsync.group.created', data: { id: 'wg1', name: 'Admins', users: [] } }, handler);
    expect(handler.createGroup).toHaveBeenCalledWith('t1', expect.objectContaining({ displayName: 'Admins' }), []);
  });

  it('dsync.group.updated → updateGroup', async () => {
    const handler = makeHandler();
    await normaliseWorkOSEvent('t1', { event: 'dsync.group.updated', data: { id: 'wg1', name: 'Admins', users: [{ id: 'wu1' }] } }, handler);
    expect(handler.updateGroup).toHaveBeenCalledWith('t1', 'wg1', expect.objectContaining({ displayName: 'Admins' }), ['wu1']);
  });

  it('dsync.group.deleted → deleteGroup', async () => {
    const handler = makeHandler();
    await normaliseWorkOSEvent('t1', { event: 'dsync.group.deleted', data: { id: 'wg1' } }, handler);
    expect(handler.deleteGroup).toHaveBeenCalledWith('t1', 'wg1');
  });

  it('dsync.group.user.added → patchGroup add', async () => {
    const handler = makeHandler();
    await normaliseWorkOSEvent('t1', { event: 'dsync.group.user.added', data: { group: { id: 'wg1' }, user: { id: 'wu1' } } }, handler);
    expect(handler.patchGroup).toHaveBeenCalledWith('t1', 'wg1', expect.objectContaining({ Operations: [expect.objectContaining({ op: 'add' })] }));
  });

  it('dsync.group.user.removed → patchGroup remove', async () => {
    const handler = makeHandler();
    await normaliseWorkOSEvent('t1', { event: 'dsync.group.user.removed', data: { group: { id: 'wg1' }, user: { id: 'wu1' } } }, handler);
    expect(handler.patchGroup).toHaveBeenCalledWith('t1', 'wg1', expect.objectContaining({ Operations: [expect.objectContaining({ op: 'remove' })] }));
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/workos-normaliser.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement workos-normaliser.ts**

```typescript
// packages/auth/src/scim/workos-normaliser.ts
import type { SCIMHandler } from './handler';

interface WorkOSUserPayload {
  id: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  emails?: Array<{ value: string; primary: boolean }>;
  state?: string;
}

interface WorkOSGroupPayload {
  id: string;
  name?: string;
  users?: Array<{ id: string }>;
}

interface WorkOSEvent {
  event: string;
  data: Record<string, unknown>;
}

export async function normaliseWorkOSEvent(
  tenantId: string,
  event: WorkOSEvent,
  handler: SCIMHandler,
): Promise<void> {
  switch (event.event) {
    case 'dsync.user.created': {
      const u = event.data as WorkOSUserPayload;
      await handler.createUser(tenantId, {
        externalId: u.id,
        externalSource: 'workos',
        userName: u.username ?? u.emails?.[0]?.value ?? u.id,
        displayName: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.id,
        emails: u.emails ?? [],
        active: u.state !== 'inactive',
      });
      break;
    }
    case 'dsync.user.updated': {
      const u = event.data as WorkOSUserPayload;
      await handler.updateUser(tenantId, u.id, {
        displayName: [u.first_name, u.last_name].filter(Boolean).join(' ') || undefined,
        emails: u.emails,
        active: u.state !== 'inactive',
      });
      break;
    }
    case 'dsync.user.deleted': {
      const u = event.data as { id: string };
      await handler.deleteUser(tenantId, u.id);
      break;
    }
    case 'dsync.group.created': {
      const g = event.data as WorkOSGroupPayload;
      await handler.createGroup(
        tenantId,
        { displayName: g.name ?? g.id, externalId: g.id, externalSource: 'workos' },
        (g.users ?? []).map((u) => u.id),
      );
      break;
    }
    case 'dsync.group.updated': {
      const g = event.data as WorkOSGroupPayload;
      await handler.updateGroup(
        tenantId,
        g.id,
        { displayName: g.name, externalId: g.id, externalSource: 'workos' },
        (g.users ?? []).map((u) => u.id),
      );
      break;
    }
    case 'dsync.group.deleted': {
      const g = event.data as { id: string };
      await handler.deleteGroup(tenantId, g.id);
      break;
    }
    case 'dsync.group.user.added': {
      const d = event.data as { group: { id: string }; user: { id: string } };
      await handler.patchGroup(tenantId, d.group.id, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'add', path: 'members', value: [{ value: d.user.id }] }],
      });
      break;
    }
    case 'dsync.group.user.removed': {
      const d = event.data as { group: { id: string }; user: { id: string } };
      await handler.patchGroup(tenantId, d.group.id, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'remove', path: 'members', value: [{ value: d.user.id }] }],
      });
      break;
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/auth && npx vitest run src/scim/__tests__/workos-normaliser.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/scim/workos-normaliser.ts packages/auth/src/scim/__tests__/workos-normaliser.test.ts
git commit -m "feat(scim): Phase 56 Task 9 — WorkOS event normaliser for 8 dsync event types"
```

---

## Chunk 5: Route Wiring + Server Integration

### Task 10: scim/index.ts, Delete Old scim.ts, Update Auth Re-exports

**Files:**
- Create: `packages/auth/src/scim/index.ts`
- Delete: `packages/auth/src/scim.ts` (old monolith)
- Modify: `packages/auth/src/index.ts` — update exports

- [ ] **Step 1: Create scim/index.ts barrel**

```typescript
// packages/auth/src/scim/index.ts
export { SCIMHandler } from './handler';
export type { SCIMHandlerDeps, AuditLogger } from './handler';
export { DrizzleUserStore } from './user-store';
export { DrizzleGroupStore } from './group-store';
export { DrizzleTokenStore } from './token-store';
export { normaliseWorkOSEvent } from './workos-normaliser';
export { parseSCIMFilter } from './filters';
export type {
  SCIMUserRecord, SCIMGroupRecord, SCIMGroupMember, SCIMEmail,
  SCIMPatchOp, SCIMPatchRequest, SCIMFilter, SCIMListParams, SCIMListResponse,
  SCIMUserStore, SCIMGroupStore, SCIMTokenStore,
} from './types';
```

- [ ] **Step 2: Update packages/auth/src/index.ts to export from new path**

Replace any existing `export * from './scim'` or individual scim exports with:

```typescript
export * from './scim/index';
```

- [ ] **Step 3: Delete old scim.ts**

```bash
rm packages/auth/src/scim.ts
```

- [ ] **Step 4: Run type-check**

```bash
cd packages/auth && npx tsc --noEmit
```

Expected: No type errors. If there are import errors referencing the old `scim.ts`, fix them by updating imports to use the new module paths.

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/scim/index.ts packages/auth/src/index.ts
git rm packages/auth/src/scim.ts
git commit -m "feat(scim): Phase 56 Task 10 — scim/index.ts barrel, delete old monolith, update exports"
```

---

### Task 11: SCIM Route Updates — Method Renames + Full Group Routes

**Files:**
- Modify: `apps/api/src/routes/scim.ts`

- [ ] **Step 1: Read the current scim.ts routes file**

Read `apps/api/src/routes/scim.ts` to understand current structure before modifying.

- [ ] **Step 2: Write the failing test (route completeness)**

```typescript
// apps/api/src/routes/__tests__/scim-groups.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createSCIMRouter } from '../scim';
// ... (integration test verifying all 5 Group routes exist and call correct handler methods)

describe('SCIM Group routes', () => {
  it('GET /Groups returns list', async () => {
    // stub handler.listGroups, verify it is called
  });
  it('POST /Groups creates group', async () => {
    // stub handler.createGroup, verify it is called
  });
  it('GET /Groups/:id gets single group', async () => {
    // stub handler.getGroup, verify it is called
  });
  it('PUT /Groups/:id calls updateGroup (full replace)', async () => {
    // stub handler.updateGroup, verify it is called (NOT patchGroup)
  });
  it('PATCH /Groups/:id calls patchGroup (PatchOps)', async () => {
    // stub handler.patchGroup, verify it is called (NOT updateGroup)
  });
  it('DELETE /Groups/:id calls deleteGroup', async () => {
    // stub handler.deleteGroup, verify it is called
  });
});
```

Note: Implement the test stubs with actual Hono test calls. Use the same pattern as existing route tests in the codebase.

- [ ] **Step 3: Run tests to confirm they fail for missing routes**

```bash
cd apps/api && npx vitest run src/routes/__tests__/scim-groups.test.ts
```

Expected: FAIL — missing GET /Groups/:id, PUT /Groups/:id, DELETE /Groups/:id.

- [ ] **Step 4: Update the routes file**

Method rename table to apply in the routes:

| Old call | New call |
|---|---|
| `handler.handleCreateUser` | `handler.createUser` |
| `handler.handleUpdateUser` | `handler.updateUser` |
| `handler.handleDeactivateUser` | `handler.deleteUser` |
| `handler.handleListUsers` | `handler.listUsers` |
| `handler.handleGetUser` | `handler.getUser` |
| `handler.handleCreateGroup` | `handler.createGroup` |
| `handler.handleUpdateGroup` (on PATCH) | `handler.patchGroup` |

New routes to add:
- `GET /Groups` → `handler.listGroups`
- `GET /Groups/:id` → `handler.getGroup`
- `PUT /Groups/:id` → `handler.updateGroup` (full replace, extracts memberIds from body)
- `DELETE /Groups/:id` → `handler.deleteGroup`

The SCIM token verification middleware stays — update it to use `DrizzleTokenStore` instead of any in-memory store.

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd apps/api && npx vitest run src/routes/__tests__/scim-groups.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/scim.ts apps/api/src/routes/__tests__/scim-groups.test.ts
git commit -m "feat(api): Phase 56 Task 11 — SCIM routes method renames + full Group CRUD"
```

---

### Task 12: WorkOS Webhook Route + Server Wiring

**Files:**
- Create: `apps/api/src/routes/webhooks-workos.ts`
- Create: `apps/api/src/routes/__tests__/webhooks-workos.test.ts`
- Modify: `apps/api/src/server.ts` — register webhook route, wire Drizzle stores into SCIMHandler

- [ ] **Step 1: Write failing tests for HMAC verification**

```typescript
// apps/api/src/routes/__tests__/webhooks-workos.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'crypto';
import { Hono } from 'hono';
import { createWorkOSWebhookRouter } from '../webhooks-workos';

const WEBHOOK_SECRET = 'test-secret-32-bytes-padding-xxxx';

function signBody(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

describe('POST /webhooks/workos', () => {
  it('returns 401 when signature is missing', async () => {
    const app = new Hono();
    app.route('/', createWorkOSWebhookRouter({ webhookSecret: WEBHOOK_SECRET, handler: { createUser: vi.fn() } as never, tokenStore: { findByToken: vi.fn() } as never, db: {} as never }));
    const res = await app.request('/webhooks/workos', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when signature is invalid', async () => {
    const app = new Hono();
    app.route('/', createWorkOSWebhookRouter({ webhookSecret: WEBHOOK_SECRET, handler: {} as never, tokenStore: {} as never, db: {} as never }));
    const res = await app.request('/webhooks/workos', {
      method: 'POST',
      headers: { 'x-workos-signature': 'badhex' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('returns 200 for a valid signed request', async () => {
    const body = JSON.stringify({ id: 'evt_1', event: 'dsync.user.created', data: { id: 'wu1', username: 'alice@example.com', emails: [], state: 'active' } });
    const sig = signBody(body);
    const handler = { createUser: vi.fn().mockResolvedValue({ id: 'u1' }) } as never;
    const tokenStore = { findByDirectoryId: vi.fn().mockResolvedValue({ tenantId: 't1' }) } as never;
    const db = { insert: vi.fn().mockReturnThis(), values: vi.fn().mockResolvedValue([]) } as never;
    const app = new Hono();
    app.route('/', createWorkOSWebhookRouter({ webhookSecret: WEBHOOK_SECRET, handler, tokenStore, db }));
    const res = await app.request('/webhooks/workos', {
      method: 'POST',
      headers: { 'x-workos-signature': sig, 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(200);
  });

  it('returns 409 for a duplicate workos_id', async () => {
    const body = JSON.stringify({ id: 'evt_dup', event: 'dsync.user.deleted', data: { id: 'wu1' } });
    const sig = signBody(body);
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ workosId: 'evt_dup' }]), // already exists
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue([]),
    } as never;
    const app = new Hono();
    app.route('/', createWorkOSWebhookRouter({ webhookSecret: WEBHOOK_SECRET, handler: {} as never, tokenStore: {} as never, db }));
    const res = await app.request('/webhooks/workos', {
      method: 'POST',
      headers: { 'x-workos-signature': sig, 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(200); // idempotent — already processed, return 200 not error
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && npx vitest run src/routes/__tests__/webhooks-workos.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement webhooks-workos.ts**

```typescript
// apps/api/src/routes/webhooks-workos.ts
import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { workosEvents } from '@ordr/db';
import type { SCIMHandler } from '@ordr/auth';
import type { SCIMTokenStore } from '@ordr/auth';
import { normaliseWorkOSEvent } from '@ordr/auth';

interface WorkOSWebhookDeps {
  webhookSecret: string;
  handler: SCIMHandler;
  tokenStore: SCIMTokenStore;
  db: NodePgDatabase;
}

export function createWorkOSWebhookRouter(deps: WorkOSWebhookDeps): Hono {
  const app = new Hono();

  app.post('/webhooks/workos', async (c) => {
    // 1. HMAC verification (timing-safe, Rule 1 + Rule 4)
    const sigHeader = c.req.header('x-workos-signature');
    if (!sigHeader) return c.json({ error: 'Missing signature' }, 401);

    const rawBody = await c.req.text();
    const expected = createHmac('sha256', deps.webhookSecret).update(rawBody).digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(sigHeader, 'hex');
    } catch {
      return c.json({ error: 'Invalid signature format' }, 401);
    }
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // 2. Parse event
    let event: { id: string; event: string; data: Record<string, unknown>; directory_id?: string };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    // 3. Idempotency check
    const existing = await deps.db
      .select({ workosId: workosEvents.workosId })
      .from(workosEvents)
      .where(eq(workosEvents.workosId, event.id));
    if (existing.length > 0) {
      return c.json({ ok: true, skipped: 'duplicate' }, 200);
    }

    // 4. Resolve tenant via directoryId (uses findByDirectoryId — NOT findByToken)
    const directoryId = event.directory_id ?? (event.data?.directory_id as string | undefined);
    let tenantId: string | null = null;
    if (directoryId) {
      const tokenRow = await deps.tokenStore.findByDirectoryId(directoryId);
      tenantId = tokenRow?.tenantId ?? null;
    }
    if (!tenantId) {
      return c.json({ error: 'Unknown directory' }, 422);
    }

    // 5. Record event (WORM insert)
    await deps.db.insert(workosEvents).values({
      workosId: event.id,
      eventType: event.event,
      directoryId: directoryId ?? null,
      payload: event,
    });

    // 6. Normalise and dispatch to SCIMHandler
    await normaliseWorkOSEvent(tenantId, event, deps.handler);

    return c.json({ ok: true }, 200);
  });

  return app;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && npx vitest run src/routes/__tests__/webhooks-workos.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Wire into server.ts**

In `apps/api/src/server.ts`:

1. Import `DrizzleUserStore`, `DrizzleGroupStore`, `DrizzleTokenStore`, `SCIMHandler` from `@ordr/auth`
2. Import `createWorkOSWebhookRouter` from `./routes/webhooks-workos`
3. After database initialization, construct the stores and handler:

```typescript
const scimUserStore = new DrizzleUserStore(db);
const scimGroupStore = new DrizzleGroupStore(db);
const scimTokenStore = new DrizzleTokenStore(db);
const scimHandler = new SCIMHandler({
  userStore: scimUserStore,
  groupStore: scimGroupStore,
  db,
  eventProducer,
  auditLogger,
});
```

4. Register the webhook route:

```typescript
app.route('/', createWorkOSWebhookRouter({
  webhookSecret: env.WORKOS_WEBHOOK_SECRET,
  handler: scimHandler,
  tokenStore: scimTokenStore,
  db,
}));
```

5. Update the SCIM routes registration to pass `scimHandler` (replacing any inline handler construction).

6. Add `WORKOS_WEBHOOK_SECRET` to the Zod env schema in `apps/api/src/config.ts` (or equivalent):

```typescript
WORKOS_WEBHOOK_SECRET: z.string().min(32),
```

- [ ] **Step 6: Run type-check on server.ts**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Run full test suite**

```bash
cd apps/api && npx vitest run
cd packages/auth && npx vitest run
```

Expected: All tests pass. Check test count is >= prior baseline.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/webhooks-workos.ts apps/api/src/routes/__tests__/webhooks-workos.test.ts apps/api/src/server.ts apps/api/src/config.ts
git commit -m "feat(api): Phase 56 Task 12 — WorkOS webhook route + server wiring (HMAC + WORM + Drizzle stores)"
```

---

## Final: Full Test Run + Finish

- [ ] **Run the complete test suite**

```bash
cd apps/api && npx vitest run
cd packages/auth && npx vitest run
cd packages/db && npx vitest run
cd packages/events && npx vitest run
```

Expected: All tests pass with no regressions.

- [ ] **Run type-check across all modified packages**

```bash
npx tsc --build --noEmit
```

- [ ] **Invoke superpowers:finishing-a-development-branch**

Present completion status and options for merging/pushing.
