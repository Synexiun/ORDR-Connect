/**
 * SCIM Route Tests — /api/v1/scim endpoints
 *
 * Tests bearer token auth, CRUD operations, and SCIM response format.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { scimRouter, configureSCIMRoutes } from '../routes/scim.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import {
  SCIMHandler,
  InMemoryUserStore,
  InMemoryGroupStore,
  InMemorySCIMTokenStore,
  SCIM_SCHEMAS,
} from '@ordr/auth';
import type { SessionRevoker } from '@ordr/auth';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { sha256 } from '@ordr/crypto';

// ─── Fixtures ─────────────────────────────────────────────────────

const TEST_TOKEN = 'scim-test-bearer-token-12345';
const TOKEN_HASH = sha256(TEST_TOKEN);

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/api/v1/scim', scimRouter);
  return app;
}

// ─── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
  const userStore = new InMemoryUserStore();
  const groupStore = new InMemoryGroupStore();
  const auditStore = new InMemoryAuditStore();
  const auditLogger = new AuditLogger(auditStore);
  const sessionRevoker: SessionRevoker = {
    revokeByUserId: vi.fn().mockResolvedValue(undefined),
  };

  const handler = new SCIMHandler({
    userStore,
    groupStore,
    sessionRevoker,
    auditLogger,
  });

  const tokenStore = new InMemorySCIMTokenStore();
  tokenStore.addToken({
    id: 'token-001',
    tenantId: 'tenant-001',
    tokenHash: TOKEN_HASH,
    description: 'Test SCIM token',
    expiresAt: null,
    lastUsedAt: null,
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
        schemas: [SCIM_SCHEMAS.USER],
        userName: 'alice@corp.test',
        name: { givenName: 'Alice', familyName: 'Smith' },
        emails: [{ value: 'alice@corp.test', primary: true }],
        active: true,
        externalId: 'ext-001',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { schemas: string[]; userName: string; id: string };
    expect(body.schemas).toContain(SCIM_SCHEMAS.USER);
    expect(body.userName).toBe('alice@corp.test');
    expect(body.id).toBeDefined();
  });

  it('GET /Users lists users', async () => {
    const app = createTestApp();

    // Create a user first
    await app.request('/api/v1/scim/Users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMAS.USER],
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
    expect(body.schemas).toContain(SCIM_SCHEMAS.LIST);
    expect(body.totalResults).toBe(1);
  });

  it('GET /Users/:id gets a user', async () => {
    const app = createTestApp();

    // Create a user first
    const createRes = await app.request('/api/v1/scim/Users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMAS.USER],
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
        schemas: [SCIM_SCHEMAS.USER],
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
        schemas: [SCIM_SCHEMAS.USER],
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
        schemas: [SCIM_SCHEMAS.USER],
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
    expect(body.schemas).toContain(SCIM_SCHEMAS.ERROR);
    expect(body.detail).toBeDefined();
  });
});

// ─── Groups Tests ─────────────────────────────────────────────────

describe('SCIM Groups', () => {
  it('POST /Groups creates a group', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/scim/Groups', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemas: [SCIM_SCHEMAS.GROUP],
        displayName: 'Engineering',
        members: [{ value: 'user-1', display: 'User 1' }],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { displayName: string; schemas: string[] };
    expect(body.displayName).toBe('Engineering');
    expect(body.schemas).toContain(SCIM_SCHEMAS.GROUP);
  });
});
