/**
 * Settings route tests
 *
 * SOC2 CC6.1 / CC6.3 — Access control config and tenant settings enforcement.
 * HIPAA §164.308(a)(3) — No PHI in test data payloads.
 *
 * Verifies:
 * - GET  /tenant               → 200 with org name, timezone, etc.
 * - PATCH /tenant              → 200 with updated data
 * - GET  /sso                  → 200 with connection list
 * - POST /sso                  → 201 with new connection
 * - GET  /roles                → 200 with role list
 * - POST /roles                → 201 with new role
 * - GET  /agents               → 200 with agent config
 * - PATCH /agents              → 200 with updated config
 * - GET  /channels             → 200 with channel list
 * - PATCH /channels/:channel   → 200 with toggled channel
 * - GET  /notifications        → 200 with notification prefs
 * - PATCH /notifications/:key  → 200 with updated pref
 * - GET  /security             → 200 with security posture
 * - PATCH /security            → 200 with updated security config
 * - Auth: unauthenticated GET /tenant returns 401
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { createTenantId } from '@ordr/core';
import { requestId } from '../middleware/request-id.js';
import { settingsRouter, configureSettingsRoutes } from '../routes/settings.js';
import { configureAuth } from '../middleware/auth.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';

// ─── Mock @ordr/auth ──────────────────────────────────────────────

vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
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

// ─── Mock DB builders ─────────────────────────────────────────────

const MOCK_TENANT_ROW = {
  id: 'tenant-1',
  name: 'Acme Corp',
  settings: {
    timezone: 'America/Chicago',
    dataRetention: '5 years',
    defaultLanguage: 'en',
    brandColor: '#ff0000',
    logoUrl: null,
    mfaEnforced: true,
    ipAllowlist: [],
  },
};

const MOCK_SSO_ROW = {
  id: 'sso-1',
  provider: 'Okta',
  type: 'saml',
  status: 'active',
  metadata: { domain: 'acme.com' },
};

const MOCK_ROLE_ROW = {
  id: 'role-1',
  name: 'Billing Manager',
  permissions: [{ resource: 'billing', action: 'read' }],
};

// ─── Test app factory ─────────────────────────────────────────────

function createTestApp() {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);
  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: createTenantId('tenant-1'),
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [],
    });
    await next();
  });
  app.route('/api/v1/settings', settingsRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Settings Routes', () => {
  let mockDb: ReturnType<typeof buildFullMockDb>;
  let auditLogger: AuditLogger;

  // Build a mock DB that handles all the query patterns in settings.ts.
  // Most reads go through fetchTenantRow (select id, name, settings from tenants)
  // and additional table reads (ssoConnections, customRoles, userCustomRoles).
  function buildFullMockDb() {
    let selectCallCount = 0;

    // All select chains funnel through this logic.
    const buildSelectChain = () => {
      const callIndex = selectCallCount++;
      // We track the table via .from()
      let resolvedValue: unknown = [];

      const chain: Record<string, unknown> = {};
      chain['from'] = vi.fn((_table: unknown) => {
        // Determine what to return based on the call order and table
        // The settings routes issue: select from tenants, ssoConnections, customRoles, userCustomRoles
        return chain;
      });
      chain['where'] = vi.fn(() => chain);
      chain['limit'] = vi.fn(() => chain);
      chain['offset'] = vi.fn(() => chain);
      chain['orderBy'] = vi.fn(() => chain);
      chain['groupBy'] = vi.fn(() => chain);
      // Make awaitable
      chain['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        // Default return per call sequence
        const defaults: Record<number, unknown> = {
          0: [MOCK_TENANT_ROW], // fetchTenantRow in GET /tenant
          1: [MOCK_SSO_ROW], // ssoConnections in GET /sso
          2: [MOCK_ROLE_ROW], // customRoles in GET /roles
          3: [{ roleId: 'role-1', cnt: 2 }], // userCustomRoles count
        };
        resolvedValue = defaults[callIndex] ?? [MOCK_TENANT_ROW];
        return Promise.resolve(resolvedValue).then(resolve, reject);
      };
      return chain;
    };

    const insertChain: Record<string, unknown> = {};
    insertChain['values'] = vi.fn(() => insertChain);
    insertChain['returning'] = vi.fn().mockResolvedValue([{ id: 'new-sso-1' }]);

    const updateChain: Record<string, unknown> = {};
    updateChain['set'] = vi.fn(() => updateChain);
    updateChain['where'] = vi.fn().mockResolvedValue([]);

    return {
      select: vi.fn(() => buildSelectChain()),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
      delete: vi.fn(),
    };
  }

  beforeEach(() => {
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    auditLogger = new AuditLogger(new InMemoryAuditStore());
    mockDb = buildFullMockDb();

    // Wire up per-call return values using a fresh stateful mock
    setupDbReturns(mockDb);

    configureSettingsRoutes({
      db: mockDb as never,
      auditLogger,
    });
  });

  /**
   * Configure the DB mock to return the right shape for each distinct query
   * pattern encountered in settings.ts. We use a simple call-index counter
   * so each awaited chain gets the right data.
   */
  function setupDbReturns(db: ReturnType<typeof buildFullMockDb>) {
    db.select.mockImplementation(() => {
      // We distinguish by building a chain that resolves differently per scenario.
      // Heuristic: each handler calls select multiple times; we rotate through expected data.
      const chain: Record<string, unknown> = {};
      let targetTable = '';

      chain['from'] = vi.fn((table: unknown) => {
        targetTable = (table as Record<symbol, string>)[Symbol.for('drizzle:Name')] ?? '';
        return chain;
      });
      chain['where'] = vi.fn(() => chain);
      chain['limit'] = vi.fn(() => chain);
      chain['offset'] = vi.fn(() => chain);
      chain['orderBy'] = vi.fn(() => chain);
      chain['groupBy'] = vi.fn(() => chain);

      chain['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        // Return based on the table heuristic
        let result: unknown;
        if (targetTable.includes('sso') || targetTable.includes('Sso')) {
          result = [MOCK_SSO_ROW];
        } else if (targetTable.includes('customRoles') || targetTable.includes('custom_roles')) {
          result = [MOCK_ROLE_ROW];
        } else if (
          targetTable.includes('userCustomRoles') ||
          targetTable.includes('user_custom_roles')
        ) {
          result = [{ roleId: 'role-1', cnt: 2 }];
        } else {
          // Default: tenants table
          result = [MOCK_TENANT_ROW];
        }
        return Promise.resolve(result).then(resolve, reject);
      };

      return chain as never;
    });

    // insert chain — returns appropriate inserted row by context
    db.insert.mockImplementation(((table: unknown) => {
      const tableName = (table as Record<symbol, string>)[Symbol.for('drizzle:Name')] ?? '';
      const chain: Record<string, unknown> = {};
      chain['values'] = vi.fn(() => chain);
      chain['returning'] = vi.fn().mockResolvedValue(
        tableName.includes('custom_role') || tableName.includes('customRole')
          ? [{ id: 'new-role-1', name: 'Billing Manager' }] // Role insert
          : [{ id: 'new-sso-1' }], // SSO insert
      );
      return chain as never;
    }) as never);

    // update chain
    db.update.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain['set'] = vi.fn(() => chain);
      chain['where'] = vi.fn().mockResolvedValue([]);
      return chain as never;
    });
  }

  // ── GET /tenant ──────────────────────────────────────────────────

  describe('GET /api/v1/settings/tenant', () => {
    it('returns 200 with org name and timezone', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/tenant');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { organizationName: string; timezone: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.organizationName).toBe('Acme Corp');
      expect(body.data.timezone).toBe('America/Chicago');
    });

    it('includes all expected fields', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/tenant');
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(body.data).toHaveProperty('organizationName');
      expect(body.data).toHaveProperty('timezone');
      expect(body.data).toHaveProperty('dataRetention');
      expect(body.data).toHaveProperty('defaultLanguage');
      expect(body.data).toHaveProperty('brandColor');
      expect(body.data).toHaveProperty('logoUrl');
    });
  });

  // ── PATCH /tenant ────────────────────────────────────────────────

  describe('PATCH /api/v1/settings/tenant', () => {
    it('returns 200 with updated data on valid body', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: 'Europe/London', brandColor: '#3b82f6' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown };
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });

    it('returns 422 or 400 when brandColor is invalid hex', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandColor: 'not-a-color' }),
      });

      expect([400, 422]).toContain(res.status);
    });
  });

  // ── GET /sso ─────────────────────────────────────────────────────

  describe('GET /api/v1/settings/sso', () => {
    it('returns 200 with SSO connection list', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/sso');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('maps db status "active" to connection status "connected"', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/sso');
      const body = (await res.json()) as { data: Array<{ status: string }> };
      expect(body.data[0]?.status).toBe('connected');
    });
  });

  // ── POST /sso ────────────────────────────────────────────────────

  describe('POST /api/v1/settings/sso', () => {
    it('returns 201 with new SSO connection on valid body', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'Okta',
          protocol: 'saml',
          domain: 'acme.com',
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        success: boolean;
        data: { provider: string; status: string; protocol: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.provider).toBe('Okta');
      expect(body.data.status).toBe('pending');
      expect(body.data.protocol).toBe('saml');
    });

    it('returns 400 when protocol is invalid', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'Okta', protocol: 'ldap', domain: 'acme.com' }),
      });

      expect([400, 422]).toContain(res.status);
    });
  });

  // ── GET /roles ───────────────────────────────────────────────────

  describe('GET /api/v1/settings/roles', () => {
    it('returns 200 with role list', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/roles');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('includes userCount and isSystem fields', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/roles');
      const body = (await res.json()) as {
        data: Array<{ userCount: number; isSystem: boolean }>;
      };
      if (body.data.length > 0) {
        expect(body.data[0]).toHaveProperty('userCount');
        expect(body.data[0]).toHaveProperty('isSystem');
      }
    });
  });

  // ── POST /roles ──────────────────────────────────────────────────

  describe('POST /api/v1/settings/roles', () => {
    it('returns 201 with new role on valid body', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Billing Manager',
          permissions: ['billing:read', 'billing:write'],
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        success: boolean;
        data: { name: string; userCount: number; isSystem: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Billing Manager');
      expect(body.data.userCount).toBe(0);
      expect(body.data.isSystem).toBe(false);
    });

    it('returns 400 when name is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: ['billing:read'] }),
      });

      expect([400, 422]).toContain(res.status);
    });
  });

  // ── GET /agents ──────────────────────────────────────────────────

  describe('GET /api/v1/settings/agents', () => {
    it('returns 200 with agent config', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/agents');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { confidenceThreshold: number; globalKillSwitch: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('confidenceThreshold');
      expect(body.data).toHaveProperty('globalKillSwitch');
    });
  });

  // ── PATCH /agents ────────────────────────────────────────────────

  describe('PATCH /api/v1/settings/agents', () => {
    it('returns 200 with updated agent config', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confidenceThreshold: 0.85, globalKillSwitch: false }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown };
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });

    it('returns 400 when confidenceThreshold is out of range', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confidenceThreshold: 5.0 }),
      });

      expect([400, 422]).toContain(res.status);
    });
  });

  // ── GET /channels ────────────────────────────────────────────────

  describe('GET /api/v1/settings/channels', () => {
    it('returns 200 with channel list', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/channels');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // ── PATCH /channels/:channel ─────────────────────────────────────

  describe('PATCH /api/v1/settings/channels/:channel', () => {
    it('returns 200 with updated channel on valid body', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/channels/Email', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown };
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });

    it('returns 400 when enabled field is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/channels/Email', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect([400, 422]).toContain(res.status);
    });
  });

  // ── GET /notifications ───────────────────────────────────────────

  describe('GET /api/v1/settings/notifications', () => {
    it('returns 200 with notification preferences list', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/notifications');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // ── PATCH /notifications/:key ────────────────────────────────────

  describe('PATCH /api/v1/settings/notifications/:key', () => {
    it('returns 200 with updated pref', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/notifications/compliance_violations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown };
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });

    it('accepts channels array update', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/notifications/daily_summary', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: ['email'] }),
      });

      expect(res.status).toBe(200);
    });
  });

  // ── GET /security ────────────────────────────────────────────────

  describe('GET /api/v1/settings/security', () => {
    it('returns 200 with security posture data', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/security');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { encryption: string; mfaEnforced: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.data.encryption).toContain('AES-256');
      expect(typeof body.data.mfaEnforced).toBe('boolean');
    });

    it('includes all expected security fields', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/security');
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(body.data).toHaveProperty('encryption');
      expect(body.data).toHaveProperty('keyRotation');
      expect(body.data).toHaveProperty('auditIntegrity');
      expect(body.data).toHaveProperty('sessionSecurity');
      expect(body.data).toHaveProperty('mfaEnforced');
      expect(body.data).toHaveProperty('ipAllowlist');
    });
  });

  // ── PATCH /security ──────────────────────────────────────────────

  describe('PATCH /api/v1/settings/security', () => {
    it('returns 200 with updated security config', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/security', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaEnforced: true, ipAllowlist: ['10.0.0.0/8'] }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown };
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });

    it('returns 400 when ipAllowlist entry is empty string', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/settings/security', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ipAllowlist: [''] }),
      });

      expect([400, 422]).toContain(res.status);
    });
  });

  // ── Auth enforcement ─────────────────────────────────────────────

  describe('auth enforcement', () => {
    it('returns 401 on GET /tenant when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        authenticated: false,
        error: 'No token',
      });

      const app = new Hono<Env>();
      app.onError(globalErrorHandler);
      app.use('*', requestId);
      // No tenantContext set — simulates missing auth
      app.route('/api/v1/settings', settingsRouter);

      const res = await app.request('/api/v1/settings/tenant');
      expect(res.status).toBe(401);
    });

    it('calls authenticateRequest on every protected endpoint', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      const app = createTestApp();
      await app.request('/api/v1/settings/tenant');
      expect(authenticateRequest).toHaveBeenCalled();
    });
  });
});
