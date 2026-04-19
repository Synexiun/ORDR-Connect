/**
 * Branding Route Tests — /api/v1/branding endpoints
 *
 * Tests GET/PUT brand config, domain CRUD, auth enforcement,
 * admin-only access, Zod validation, and audit logging.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { brandingRouter, configureBrandingRoutes } from '../routes/branding.js';
import { configureAuth } from '../middleware/auth.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import { loadKeyPair, createAccessToken } from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { generateKeyPair } from '@ordr/crypto';
import type { BrandConfigUpdate } from '@ordr/core';

// ─── Response type helper ─────────────────────────────────────────

interface BrandingBody {
  success: boolean;
  data: {
    id?: string;
    tenantId?: string;
    primaryColor?: string;
    accentColor?: string;
    bgColor?: string;
    textColor?: string;
    logoUrl?: string | null;
    faviconUrl?: string | null;
    emailFromName?: string | null;
    emailFromAddress?: string | null;
    customCss?: string | null;
    footerText?: string | null;
    customDomain?: string | null;
    domain?: string;
    sslStatus?: string;
  };
  error?: { message?: string; code?: string };
}

// ─── Fixtures ─────────────────────────────────────────────────────

interface MockBrandConfig {
  id: string;
  tenantId: string;
  customDomain: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  bgColor: string;
  textColor: string;
  emailFromName: string | null;
  emailFromAddress: string | null;
  customCss: string | null;
  footerText: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_CONFIG: MockBrandConfig = {
  id: 'config-001',
  tenantId: 'tenant-001',
  customDomain: null,
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#3b82f6',
  accentColor: '#10b981',
  bgColor: '#0f172a',
  textColor: '#e2e8f0',
  emailFromName: null,
  emailFromAddress: null,
  customCss: null,
  footerText: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

let jwtConfig: JwtConfig;
let auditLogger: AuditLogger;
let brandStore: Map<string, MockBrandConfig>;
let domainIndex: Map<string, MockBrandConfig>;

async function makeJwt(
  overrides: {
    readonly sub?: string;
    readonly tid?: string;
    readonly role?: string;
  } = {},
): Promise<string> {
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
  app.route('/api/v1/branding', brandingRouter);
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

  const auditStore = new InMemoryAuditStore();
  auditLogger = new AuditLogger(auditStore);

  brandStore = new Map<string, MockBrandConfig>();
  domainIndex = new Map<string, MockBrandConfig>();

  configureBrandingRoutes({
    auditLogger,
    getBrandConfig: vi.fn((tenantId: string) => Promise.resolve(brandStore.get(tenantId) ?? null)),
    upsertBrandConfig: vi.fn((tenantId: string, data: BrandConfigUpdate) => {
      const existing = brandStore.get(tenantId) ?? { ...DEFAULT_CONFIG, tenantId };
      const updated = { ...existing, ...data, updatedAt: new Date() };
      brandStore.set(tenantId, updated);
      if (updated.customDomain !== null) {
        domainIndex.set(updated.customDomain, updated);
      }
      return Promise.resolve(updated);
    }),
    getBrandConfigByDomain: vi.fn((domain: string) =>
      Promise.resolve(domainIndex.get(domain) ?? null),
    ),
    setCustomDomain: vi.fn((tenantId: string, domain: string) => {
      const existing = brandStore.get(tenantId) ?? { ...DEFAULT_CONFIG, tenantId };
      const updated = { ...existing, customDomain: domain, updatedAt: new Date() };
      brandStore.set(tenantId, updated);
      domainIndex.set(domain, updated);
      return Promise.resolve(updated);
    }),
    removeCustomDomain: vi.fn((tenantId: string) => {
      const existing = brandStore.get(tenantId);
      if (!existing || existing.customDomain === null) return Promise.resolve(false);
      domainIndex.delete(existing.customDomain);
      const updated = { ...existing, customDomain: null, updatedAt: new Date() };
      brandStore.set(tenantId, updated);
      return Promise.resolve(true);
    }),
  });
});

// ─── GET /api/v1/branding ────────────────────────────────────────

describe('GET /api/v1/branding', () => {
  it('returns default config when none exists', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/branding', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as BrandingBody;
    expect(body.success).toBe(true);
    expect(body.data.primaryColor).toBe('#3b82f6');
    expect(body.data.accentColor).toBe('#10b981');
  });

  it('returns stored config when one exists', async () => {
    brandStore.set('tenant-001', {
      ...DEFAULT_CONFIG,
      primaryColor: '#ff0000',
      logoUrl: 'https://example.com/logo.png',
    });

    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/branding', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as BrandingBody;
    expect(body.data.primaryColor).toBe('#ff0000');
    expect(body.data.logoUrl).toBe('https://example.com/logo.png');
  });

  it('returns 401 without authentication', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/branding');
    expect(res.status).toBe(401);
  });

  it('scopes config to the authenticated tenant', async () => {
    brandStore.set('tenant-002', {
      ...DEFAULT_CONFIG,
      tenantId: 'tenant-002',
      primaryColor: '#00ff00',
    });

    const app = createTestApp();
    const token = await makeJwt({ tid: 'tenant-001' });

    const res = await app.request('/api/v1/branding', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = (await res.json()) as BrandingBody;
    // tenant-001 has no config, so defaults returned (not tenant-002's config)
    expect(body.data.primaryColor).toBe('#3b82f6');
  });
});

// ─── PUT /api/v1/branding ────────────────────────────────────────

describe('PUT /api/v1/branding', () => {
  it('updates brand config for admin users', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        primaryColor: '#ff0000',
        logoUrl: 'https://example.com/logo.png',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as BrandingBody;
    expect(body.success).toBe(true);
    expect(body.data.primaryColor).toBe('#ff0000');
    expect(body.data.logoUrl).toBe('https://example.com/logo.png');
  });

  it('rejects invalid hex color format', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ primaryColor: 'not-a-color' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects 3-digit hex colors', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ primaryColor: '#f00' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects invalid URL for logoUrl', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ logoUrl: 'not-a-url' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 403 for non-admin users', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'viewer' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ primaryColor: '#ff0000' }),
    });

    expect(res.status).toBe(403);
  });

  it('returns 401 without authentication', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryColor: '#ff0000' }),
    });

    expect(res.status).toBe(401);
  });

  it('accepts nullable fields set to null', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ logoUrl: null, faviconUrl: null }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as BrandingBody;
    expect(body.data.logoUrl).toBeNull();
    expect(body.data.faviconUrl).toBeNull();
  });

  it('validates email format for emailFromAddress', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ emailFromAddress: 'not-email' }),
    });

    expect(res.status).toBe(400);
  });

  it('accepts valid email for emailFromAddress', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ emailFromAddress: 'noreply@custom.com' }),
    });

    expect(res.status).toBe(200);
  });

  it('limits customCss length to 50000 characters', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ customCss: 'a'.repeat(50001) }),
    });

    expect(res.status).toBe(400);
  });

  it('accepts customCss within limit', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ customCss: '.header { color: red; }' }),
    });

    expect(res.status).toBe(200);
  });
});

// ─── Domain CRUD ─────────────────────────────────────────────────

describe('GET /api/v1/branding/domain', () => {
  it('returns null when no domain is configured', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/branding/domain', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as BrandingBody;
    expect(body.data).toBeNull();
  });

  it('returns domain config when configured', async () => {
    brandStore.set('tenant-001', {
      ...DEFAULT_CONFIG,
      customDomain: 'app.example.com',
    });

    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/branding/domain', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as BrandingBody;
    expect(body.data.domain).toBe('app.example.com');
    expect(body.data.sslStatus).toBe('pending');
  });

  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/branding/domain');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/branding/domain', () => {
  it('registers a custom domain for admin', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding/domain', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: 'app.example.com' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as BrandingBody;
    expect(body.data.domain).toBe('app.example.com');
    expect(body.data.sslStatus).toBe('pending');
  });

  it('rejects invalid domain format', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding/domain', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: 'not a domain' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects localhost domains', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding/domain', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: 'localhost.example.com' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 403 for non-admin users', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'viewer' });

    const res = await app.request('/api/v1/branding/domain', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: 'app.example.com' }),
    });

    expect(res.status).toBe(403);
  });

  it('returns 409 when domain is taken by another tenant', async () => {
    domainIndex.set('app.example.com', {
      ...DEFAULT_CONFIG,
      tenantId: 'tenant-other',
      customDomain: 'app.example.com',
    });

    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin', tid: 'tenant-001' });

    const res = await app.request('/api/v1/branding/domain', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: 'app.example.com' }),
    });

    expect(res.status).toBe(409);
  });

  it('lowercases domain before storing', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding/domain', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: 'APP.Example.COM' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as BrandingBody;
    expect(body.data.domain).toBe('app.example.com');
  });
});

describe('DELETE /api/v1/branding/domain', () => {
  it('removes custom domain for admin', async () => {
    brandStore.set('tenant-001', {
      ...DEFAULT_CONFIG,
      customDomain: 'app.example.com',
    });
    domainIndex.set('app.example.com', brandStore.get('tenant-001')!);

    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding/domain', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as BrandingBody;
    expect(body.success).toBe(true);
  });

  it('returns 404 when no domain is configured', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding/domain', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('returns 403 for non-admin users', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'viewer' });

    const res = await app.request('/api/v1/branding/domain', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
  });

  it('returns 401 without authentication', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/branding/domain', {
      method: 'DELETE',
    });

    expect(res.status).toBe(401);
  });
});

// ─── Audit Logging Verification ─────────────────────────────────

describe('Audit logging', () => {
  it('logs audit event on PUT /api/v1/branding', async () => {
    const logSpy = vi.spyOn(auditLogger, 'log');
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ primaryColor: '#ff0000' }),
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-001',
        eventType: 'config.updated',
        action: 'update_branding',
        resource: 'white_label_configs',
        actorType: 'user',
        actorId: 'user-001',
      }),
    );
  });

  it('logs audit event on POST /api/v1/branding/domain', async () => {
    const logSpy = vi.spyOn(auditLogger, 'log');
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    await app.request('/api/v1/branding/domain', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: 'app.example.com' }),
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-001',
        eventType: 'config.updated',
        action: 'register_domain',
        details: expect.objectContaining({ domain: 'app.example.com' }) as Record<string, unknown>,
      }),
    );
  });

  it('logs audit event on DELETE /api/v1/branding/domain', async () => {
    brandStore.set('tenant-001', {
      ...DEFAULT_CONFIG,
      customDomain: 'app.example.com',
    });
    domainIndex.set('app.example.com', brandStore.get('tenant-001')!);

    const logSpy = vi.spyOn(auditLogger, 'log');
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    await app.request('/api/v1/branding/domain', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-001',
        eventType: 'config.updated',
        action: 'remove_domain',
        details: expect.objectContaining({ domain: 'app.example.com' }) as Record<string, unknown>,
      }),
    );
  });

  it('audit log includes changedFields for PUT', async () => {
    const logSpy = vi.spyOn(auditLogger, 'log');
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        primaryColor: '#ff0000',
        accentColor: '#00ff00',
      }),
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          changedFields: expect.arrayContaining(['primaryColor', 'accentColor']) as string[],
        }) as Record<string, unknown>,
      }),
    );
  });

  it('does not log audit event for failed PUT validation', async () => {
    const logSpy = vi.spyOn(auditLogger, 'log');
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ primaryColor: 'invalid' }),
    });

    expect(logSpy).not.toHaveBeenCalled();
  });
});

// ─── Additional Validation Tests ────────────────────────────────

describe('PUT /api/v1/branding — extended validation', () => {
  it('rejects colors without # prefix', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accentColor: 'ff0000' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects 8-digit hex colors (alpha channel)', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bgColor: '#ff000080' }),
    });

    expect(res.status).toBe(400);
  });

  it('accepts all four color fields simultaneously', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        primaryColor: '#111111',
        accentColor: '#222222',
        bgColor: '#333333',
        textColor: '#444444',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as BrandingBody;
    expect(body.data.primaryColor).toBe('#111111');
    expect(body.data.accentColor).toBe('#222222');
    expect(body.data.bgColor).toBe('#333333');
    expect(body.data.textColor).toBe('#444444');
  });

  it('rejects invalid faviconUrl', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ faviconUrl: 'not-valid' }),
    });

    expect(res.status).toBe(400);
  });

  it('accepts valid faviconUrl', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ faviconUrl: 'https://example.com/favicon.ico' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as BrandingBody;
    expect(body.data.faviconUrl).toBe('https://example.com/favicon.ico');
  });

  it('accepts footerText within limit', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ footerText: 'Powered by ACME Corp' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as BrandingBody;
    expect(body.data.footerText).toBe('Powered by ACME Corp');
  });

  it('accepts emailFromName', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ emailFromName: 'Support Team' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as BrandingBody;
    expect(body.data.emailFromName).toBe('Support Team');
  });

  it('rejects malformed JSON body', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{bad json',
    });

    expect(res.status).toBe(400);
  });

  it('rejects empty body', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    expect(res.status).toBe(400);
  });
});

// ─── Domain Extended Tests ──────────────────────────────────────

describe('POST /api/v1/branding/domain — extended', () => {
  it('rejects domain shorter than 4 characters', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding/domain', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: 'a.b' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects IP address as domain', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding/domain', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: '192.168.1.1' }),
    });

    expect(res.status).toBe(400);
  });

  it('allows re-registering own domain', async () => {
    // First register
    domainIndex.set('app.example.com', {
      ...DEFAULT_CONFIG,
      tenantId: 'tenant-001',
      customDomain: 'app.example.com',
    });

    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin', tid: 'tenant-001' });

    const res = await app.request('/api/v1/branding/domain', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: 'app.example.com' }),
    });

    // Should succeed since same tenant owns it
    expect(res.status).toBe(201);
  });

  it('rejects missing domain field in body', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    const res = await app.request('/api/v1/branding/domain', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 without authentication', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/branding/domain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'app.example.com' }),
    });

    expect(res.status).toBe(401);
  });
});

// ─── GET defaults shape ─────────────────────────────────────────

describe('GET /api/v1/branding — default shape', () => {
  it('returns all expected default fields', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/branding', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = (await res.json()) as BrandingBody;
    expect(body.data.bgColor).toBe('#0f172a');
    expect(body.data.textColor).toBe('#e2e8f0');
    expect(body.data.customDomain).toBeNull();
    expect(body.data.logoUrl).toBeNull();
    expect(body.data.faviconUrl).toBeNull();
    expect(body.data.emailFromName).toBeNull();
    expect(body.data.emailFromAddress).toBeNull();
    expect(body.data.customCss).toBeNull();
    expect(body.data.footerText).toBeNull();
  });

  it('returns tenant ID matching the JWT', async () => {
    const app = createTestApp();
    const token = await makeJwt({ tid: 'tenant-xyz' });

    const res = await app.request('/api/v1/branding', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = (await res.json()) as BrandingBody;
    expect(body.data.tenantId).toBe('tenant-xyz');
  });
});
