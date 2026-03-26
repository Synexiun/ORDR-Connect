/**
 * Custom Role Route Tests — /api/v1/roles endpoints
 *
 * Tests CRUD operations, assign/revoke, and admin-only enforcement.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { rolesRouter, configureRoleRoutes } from '../routes/roles.js';
import { configureAuth } from '../middleware/auth.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import {
  CustomRoleManager,
  InMemoryRoleStore,
  loadKeyPair,
  createAccessToken,
} from '@ordr/auth';
import type { JwtConfig, RoleAuditLogger } from '@ordr/auth';
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
  app.route('/api/v1/roles', rolesRouter);
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

  const store = new InMemoryRoleStore();
  const auditLogger: RoleAuditLogger = {
    log: vi.fn().mockResolvedValue(undefined),
  };
  const roleManager = new CustomRoleManager(store, auditLogger);

  configureRoleRoutes({ roleManager });
});

// ─── Auth Tests ───────────────────────────────────────────────────

describe('Role auth enforcement', () => {
  it('returns 401 without authentication', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/roles');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin on POST', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'viewer' });
    const res = await app.request('/api/v1/roles', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Test Role',
        baseRole: 'agent',
        permissions: [],
      }),
    });
    expect(res.status).toBe(403);
  });
});

// ─── CRUD Tests ───────────────────────────────────────────────────

describe('Role CRUD', () => {
  it('GET / lists roles', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/roles', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('POST / creates a role', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/roles', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Support Lead',
        description: 'Extended support access',
        baseRole: 'agent',
        permissions: [
          { resource: 'customers', action: 'read', scope: 'team' },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: { name: string } };
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Support Lead');
  });

  it('GET /:id returns 404 for non-existent role', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/roles/no-such-id', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('full CRUD cycle: create, get, update, delete', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Create
    const createRes = await app.request('/api/v1/roles', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Lifecycle Role',
        description: 'Test lifecycle',
        baseRole: 'agent',
        permissions: [{ resource: 'customers', action: 'read', scope: 'own' }],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { data: { id: string } };

    // Get
    const getRes = await app.request(`/api/v1/roles/${created.data.id}`, { headers });
    expect(getRes.status).toBe(200);

    // Update
    const updateRes = await app.request(`/api/v1/roles/${created.data.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Updated Role' }),
    });
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as { data: { name: string } };
    expect(updated.data.name).toBe('Updated Role');

    // Delete
    const deleteRes = await app.request(`/api/v1/roles/${created.data.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(deleteRes.status).toBe(200);
  });
});

// ─── Assign/Revoke Tests ──────────────────────────────────────────

describe('Role assign/revoke', () => {
  it('POST /:id/assign assigns a role', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Create role
    const createRes = await app.request('/api/v1/roles', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Assignable Role',
        baseRole: 'agent',
        permissions: [],
      }),
    });
    const created = (await createRes.json()) as { data: { id: string } };

    // Assign
    const assignRes = await app.request(`/api/v1/roles/${created.data.id}/assign`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId: 'target-user-001' }),
    });
    expect(assignRes.status).toBe(200);
  });

  it('POST /:id/revoke revokes a role', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Create role
    const createRes = await app.request('/api/v1/roles', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Revocable Role',
        baseRole: 'agent',
        permissions: [],
      }),
    });
    const created = (await createRes.json()) as { data: { id: string } };

    // Assign first
    await app.request(`/api/v1/roles/${created.data.id}/assign`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId: 'target-user-002' }),
    });

    // Revoke
    const revokeRes = await app.request(`/api/v1/roles/${created.data.id}/revoke`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId: 'target-user-002' }),
    });
    expect(revokeRes.status).toBe(200);
  });

  it('returns 403 for non-admin on assign', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'agent' });
    const res = await app.request('/api/v1/roles/some-id/assign', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: 'user-001' }),
    });
    expect(res.status).toBe(403);
  });
});
