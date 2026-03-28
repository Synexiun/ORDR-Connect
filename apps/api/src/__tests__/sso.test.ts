/**
 * SSO Route Tests — /api/v1/sso endpoints
 *
 * Tests authorization redirect, callback exchange, connection management,
 * and admin-only access enforcement.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ssoRouter, configureSSORoutes } from '../routes/sso.js';
import { configureAuth } from '../middleware/auth.js';
import { configureBillingGate } from '../middleware/plan-gate.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import {
  SSOManager,
  InMemorySSOClient,
  InMemorySSOConnectionStore,
  loadKeyPair,
  createAccessToken,
} from '@ordr/auth';
import type { SSOManagerConfig, JwtConfig } from '@ordr/auth';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { generateKeyPair, FieldEncryptor } from '@ordr/crypto';
import { SubscriptionManager, InMemorySubscriptionStore, MockStripeClient } from '@ordr/billing';

// ─── Fixtures ─────────────────────────────────────────────────────

const STATE_KEY = 'aa'.repeat(32); // 64 hex chars = 32 bytes for AES-256

let jwtConfig: JwtConfig;

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
  app.route('/api/v1/sso', ssoRouter);
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

  const client = new InMemorySSOClient();
  const connectionStore = new InMemorySSOConnectionStore();
  const auditStore = new InMemoryAuditStore();
  const auditLogger = new AuditLogger(auditStore);

  const ssoConfig: SSOManagerConfig = {
    apiKey: 'test-key',
    clientId: 'test-client',
    redirectUri: 'https://app.test/callback',
  };

  const manager = new SSOManager(ssoConfig, client, connectionStore, STATE_KEY);
  configureSSORoutes({ ssoManager: manager, auditLogger });

  // Configure billing gate — connections routes use featureGate(FEATURES.SSO)
  const subStore = new InMemorySubscriptionStore();
  await subStore.saveSubscription({
    id: 'sub-sso-test',
    tenant_id: 'tenant-001',
    stripe_subscription_id: 'stripe-sso-test',
    plan_tier: 'professional',
    status: 'active',
    current_period_start: new Date('2026-01-01'),
    current_period_end: new Date('2027-01-01'),
    cancel_at_period_end: false,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
  });
  configureBillingGate(
    new SubscriptionManager({
      store: subStore,
      stripe: new MockStripeClient(),
      auditLogger: new AuditLogger(new InMemoryAuditStore()),
      fieldEncryptor: new FieldEncryptor(Buffer.from('test-key-32-bytes-for-unit-tests!')),
    }),
  );

  // Create a test connection
  await manager.createSSOConnection('tenant-001', {
    name: 'Test SAML',
    type: 'saml',
    provider: 'okta',
    metadata: 'https://idp.test/metadata',
  });
});

// ─── GET /authorize Tests ─────────────────────────────────────────

describe('GET /api/v1/sso/authorize', () => {
  it('returns 400 when connectionId is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/sso/authorize?tenantId=tenant-001');
    expect(res.status).toBe(400);
  });

  it('returns 400 when tenantId is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/sso/authorize?connectionId=conn-001');
    expect(res.status).toBe(400);
  });
});

// ─── GET /callback Tests ──────────────────────────────────────────

describe('GET /api/v1/sso/callback', () => {
  it('returns 401 when code is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/sso/callback?state=test');
    expect(res.status).toBe(401);
  });

  it('returns 401 when state is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/sso/callback?code=test');
    expect(res.status).toBe(401);
  });
});

// ─── GET /connections Tests ───────────────────────────────────────

describe('GET /api/v1/sso/connections', () => {
  it('returns 401 without authentication', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/sso/connections');
    expect(res.status).toBe(401);
  });

  it('returns connections when authenticated', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/sso/connections', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// ─── POST /connections Tests ──────────────────────────────────────

describe('POST /api/v1/sso/connections', () => {
  it('returns 401 without authentication', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/sso/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New SSO',
        type: 'saml',
        provider: 'okta',
        metadata: 'meta',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'viewer' });
    const res = await app.request('/api/v1/sso/connections', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'New SSO',
        type: 'saml',
        provider: 'okta',
        metadata: 'meta',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('creates a connection for admin users', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });
    const res = await app.request('/api/v1/sso/connections', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'New SSO',
        type: 'saml',
        provider: 'okta',
        metadata: 'https://idp.test/metadata',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: { name: string } };
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('New SSO');
  });

  it('returns 400 for invalid input', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });
    const res = await app.request('/api/v1/sso/connections', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /connections/:id Tests ────────────────────────────────

describe('DELETE /api/v1/sso/connections/:id', () => {
  it('returns 401 without authentication', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/sso/connections/test-id', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'agent' });
    const res = await app.request('/api/v1/sso/connections/test-id', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });
});
