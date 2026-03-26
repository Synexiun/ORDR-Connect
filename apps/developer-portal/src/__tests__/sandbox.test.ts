/**
 * Sandbox Route Tests — /v1/sandbox endpoints
 *
 * Tests provisioning, status, destroy, reset, TTL enforcement,
 * max 1 sandbox per developer, and audit logging.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createPortalApp } from '../app.js';
import { configureDeveloperRoutes } from '../routes/developers.js';
import { configureSandboxRoutes } from '../routes/sandbox.js';
import { configureApiKeyAuth, hashApiKey, clearRateLimitStore } from '../middleware/api-key-auth.js';
import type { Env } from '../types.js';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';

// ── Test Fixtures ─────────────────────────────────────────────────

interface MockSandbox {
  id: string;
  developerId: string;
  tenantId: string;
  expiresAt: Date;
  status: 'active' | 'expired' | 'destroyed';
  createdAt: Date;
  seedDataProfile: 'minimal' | 'collections' | 'healthcare';
}

const sandboxStore = new Map<string, MockSandbox>();
const sandboxByDeveloper = new Map<string, MockSandbox>();
const devByKeyHash = new Map<string, { id: string; email: string; tier: 'free' | 'pro' | 'enterprise'; rateLimitRpm: number; status: 'active' | 'suspended' | 'revoked' }>();

let auditStore: InMemoryAuditStore;
let auditLogger: AuditLogger;

const TEST_API_KEY = 'devk_test1234567890abcdef1234567890abcdef1234567890ab';
const TEST_DEVELOPER_ID = 'dev-sandbox-test';

function createTestApp(): Hono<Env> {
  return createPortalApp({ corsOrigins: [], nodeEnv: 'test' });
}

function authHeaders(): Record<string, string> {
  return { 'X-API-Key': TEST_API_KEY };
}

// ── Setup ────────────────────────────────────────────────────────

beforeEach(async () => {
  sandboxStore.clear();
  sandboxByDeveloper.clear();
  devByKeyHash.clear();
  clearRateLimitStore();

  auditStore = new InMemoryAuditStore();
  auditLogger = new AuditLogger(auditStore);

  // Register test developer in auth lookup
  const keyHash = hashApiKey(TEST_API_KEY);
  devByKeyHash.set(keyHash, {
    id: TEST_DEVELOPER_ID,
    email: 'sandbox-dev@example.com',
    tier: 'free',
    rateLimitRpm: 60,
    status: 'active',
  });

  configureApiKeyAuth({
    findByKeyHash: async (kh) => devByKeyHash.get(kh) ?? null,
    updateLastActive: async () => {},
  });

  // Configure developer routes (needed for app setup)
  configureDeveloperRoutes({
    auditLogger,
    findByEmail: async () => null,
    findById: async () => null,
    createDeveloper: async () => { throw new Error('not used'); },
    updateApiKey: async () => {},
    getUsage: async () => [],
  });

  configureSandboxRoutes({
    auditLogger,
    findActiveSandbox: async (developerId) => {
      const sb = sandboxByDeveloper.get(developerId);
      if (sb && sb.status !== 'destroyed') return sb;
      return null;
    },
    findSandboxById: async (id, developerId) => {
      const sb = sandboxStore.get(id);
      if (sb && sb.developerId === developerId) return sb;
      return null;
    },
    createSandbox: async (data) => {
      const sb: MockSandbox = {
        id: `sb-${Date.now()}`,
        developerId: data.developerId,
        tenantId: data.tenantId,
        expiresAt: data.expiresAt,
        status: 'active',
        createdAt: new Date(),
        seedDataProfile: data.seedDataProfile,
      };
      sandboxStore.set(sb.id, sb);
      sandboxByDeveloper.set(sb.developerId, sb);
      return sb;
    },
    destroySandbox: async (sandboxId) => {
      const sb = sandboxStore.get(sandboxId);
      if (sb) {
        sb.status = 'destroyed';
        sandboxByDeveloper.delete(sb.developerId);
      }
    },
    resetSandbox: async (sandboxId, seedDataProfile) => {
      const sb = sandboxStore.get(sandboxId);
      if (!sb) throw new Error('Sandbox not found');
      // Simulate reset — return same sandbox with updated data
      return { ...sb, seedDataProfile };
    },
  });
});

// ── Provision Tests ──────────────────────────────────────────────

describe('POST /v1/sandbox', () => {
  it('provisions a new sandbox tenant', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      success: boolean;
      data: { tenantId: string; status: string; expiresAt: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toMatch(/^sandbox_/);
    expect(body.data.status).toBe('active');
    expect(body.data.expiresAt).toBeDefined();
  });

  it('provisions sandbox with minimal seed profile by default', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const body = await res.json() as { data: { seedDataProfile: string } };
    expect(body.data.seedDataProfile).toBe('minimal');
  });

  it('provisions sandbox with healthcare seed profile', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ seedDataProfile: 'healthcare' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { data: { seedDataProfile: string } };
    expect(body.data.seedDataProfile).toBe('healthcare');
  });

  it('sets 72-hour TTL on sandbox', async () => {
    const app = createTestApp();
    const before = Date.now();

    const res = await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const body = await res.json() as { data: { expiresAt: string } };
    const expiresAt = new Date(body.data.expiresAt).getTime();
    const expectedTtl = 72 * 60 * 60 * 1000;

    expect(expiresAt - before).toBeGreaterThanOrEqual(expectedTtl - 5000);
    expect(expiresAt - before).toBeLessThanOrEqual(expectedTtl + 5000);
  });

  it('rejects when developer already has an active sandbox', async () => {
    const app = createTestApp();

    // First sandbox
    await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    // Second sandbox — should fail
    const res = await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(409);
  });

  it('rejects invalid seed data profile', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ seedDataProfile: 'invalid' }),
    });

    expect(res.status).toBe(400);
  });

  it('requires API key authentication', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
  });

  it('generates audit log for sandbox provisioning', async () => {
    const app = createTestApp();
    await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const events = auditStore.getAllEvents('developer-portal');
    const provisionEvent = events.find((e) => e.action === 'provision');
    expect(provisionEvent).toBeDefined();
    expect(provisionEvent!.resource).toBe('sandbox_tenants');
  });
});

// ── Status Tests ─────────────────────────────────────────────────

describe('GET /v1/sandbox', () => {
  it('returns active sandbox status', async () => {
    const app = createTestApp();

    // Provision
    await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    // Get status
    const res = await app.request('/v1/sandbox', {
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      data: { status: string; isExpired: boolean; tenantId: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('active');
    expect(body.data.isExpired).toBe(false);
    expect(body.data.tenantId).toMatch(/^sandbox_/);
  });

  it('returns 404 when no sandbox exists', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/sandbox', {
      headers: authHeaders(),
    });

    expect(res.status).toBe(404);
  });

  it('detects expired sandbox', async () => {
    const app = createTestApp();

    // Create an already-expired sandbox
    const expiredSandbox: MockSandbox = {
      id: 'sb-expired',
      developerId: TEST_DEVELOPER_ID,
      tenantId: 'sandbox_expired001',
      expiresAt: new Date(Date.now() - 1000), // 1 second ago
      status: 'active',
      createdAt: new Date(Date.now() - 73 * 60 * 60 * 1000),
      seedDataProfile: 'minimal',
    };
    sandboxStore.set(expiredSandbox.id, expiredSandbox);
    sandboxByDeveloper.set(expiredSandbox.developerId, expiredSandbox);

    const res = await app.request('/v1/sandbox', {
      headers: authHeaders(),
    });

    const body = await res.json() as { data: { isExpired: boolean; status: string } };
    expect(body.data.isExpired).toBe(true);
    expect(body.data.status).toBe('expired');
  });

  it('requires authentication', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/sandbox');
    expect(res.status).toBe(401);
  });
});

// ── Destroy Tests ────────────────────────────────────────────────

describe('DELETE /v1/sandbox', () => {
  it('destroys active sandbox', async () => {
    const app = createTestApp();

    // Provision
    await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    // Destroy
    const res = await app.request('/v1/sandbox', {
      method: 'DELETE',
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { message: string } };
    expect(body.success).toBe(true);
  });

  it('returns 404 when no sandbox to destroy', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/sandbox', {
      method: 'DELETE',
      headers: authHeaders(),
    });

    expect(res.status).toBe(404);
  });

  it('allows creating new sandbox after destroying old one', async () => {
    const app = createTestApp();

    // Provision
    await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    // Destroy
    await app.request('/v1/sandbox', {
      method: 'DELETE',
      headers: authHeaders(),
    });

    // Provision again
    const res = await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
  });

  it('generates audit log for sandbox destruction', async () => {
    const app = createTestApp();

    await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    await app.request('/v1/sandbox', {
      method: 'DELETE',
      headers: authHeaders(),
    });

    const events = auditStore.getAllEvents('developer-portal');
    const destroyEvent = events.find((e) => e.action === 'destroy');
    expect(destroyEvent).toBeDefined();
    expect(destroyEvent!.resource).toBe('sandbox_tenants');
  });
});

// ── Reset Tests ──────────────────────────────────────────────────

describe('POST /v1/sandbox/reset', () => {
  it('resets sandbox to initial seed state', async () => {
    const app = createTestApp();

    // Provision
    await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ seedDataProfile: 'collections' }),
    });

    // Reset
    const res = await app.request('/v1/sandbox/reset', {
      method: 'POST',
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { message: string; seedDataProfile: string } };
    expect(body.success).toBe(true);
    expect(body.data.seedDataProfile).toBe('collections');
  });

  it('returns 404 when no sandbox exists', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/sandbox/reset', {
      method: 'POST',
      headers: authHeaders(),
    });

    expect(res.status).toBe(404);
  });

  it('returns 404 for expired sandbox on reset', async () => {
    const app = createTestApp();

    // Create expired sandbox
    const expired: MockSandbox = {
      id: 'sb-reset-expired',
      developerId: TEST_DEVELOPER_ID,
      tenantId: 'sandbox_resetexp',
      expiresAt: new Date(Date.now() - 1000),
      status: 'active',
      createdAt: new Date(),
      seedDataProfile: 'minimal',
    };
    sandboxStore.set(expired.id, expired);
    sandboxByDeveloper.set(expired.developerId, expired);

    const res = await app.request('/v1/sandbox/reset', {
      method: 'POST',
      headers: authHeaders(),
    });

    expect(res.status).toBe(404);
  });

  it('generates audit log for sandbox reset', async () => {
    const app = createTestApp();

    await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    await app.request('/v1/sandbox/reset', {
      method: 'POST',
      headers: authHeaders(),
    });

    const events = auditStore.getAllEvents('developer-portal');
    const resetEvent = events.find((e) => e.action === 'reset');
    expect(resetEvent).toBeDefined();
  });
});

// ── Security Tests ───────────────────────────────────────────────

describe('Sandbox security', () => {
  it('sandbox tenant ID has sandbox_ prefix for RLS identification', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/sandbox', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const body = await res.json() as { data: { tenantId: string } };
    expect(body.data.tenantId.startsWith('sandbox_')).toBe(true);
  });

  it('returns security headers on all responses', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/sandbox', {
      headers: authHeaders(),
    });

    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
