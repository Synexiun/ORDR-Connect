// apps/api/src/__tests__/developer-webhooks.test.ts
/**
 * Developer Webhooks Route Tests — /api/v1/developers/webhooks
 *
 * Tests: list, create (valid/invalid URL/SSRF/events/limit), delete, toggle.
 * SECURITY invariants: hmacSecretEncrypted never in responses.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { developerWebhooksRouter, configureWebhookRoutes } from '../routes/developer-webhooks.js';
import { configureAuth } from '../middleware/auth.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import { loadKeyPair, createAccessToken } from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { generateKeyPair } from '@ordr/crypto';
import type { WebhookRecord } from '@ordr/db';

// ─── Mock dns — prevent real DNS lookups in tests ──────────────────

vi.mock('node:dns', () => ({
  promises: {
    lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────

let jwtConfig: JwtConfig;
let auditLogger: AuditLogger;
let webhookStore: Map<string, WebhookRecord>;
let idCounter: number;

async function makeJwt(sub = 'dev-001'): Promise<string> {
  return createAccessToken(jwtConfig, {
    sub,
    tid: 'developer-portal',
    role: 'tenant_admin' as const,
    permissions: [],
  });
}

function makeWebhook(overrides: Partial<WebhookRecord> = {}): WebhookRecord {
  const id = `wh-${String(idCounter++).padStart(3, '0')}`;
  return {
    id,
    developerId: 'dev-001',
    url: 'https://example.com/hook',
    events: ['customer.created'],
    hmacSecretEncrypted: 'enc:secret',
    active: true,
    lastTriggeredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/api/v1/developers/webhooks', developerWebhooksRouter);
  return app;
}

// ─── Setup ──────────────────────────────────────────────────────────

beforeEach(async () => {
  const { privateKey, publicKey } = generateKeyPair();
  jwtConfig = await loadKeyPair(privateKey, publicKey, {
    issuer: 'ordr-connect',
    audience: 'ordr-connect',
  });
  configureAuth(jwtConfig);

  const auditStore = new InMemoryAuditStore();
  auditLogger = new AuditLogger(auditStore);
  webhookStore = new Map();
  idCounter = 1;

  configureWebhookRoutes({
    auditLogger,
    fieldEncryptor: {
      encryptField: vi.fn((_field: string, value: string) => `enc:${value}`),
    } as never,
    createWebhook: vi.fn(
      (data: {
        developerId: string;
        url: string;
        events: string[];
        hmacSecretEncrypted: string;
      }) => {
        const wh = makeWebhook({ ...data, id: `wh-${String(idCounter++).padStart(3, '0')}` });
        webhookStore.set(wh.id, wh);
        return Promise.resolve(wh);
      },
    ),
    listWebhooks: vi.fn((developerId: string) =>
      Promise.resolve([...webhookStore.values()].filter((w) => w.developerId === developerId)),
    ),
    countActiveWebhooks: vi.fn((developerId: string) =>
      Promise.resolve(
        [...webhookStore.values()].filter((w) => w.developerId === developerId && w.active).length,
      ),
    ),
    findWebhook: vi.fn((developerId: string, webhookId: string) => {
      const wh = webhookStore.get(webhookId);
      return Promise.resolve(wh && wh.developerId === developerId ? wh : null);
    }),
    // Updated signature: (developerId, webhookId)
    deleteWebhook: vi.fn((_developerId: string, webhookId: string) => {
      webhookStore.delete(webhookId);
      return Promise.resolve();
    }),
    // Updated signature: (developerId, webhookId, active)
    toggleWebhook: vi.fn((_developerId: string, webhookId: string, active: boolean) => {
      const wh = webhookStore.get(webhookId);
      if (!wh) throw new Error('not found');
      const updated = { ...wh, active };
      webhookStore.set(webhookId, updated);
      return Promise.resolve(updated);
    }),
  });
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('GET /api/v1/developers/webhooks', () => {
  it('returns webhook list without hmacSecretEncrypted', async () => {
    const token = await makeJwt();
    const existing = makeWebhook();
    webhookStore.set(existing.id, existing);

    const app = createTestApp();
    const res = await app.request('/api/v1/developers/webhooks', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
    const item = body.data[0] as Record<string, unknown>;
    expect(item.id).toBe(existing.id);
    expect(item.hmacSecretEncrypted).toBeUndefined();
  });

  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/developers/webhooks');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/developers/webhooks', () => {
  it('creates webhook and returns hmacSecret once', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['customer.created'] }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(typeof body.data.hmacSecret).toBe('string');
    expect((body.data.hmacSecret as string).length).toBe(64);
    expect(body.data.hmacSecretEncrypted).toBeUndefined();
  });

  it('rejects http:// URL (non-HTTPS)', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://example.com/hook', events: ['customer.created'] }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects private IP (SSRF protection)', async () => {
    const { promises: dns } = await import('node:dns');
    (dns.lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      address: '192.168.1.1',
      family: 4,
    });

    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://internal.example.com/hook',
        events: ['customer.created'],
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects unknown event type', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['not.a.real.event'] }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects empty events array', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', events: [] }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects when at the 10-webhook limit', async () => {
    const token = await makeJwt();
    for (let i = 0; i < 10; i++) {
      webhookStore.set(`wh-${i}`, makeWebhook({ id: `wh-${i}` }));
    }

    const app = createTestApp();
    const res = await app.request('/api/v1/developers/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['customer.created'] }),
    });

    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/developers/webhooks/:webhookId', () => {
  it('deletes an owned webhook', async () => {
    const token = await makeJwt();
    const wh = makeWebhook({ id: 'wh-to-delete' });
    webhookStore.set(wh.id, wh);

    const app = createTestApp();
    const res = await app.request(`/api/v1/developers/webhooks/${wh.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(webhookStore.has(wh.id)).toBe(false);
  });

  it('returns 404 for unowned webhook', async () => {
    const token = await makeJwt('dev-001');
    const wh = makeWebhook({ id: 'wh-other', developerId: 'dev-999' });
    webhookStore.set(wh.id, wh);

    const app = createTestApp();
    const res = await app.request(`/api/v1/developers/webhooks/${wh.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/developers/webhooks/:webhookId/toggle', () => {
  it('toggles active state and never leaks hmacSecretEncrypted', async () => {
    const token = await makeJwt();
    const wh = makeWebhook({ id: 'wh-toggle', active: true });
    webhookStore.set(wh.id, wh);

    const app = createTestApp();
    const res = await app.request(`/api/v1/developers/webhooks/${wh.id}/toggle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.active).toBe(false);
    expect(body.data.hmacSecretEncrypted).toBeUndefined();
  });

  it('returns 404 for unowned webhook', async () => {
    const token = await makeJwt('dev-001');
    const wh = makeWebhook({ id: 'wh-other-toggle', developerId: 'dev-999' });
    webhookStore.set(wh.id, wh);

    const app = createTestApp();
    const res = await app.request(`/api/v1/developers/webhooks/${wh.id}/toggle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });

    expect(res.status).toBe(404);
  });
});
