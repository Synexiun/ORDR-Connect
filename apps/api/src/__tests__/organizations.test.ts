/**
 * Organization Route Tests — /api/v1/organizations endpoints
 *
 * Tests CRUD operations, hierarchy traversal, and admin-only enforcement.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { organizationsRouter, configureOrgRoutes } from '../routes/organizations.js';
import { configureAuth } from '../middleware/auth.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import {
  OrganizationManager,
  InMemoryOrgStore,
  loadKeyPair,
  createAccessToken,
} from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { generateKeyPair } from '@ordr/crypto';

// ─── Fixtures ─────────────────────────────────────────────────────

let jwtConfig: JwtConfig;

async function makeJwt(overrides: {
  readonly sub?: string;
  readonly tid?: string;
  readonly role?: string;
} = {}): Promise<string> {
  return createAccessToken(jwtConfig, {
    sub: overrides.sub ?? 'user-001',
    tid: overrides.tid ?? 'tenant-001',
    role: (overrides.role ?? 'tenant_admin') as 'tenant_admin',
    permissions: [],
  });
}

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/api/v1/organizations', organizationsRouter);
  return app;
}

// ─── Setup ────────────────────────────────────────────────────────

beforeEach(async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  jwtConfig = await loadKeyPair(privateKey, publicKey, {
    issuer: 'ordr-connect',
    audience: 'ordr-connect',
  });

  configureAuth(jwtConfig);

  const store = new InMemoryOrgStore();
  const orgManager = new OrganizationManager(store);
  const auditStore = new InMemoryAuditStore();
  const auditLogger = new AuditLogger(auditStore);

  configureOrgRoutes({ orgManager, auditLogger });
});

// ─── Auth Tests ───────────────────────────────────────────────────

describe('Organization auth enforcement', () => {
  it('returns 401 without authentication', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/organizations');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin on POST', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'viewer' });
    const res = await app.request('/api/v1/organizations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Test', slug: 'test' }),
    });
    expect(res.status).toBe(403);
  });
});

// ─── CRUD Tests ───────────────────────────────────────────────────

describe('Organization CRUD', () => {
  it('GET / lists organizations', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/organizations', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('POST / creates an organization', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/organizations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Engineering', slug: 'engineering' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: { name: string; slug: string } };
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Engineering');
    expect(body.data.slug).toBe('engineering');
  });

  it('GET /:id returns 404 for non-existent org', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/organizations/no-such-id', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('full CRUD cycle: create, get, update, delete', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Create
    const createRes = await app.request('/api/v1/organizations', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Test', slug: 'test' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { data: { id: string } };

    // Get
    const getRes = await app.request(`/api/v1/organizations/${created.data.id}`, { headers });
    expect(getRes.status).toBe(200);

    // Update
    const updateRes = await app.request(`/api/v1/organizations/${created.data.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as { data: { name: string } };
    expect(updated.data.name).toBe('Updated');

    // Delete
    const deleteRes = await app.request(`/api/v1/organizations/${created.data.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(deleteRes.status).toBe(200);
  });
});

// ─── Hierarchy Tests ──────────────────────────────────────────────

describe('Organization hierarchy', () => {
  it('GET /:id/hierarchy returns 404 for non-existent org', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/organizations/no-such/hierarchy', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('returns hierarchy tree for an org', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Create parent
    const parentRes = await app.request('/api/v1/organizations', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Root', slug: 'root' }),
    });
    const parent = (await parentRes.json()) as { data: { id: string } };

    // Get hierarchy
    const hierarchyRes = await app.request(
      `/api/v1/organizations/${parent.data.id}/hierarchy`,
      { headers },
    );
    expect(hierarchyRes.status).toBe(200);
    const body = (await hierarchyRes.json()) as {
      success: boolean;
      data: { org: { name: string }; children: unknown[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.org.name).toBe('Root');
  });
});

// ─── Validation Tests ─────────────────────────────────────────────

describe('Organization input validation', () => {
  it('rejects invalid slug format', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/organizations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Test', slug: 'INVALID SLUG' }),
    });
    expect(res.status).toBe(400);
  });
});
