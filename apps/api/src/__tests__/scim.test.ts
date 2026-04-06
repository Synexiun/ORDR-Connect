/**
 * SCIM Route Tests — /api/v1/scim endpoints
 *
 * Tests bearer token auth, CRUD operations, and SCIM response format.
 *
 * Local in-memory test doubles replace the deleted InMemory* classes
 * that were part of the old scim.ts monolith.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { scimRouter, configureSCIMRoutes } from '../routes/scim.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import { SCIMHandler } from '@ordr/auth';
import type {
  SCIMUserStore,
  SCIMGroupStore,
  SCIMTokenStore,
  SCIMUserRecord,
  SCIMGroupRecord,
  SCIMListParams,
  SCIMGroupMember,
} from '@ordr/auth';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { sha256 } from '@ordr/crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { EventProducer } from '@ordr/events';

// ─── Local SCIM schema URNs ────────────────────────────────────────

const SCIM_SCHEMA_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_SCHEMA_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCIM_SCHEMA_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_SCHEMA_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const SCIM_SCHEMA_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

// ─── Fixtures ─────────────────────────────────────────────────────

const TEST_TOKEN = 'scim-test-bearer-token-12345';
const TEST_TENANT = 'tenant-001';
const TOKEN_HASH = sha256(TEST_TOKEN);

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/api/v1/scim', scimRouter);
  return app;
}

// ─── Local In-Memory Test Doubles ─────────────────────────────────

function makeId(): string {
  return `id-${Math.random().toString(36).slice(2)}`;
}

class InMemoryUserStore implements SCIMUserStore {
  private readonly store = new Map<string, SCIMUserRecord>();

  create(
    tenantId: string,
    record: Omit<SCIMUserRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<SCIMUserRecord> {
    const now = new Date();
    const user: SCIMUserRecord = {
      ...record,
      id: makeId(),
      tenantId,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(user.id, user);
    return Promise.resolve(user);
  }

  getById(tenantId: string, id: string): Promise<SCIMUserRecord | null> {
    const user = this.store.get(id);
    if (!user || user.tenantId !== tenantId) return Promise.resolve(null);
    return Promise.resolve(user);
  }

  getByExternalId(tenantId: string, externalId: string): Promise<SCIMUserRecord | null> {
    for (const user of this.store.values()) {
      if (user.tenantId === tenantId && user.externalId === externalId) {
        return Promise.resolve(user);
      }
    }
    return Promise.resolve(null);
  }

  getByUserName(tenantId: string, userName: string): Promise<SCIMUserRecord | null> {
    for (const user of this.store.values()) {
      if (user.tenantId === tenantId && user.userName === userName) {
        return Promise.resolve(user);
      }
    }
    return Promise.resolve(null);
  }

  update(
    tenantId: string,
    id: string,
    patch: Partial<SCIMUserRecord>,
  ): Promise<SCIMUserRecord | null> {
    const user = this.store.get(id);
    if (!user || user.tenantId !== tenantId) return Promise.resolve(null);
    const updated: SCIMUserRecord = { ...user, ...patch, updatedAt: new Date() };
    this.store.set(id, updated);
    return Promise.resolve(updated);
  }

  list(
    tenantId: string,
    params: SCIMListParams,
  ): Promise<{ records: SCIMUserRecord[]; total: number }> {
    let records = Array.from(this.store.values()).filter((u) => u.tenantId === tenantId);

    if (params.filter) {
      const { field, operator, value } = params.filter;
      if (operator === 'eq' && value !== undefined) {
        records = records.filter((u) => {
          if (field === 'userName') return u.userName === value;
          if (field === 'externalId') return u.externalId === value;
          return true;
        });
      }
    }

    const total = records.length;
    const start = Math.max(params.startIndex - 1, 0);
    const sliced = records.slice(start, start + params.count);
    return Promise.resolve({ records: sliced, total });
  }
}

class InMemoryGroupStore implements SCIMGroupStore {
  private readonly store = new Map<string, SCIMGroupRecord>();
  private readonly members = new Map<string, Set<string>>();

  create(
    tenantId: string,
    record: Omit<
      SCIMGroupRecord,
      'id' | 'tenantId' | 'members' | 'memberCount' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<SCIMGroupRecord> {
    const now = new Date();
    const group: SCIMGroupRecord = {
      ...record,
      id: makeId(),
      tenantId,
      members: [],
      memberCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(group.id, group);
    this.members.set(group.id, new Set());
    return Promise.resolve(group);
  }

  getById(tenantId: string, id: string): Promise<SCIMGroupRecord | null> {
    const group = this.store.get(id);
    if (!group || group.tenantId !== tenantId) return Promise.resolve(null);
    return Promise.resolve(this.hydrate(group));
  }

  getByExternalId(tenantId: string, externalId: string): Promise<SCIMGroupRecord | null> {
    for (const group of this.store.values()) {
      if (group.tenantId === tenantId && group.externalId === externalId) {
        return Promise.resolve(this.hydrate(group));
      }
    }
    return Promise.resolve(null);
  }

  update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<SCIMGroupRecord, 'displayName' | 'externalId' | 'externalSource'>>,
  ): Promise<SCIMGroupRecord | null> {
    const group = this.store.get(id);
    if (!group || group.tenantId !== tenantId) return Promise.resolve(null);
    const updated: SCIMGroupRecord = { ...group, ...patch, updatedAt: new Date() };
    this.store.set(id, updated);
    return Promise.resolve(this.hydrate(updated));
  }

  delete(tenantId: string, id: string): Promise<void> {
    const group = this.store.get(id);
    if (group?.tenantId === tenantId) {
      this.store.delete(id);
      this.members.delete(id);
    }
    return Promise.resolve();
  }

  syncMembers(groupId: string, userIds: string[]): Promise<void> {
    this.members.set(groupId, new Set(userIds));
    this.refreshMemberCount(groupId);
    return Promise.resolve();
  }

  addMember(groupId: string, userId: string): Promise<void> {
    const existing = this.members.get(groupId);
    const set = existing ?? new Set<string>();
    set.add(userId);
    if (existing === undefined) {
      this.members.set(groupId, set);
    }
    this.refreshMemberCount(groupId);
    return Promise.resolve();
  }

  removeMember(groupId: string, userId: string): Promise<void> {
    const set = this.members.get(groupId);
    if (set) {
      set.delete(userId);
      this.refreshMemberCount(groupId);
    }
    return Promise.resolve();
  }

  list(
    tenantId: string,
    params: SCIMListParams,
  ): Promise<{ records: SCIMGroupRecord[]; total: number }> {
    const all = Array.from(this.store.values())
      .filter((g) => g.tenantId === tenantId)
      .map((g) => this.hydrate(g));
    const total = all.length;
    const start = Math.max(params.startIndex - 1, 0);
    const sliced = all.slice(start, start + params.count);
    return Promise.resolve({ records: sliced, total });
  }

  private refreshMemberCount(groupId: string): void {
    const group = this.store.get(groupId);
    if (group) {
      const count = this.members.get(groupId)?.size ?? 0;
      this.store.set(groupId, { ...group, memberCount: count });
    }
  }

  private hydrate(group: SCIMGroupRecord): SCIMGroupRecord {
    const memberSet = this.members.get(group.id) ?? new Set<string>();
    const members: SCIMGroupMember[] = Array.from(memberSet).map((v) => ({ value: v }));
    return { ...group, members, memberCount: memberSet.size };
  }
}

class InMemoryTokenStore implements SCIMTokenStore {
  private readonly tokens = new Map<string, { tenantId: string; directoryId: string | null }>();

  addToken(opts: { tokenHash: string; tenantId: string; directoryId?: string | null }): void {
    this.tokens.set(opts.tokenHash, {
      tenantId: opts.tenantId,
      directoryId: opts.directoryId ?? null,
    });
  }

  findByToken(
    hashedToken: string,
  ): Promise<{ tenantId: string; directoryId: string | null } | null> {
    return Promise.resolve(this.tokens.get(hashedToken) ?? null);
  }

  findByDirectoryId(_directoryId: string): Promise<{ tenantId: string } | null> {
    return Promise.resolve(null);
  }
}

// ─── Setup ────────────────────────────────────────────────────────

// Mock db — handler uses db.transaction for deleteUser
const mockDb = {
  transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn(mockDb)),
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  }),
  delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
} as unknown as NodePgDatabase;

const mockEventProducer = {
  publish: vi.fn().mockResolvedValue(undefined),
} as unknown as EventProducer;

beforeEach(() => {
  vi.clearAllMocks();

  const userStore = new InMemoryUserStore();
  const groupStore = new InMemoryGroupStore();
  const auditStore = new InMemoryAuditStore();
  const auditLogger = new AuditLogger(auditStore);

  const handler = new SCIMHandler({
    userStore,
    groupStore,
    db: mockDb,
    eventProducer: mockEventProducer,
    auditLogger,
  });

  const tokenStore = new InMemoryTokenStore();
  tokenStore.addToken({
    tokenHash: TOKEN_HASH,
    tenantId: TEST_TENANT,
  });

  configureSCIMRoutes({ scimHandler: handler, tokenStore });
});

// ─── Auth Tests ───────────────────────────────────────────────────

describe('SCIM bearer token auth', () => {
  it('returns 401 without authorization header', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/scim/Users');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/scim/Users', {
      headers: { Authorization: 'Bearer bad-token' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 with empty bearer token', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/scim/Users', {
      headers: { Authorization: 'Bearer ' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts valid SCIM bearer token', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/scim/Users', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });
});

// ─── Users CRUD Tests ─────────────────────────────────────────────

describe('SCIM Users CRUD', () => {
  it('POST /Users creates a user', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/scim/Users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_USER],
        userName: 'alice@corp.test',
        name: { givenName: 'Alice', familyName: 'Smith' },
        emails: [{ value: 'alice@corp.test', primary: true }],
        active: true,
        externalId: 'ext-001',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { schemas: string[]; userName: string; id: string };
    expect(body.schemas).toContain(SCIM_SCHEMA_USER);
    expect(body.userName).toBe('alice@corp.test');
    expect(body.id).toBeDefined();
  });

  it('GET /Users lists users', async () => {
    const app = createTestApp();

    await app.request('/api/v1/scim/Users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_USER],
        userName: 'alice@corp.test',
        name: { givenName: 'Alice', familyName: 'Smith' },
        emails: [{ value: 'alice@corp.test', primary: true }],
        active: true,
        externalId: 'ext-001',
      }),
    });

    const res = await app.request('/api/v1/scim/Users', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { schemas: string[]; totalResults: number };
    expect(body.schemas).toContain(SCIM_SCHEMA_LIST);
    expect(body.totalResults).toBe(1);
  });

  it('GET /Users/:id gets a user', async () => {
    const app = createTestApp();

    const createRes = await app.request('/api/v1/scim/Users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_USER],
        userName: 'bob@corp.test',
        name: { givenName: 'Bob', familyName: 'Jones' },
        emails: [{ value: 'bob@corp.test', primary: true }],
        active: true,
        externalId: 'ext-002',
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(`/api/v1/scim/Users/${created.id}`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; userName: string };
    expect(body.id).toBe(created.id);
    expect(body.userName).toBe('bob@corp.test');
  });

  it('PATCH /Users/:id updates a user', async () => {
    const app = createTestApp();

    const createRes = await app.request('/api/v1/scim/Users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_USER],
        userName: 'alice@corp.test',
        name: { givenName: 'Alice', familyName: 'Smith' },
        emails: [{ value: 'alice@corp.test', primary: true }],
        active: true,
        externalId: 'ext-003',
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(`/api/v1/scim/Users/${created.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_USER],
        userName: 'alice-updated@corp.test',
        name: { givenName: 'Alice', familyName: 'Johnson' },
        emails: [{ value: 'alice-updated@corp.test', primary: true }],
        active: true,
        externalId: 'ext-003',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { userName: string };
    expect(body.userName).toBe('alice-updated@corp.test');
  });

  it('DELETE /Users/:id deactivates a user', async () => {
    const app = createTestApp();

    const createRes = await app.request('/api/v1/scim/Users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_USER],
        userName: 'delete-me@corp.test',
        name: { givenName: 'Delete', familyName: 'Me' },
        emails: [{ value: 'delete-me@corp.test', primary: true }],
        active: true,
        externalId: 'ext-del',
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(`/api/v1/scim/Users/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(res.status).toBe(204);
  });

  it('returns SCIM error format for non-existent user', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/scim/Users/no-such-user', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { schemas: string[]; detail: string };
    expect(body.schemas).toContain(SCIM_SCHEMA_ERROR);
    expect(body.detail).toBeDefined();
  });
});

// ─── Groups CRUD Tests ────────────────────────────────────────────

describe('SCIM Groups CRUD', () => {
  it('POST /Groups creates a group', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/scim/Groups', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_GROUP],
        displayName: 'Engineering',
        members: [{ value: 'user-1', display: 'User 1' }],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { displayName: string; schemas: string[] };
    expect(body.displayName).toBe('Engineering');
    expect(body.schemas).toContain(SCIM_SCHEMA_GROUP);
  });

  it('GET /Groups lists groups', async () => {
    const app = createTestApp();

    await app.request('/api/v1/scim/Groups', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_GROUP],
        displayName: 'Design',
        members: [],
      }),
    });

    const res = await app.request('/api/v1/scim/Groups', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { schemas: string[]; totalResults: number };
    expect(body.schemas).toContain(SCIM_SCHEMA_LIST);
    expect(body.totalResults).toBe(1);
  });

  it('GET /Groups/:id gets a group', async () => {
    const app = createTestApp();

    const createRes = await app.request('/api/v1/scim/Groups', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_GROUP],
        displayName: 'Marketing',
        members: [],
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(`/api/v1/scim/Groups/${created.id}`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; displayName: string };
    expect(body.id).toBe(created.id);
    expect(body.displayName).toBe('Marketing');
  });

  it('PUT /Groups/:id full-replaces a group', async () => {
    const app = createTestApp();

    const createRes = await app.request('/api/v1/scim/Groups', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_GROUP],
        displayName: 'OldName',
        members: [],
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(`/api/v1/scim/Groups/${created.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_GROUP],
        displayName: 'NewName',
        members: [],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { displayName: string };
    expect(body.displayName).toBe('NewName');
  });

  it('PATCH /Groups/:id applies incremental PatchOps', async () => {
    const app = createTestApp();

    const createRes = await app.request('/api/v1/scim/Groups', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_GROUP],
        displayName: 'PatchTarget',
        members: [],
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(`/api/v1/scim/Groups/${created.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_PATCH],
        Operations: [{ op: 'replace', path: 'displayName', value: 'PatchedName' }],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { displayName: string };
    expect(body.displayName).toBe('PatchedName');
  });

  it('DELETE /Groups/:id deletes a group', async () => {
    const app = createTestApp();

    const createRes = await app.request('/api/v1/scim/Groups', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMA_GROUP],
        displayName: 'ToDelete',
        members: [],
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(`/api/v1/scim/Groups/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(res.status).toBe(204);
  });

  it('returns SCIM error format for non-existent group', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/scim/Groups/no-such-group', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { schemas: string[]; detail: string };
    expect(body.schemas).toContain(SCIM_SCHEMA_ERROR);
    expect(body.detail).toBeDefined();
  });
});
