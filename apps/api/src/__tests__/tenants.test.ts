/**
 * Tenant Management Route Tests — /api/v1/tenants
 *
 * Verifies:
 * - GET /me          — own tenant (any auth)
 * - PATCH /me        — update own tenant name (tenant_admin)
 * - GET /            — list all tenants (super_admin only)
 * - POST /           — provision tenant (super_admin only)
 * - GET /:id         — get by ID (super_admin or own)
 * - PATCH /:id       — update tenant (super_admin only)
 * - PATCH /:id/status — change status (super_admin only)
 * - Auth enforcement on all routes
 * - Role-based access control (viewer/tenant_admin/super_admin)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { tenantsRouter, configureTenantRoutes } from '../routes/tenants.js';
import type { TenantRow } from '../routes/tenants.js';
import { configureAuth } from '../middleware/auth.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { loadKeyPair, createAccessToken } from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { generateKeyPair } from '@ordr/crypto';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';

// ─── Fixtures ─────────────────────────────────────────────────────

const mockTenant: TenantRow = {
  id: 'tenant-001',
  name: 'Acme Corp',
  slug: 'acme-corp',
  plan: 'professional',
  status: 'active',
  isolationTier: 'shared',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

// ─── JWT helpers ──────────────────────────────────────────────────

let jwtConfig: JwtConfig;

async function makeToken(role: string, tenantId = 'tenant-001'): Promise<string> {
  return createAccessToken(jwtConfig, {
    sub: 'user-001',
    tid: tenantId,
    role: role as 'tenant_admin',
    permissions: [],
  });
}

// ─── Test app ─────────────────────────────────────────────────────

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);
  app.route('/api/v1/tenants', tenantsRouter);
  return app;
}

// ─── Setup ────────────────────────────────────────────────────────

beforeEach(async () => {
  const { privateKey, publicKey } = generateKeyPair();
  jwtConfig = await loadKeyPair(privateKey, publicKey, {
    issuer: 'ordr-connect',
    audience: 'ordr-connect',
  });
  configureAuth(jwtConfig);

  const auditLogger = new AuditLogger(new InMemoryAuditStore());

  configureTenantRoutes({
    getTenant: vi.fn().mockResolvedValue(mockTenant),
    listTenants: vi.fn().mockResolvedValue({ data: [mockTenant], total: 1 }),
    createTenant: vi.fn().mockResolvedValue(mockTenant),
    updateTenant: vi.fn().mockResolvedValue(mockTenant),
    updateTenantStatus: vi.fn().mockResolvedValue(mockTenant),
    auditLogger,
  });
});

// ─── Auth enforcement ─────────────────────────────────────────────

describe('auth enforcement', () => {
  it('returns 401 on GET /me without auth', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/tenants/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 on GET / without auth', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/tenants');
    expect(res.status).toBe(401);
  });

  it('returns 403 on GET / for tenant_admin (super_admin only)', async () => {
    const app = createTestApp();
    const token = await makeToken('tenant_admin');
    const res = await app.request('/api/v1/tenants', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 on POST / for tenant_admin', async () => {
    const app = createTestApp();
    const token = await makeToken('tenant_admin');
    const res = await app.request('/api/v1/tenants', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Tenant', slug: 'new-tenant' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 on PATCH /:id/status for tenant_admin', async () => {
    const app = createTestApp();
    const token = await makeToken('tenant_admin');
    const res = await app.request('/api/v1/tenants/tenant-001/status', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'suspended' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 on GET /:id for non-own tenant without super_admin', async () => {
    const app = createTestApp();
    const token = await makeToken('tenant_admin', 'other-tenant');
    const res = await app.request('/api/v1/tenants/tenant-001', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });
});

// ─── GET /me ──────────────────────────────────────────────────────

describe('GET /api/v1/tenants/me', () => {
  it('returns own tenant with 200', async () => {
    const app = createTestApp();
    const token = await makeToken('viewer');
    const res = await app.request('/api/v1/tenants/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: TenantRow };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('tenant-001');
    expect(body.data.name).toBe('Acme Corp');
    expect(body.data.plan).toBe('professional');
  });

  it('returns 404 when tenant not found', async () => {
    configureTenantRoutes({
      getTenant: vi.fn().mockResolvedValue(undefined),
      listTenants: vi.fn(),
      createTenant: vi.fn(),
      updateTenant: vi.fn(),
      updateTenantStatus: vi.fn(),
      auditLogger: new AuditLogger(new InMemoryAuditStore()),
    });

    const app = createTestApp();
    const token = await makeToken('tenant_admin');
    const res = await app.request('/api/v1/tenants/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /me ────────────────────────────────────────────────────

describe('PATCH /api/v1/tenants/me', () => {
  it('updates own tenant name with 200', async () => {
    const app = createTestApp();
    const token = await makeToken('tenant_admin');
    const res = await app.request('/api/v1/tenants/me', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Corp Updated' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: TenantRow };
    expect(body.success).toBe(true);
  });

  it('returns 400 for name too short', async () => {
    const app = createTestApp();
    const token = await makeToken('tenant_admin');
    const res = await app.request('/api/v1/tenants/me', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 for viewer role', async () => {
    const app = createTestApp();
    const token = await makeToken('viewer');
    const res = await app.request('/api/v1/tenants/me', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    expect(res.status).toBe(403);
  });
});

// ─── GET / ────────────────────────────────────────────────────────

describe('GET /api/v1/tenants', () => {
  it('returns tenant list with pagination (super_admin)', async () => {
    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: TenantRow[];
      pagination: { total: number; limit: number; offset: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.pagination.total).toBe(1);
  });

  it('passes status filter through', async () => {
    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants?status=active&limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid status filter', async () => {
    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants?status=banned', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });
});

// ─── POST / ───────────────────────────────────────────────────────

describe('POST /api/v1/tenants', () => {
  it('provisions new tenant with 201 (super_admin)', async () => {
    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Tenant', slug: 'new-tenant' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: TenantRow };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('tenant-001');
  });

  it('returns 400 for invalid slug (uppercase)', async () => {
    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Tenant', slug: 'New-Tenant' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing required fields', async () => {
    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Only Name' }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET /:id ─────────────────────────────────────────────────────

describe('GET /api/v1/tenants/:id', () => {
  it('returns own tenant to tenant_admin', async () => {
    const app = createTestApp();
    const token = await makeToken('tenant_admin', 'tenant-001');
    const res = await app.request('/api/v1/tenants/tenant-001', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: TenantRow };
    expect(body.data.id).toBe('tenant-001');
  });

  it('returns any tenant to super_admin', async () => {
    const app = createTestApp();
    const token = await makeToken('super_admin', 'platform-tenant');
    const res = await app.request('/api/v1/tenants/tenant-001', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown tenant ID', async () => {
    configureTenantRoutes({
      getTenant: vi.fn().mockResolvedValue(undefined),
      listTenants: vi.fn(),
      createTenant: vi.fn(),
      updateTenant: vi.fn(),
      updateTenantStatus: vi.fn(),
      auditLogger: new AuditLogger(new InMemoryAuditStore()),
    });

    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants/does-not-exist', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /:id ───────────────────────────────────────────────────

describe('PATCH /api/v1/tenants/:id', () => {
  it('updates tenant name and slug (super_admin)', async () => {
    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants/tenant-001', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Corp Renamed', slug: 'acme-corp-v2' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: TenantRow };
    expect(body.success).toBe(true);
  });

  it('returns 200 with no-change message when body is empty', async () => {
    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants/tenant-001', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.message).toBe('No changes');
  });

  it('returns 400 for invalid slug', async () => {
    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants/tenant-001', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'UPPER_CASE' }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── PATCH /:id/status ────────────────────────────────────────────

describe('PATCH /api/v1/tenants/:id/status', () => {
  it('suspends tenant with 200 (super_admin)', async () => {
    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants/tenant-001/status', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'suspended', reason: 'Non-payment' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: TenantRow };
    expect(body.success).toBe(true);
  });

  it('accepts status change without reason', async () => {
    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants/tenant-001/status', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid status value', async () => {
    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants/tenant-001/status', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when tenant not found', async () => {
    configureTenantRoutes({
      getTenant: vi.fn(),
      listTenants: vi.fn(),
      createTenant: vi.fn(),
      updateTenant: vi.fn(),
      updateTenantStatus: vi.fn().mockResolvedValue(undefined),
      auditLogger: new AuditLogger(new InMemoryAuditStore()),
    });

    const app = createTestApp();
    const token = await makeToken('super_admin');
    const res = await app.request('/api/v1/tenants/ghost-tenant/status', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'suspended' }),
    });
    expect(res.status).toBe(404);
  });
});
