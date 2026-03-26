/**
 * Webhook Test Route Tests — /v1/webhook-test endpoints
 *
 * Tests echo functionality, event simulation, body hash verification,
 * unknown event rejection, and audit logging.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { createPortalApp } from '../app.js';
import { configureDeveloperRoutes } from '../routes/developers.js';
import { configureSandboxRoutes } from '../routes/sandbox.js';
import { configureWebhookRoutes, SUPPORTED_EVENTS } from '../routes/webhooks.js';
import { configureApiKeyAuth, hashApiKey, clearRateLimitStore } from '../middleware/api-key-auth.js';
import type { Env } from '../types.js';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';

// ── Test Fixtures ─────────────────────────────────────────────────

const TEST_API_KEY = 'devk_wh_test1234567890abcdef1234567890abcdef12345678';
const TEST_DEVELOPER_ID = 'dev-webhook-test';

let auditStore: InMemoryAuditStore;
let auditLogger: AuditLogger;
let deliveredPayloads: Array<{ url: string; payload: Record<string, unknown> }>;

function createTestApp(): Hono<Env> {
  return createPortalApp({ corsOrigins: [], nodeEnv: 'test' });
}

function authHeaders(): Record<string, string> {
  return { 'X-API-Key': TEST_API_KEY, 'Content-Type': 'application/json' };
}

// ── Setup ────────────────────────────────────────────────────────

beforeEach(async () => {
  clearRateLimitStore();
  deliveredPayloads = [];

  auditStore = new InMemoryAuditStore();
  auditLogger = new AuditLogger(auditStore);

  const keyHash = hashApiKey(TEST_API_KEY);
  configureApiKeyAuth({
    findByKeyHash: async (kh) => {
      if (kh === keyHash) {
        return {
          id: TEST_DEVELOPER_ID,
          email: 'webhook-dev@example.com',
          tier: 'free' as const,
          rateLimitRpm: 60,
          status: 'active' as const,
        };
      }
      return null;
    },
    updateLastActive: async () => {},
  });

  // Configure minimal developer + sandbox routes (required by app)
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
    findActiveSandbox: async () => null,
    findSandboxById: async () => null,
    createSandbox: async () => { throw new Error('not used'); },
    destroySandbox: async () => {},
    resetSandbox: async () => { throw new Error('not used'); },
  });

  configureWebhookRoutes({
    auditLogger,
    deliverWebhook: async (url, payload) => {
      deliveredPayloads.push({ url, payload });
      return true;
    },
  });
});

// ── Echo Tests ───────────────────────────────────────────────────

describe('POST /v1/webhook-test/echo', () => {
  it('echoes request body back with metadata', async () => {
    const app = createTestApp();
    const payload = { test: 'data', nested: { key: 'value' } };

    const res = await app.request('/v1/webhook-test/echo', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      data: {
        echo: { test: string; nested: { key: string } };
        metadata: { timestamp: string; bodyHash: string; bodyLength: number; requestId: string };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.echo).toEqual(payload);
    expect(body.data.metadata.timestamp).toBeDefined();
    expect(body.data.metadata.bodyHash).toBeDefined();
    expect(body.data.metadata.bodyLength).toBeGreaterThan(0);
    expect(body.data.metadata.requestId).toBeDefined();
  });

  it('includes SHA-256 body hash in metadata', async () => {
    const app = createTestApp();
    const payload = '{"hello":"world"}';
    const expectedHash = createHash('sha256').update(payload).digest('hex');

    const res = await app.request('/v1/webhook-test/echo', {
      method: 'POST',
      headers: authHeaders(),
      body: payload,
    });

    const body = await res.json() as { data: { metadata: { bodyHash: string } } };
    expect(body.data.metadata.bodyHash).toBe(expectedHash);
  });

  it('includes received headers (excluding sensitive ones)', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/webhook-test/echo', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'X-Custom-Header': 'test-value',
      },
      body: JSON.stringify({ test: true }),
    });

    const body = await res.json() as {
      data: { metadata: { headersReceived: Record<string, string> } };
    };
    expect(body.data.metadata.headersReceived).toBeDefined();
    // Sensitive headers should be excluded
    expect(body.data.metadata.headersReceived).not.toHaveProperty('x-api-key');
    expect(body.data.metadata.headersReceived).not.toHaveProperty('authorization');
  });

  it('handles non-JSON body gracefully', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/webhook-test/echo', {
      method: 'POST',
      headers: { 'X-API-Key': TEST_API_KEY, 'Content-Type': 'text/plain' },
      body: 'plain text body',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { echo: string } };
    expect(body.data.echo).toBe('plain text body');
  });

  it('generates audit log for echo', async () => {
    const app = createTestApp();
    await app.request('/v1/webhook-test/echo', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ test: true }),
    });

    const events = auditStore.getAllEvents('developer-portal');
    const echoEvent = events.find((e) => e.action === 'echo');
    expect(echoEvent).toBeDefined();
    expect(echoEvent!.resource).toBe('webhook_test');
  });

  it('requires authentication', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/webhook-test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    });

    expect(res.status).toBe(401);
  });

  it('returns correct body length', async () => {
    const app = createTestApp();
    const payload = JSON.stringify({ key: 'a'.repeat(100) });

    const res = await app.request('/v1/webhook-test/echo', {
      method: 'POST',
      headers: authHeaders(),
      body: payload,
    });

    const body = await res.json() as { data: { metadata: { bodyLength: number } } };
    expect(body.data.metadata.bodyLength).toBe(payload.length);
  });
});

// ── Simulate Tests ───────────────────────────────────────────────

describe('POST /v1/webhook-test/simulate/:event', () => {
  it('generates sample payload for customer.created', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/webhook-test/simulate/customer.created', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      data: { eventType: string; payload: Record<string, unknown>; payloadHash: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.eventType).toBe('customer.created');
    expect(body.data.payload).toBeDefined();
    expect(body.data.payloadHash).toBeDefined();
  });

  it('generates sample payload for agent.completed', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/webhook-test/simulate/agent.completed', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });

    const body = await res.json() as { data: { eventType: string; payload: { event: string } } };
    expect(body.data.eventType).toBe('agent.completed');
    expect(body.data.payload.event).toBe('agent.completed');
  });

  it('generates sample payload for compliance.violation', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/webhook-test/simulate/compliance.violation', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });

    const body = await res.json() as { data: { eventType: string; payload: { data: { regulation: string } } } };
    expect(body.data.eventType).toBe('compliance.violation');
    expect(body.data.payload.data.regulation).toBe('HIPAA');
  });

  it('rejects unknown event type', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/webhook-test/simulate/unknown.event', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toContain('Unknown event type');
  });

  it('delivers to webhook URL when provided', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/webhook-test/simulate/customer.created', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ webhookUrl: 'https://example.com/webhook' }),
    });

    const body = await res.json() as { data: { delivered: boolean } };
    expect(body.data.delivered).toBe(true);
    expect(deliveredPayloads.length).toBe(1);
    expect(deliveredPayloads[0]!.url).toBe('https://example.com/webhook');
  });

  it('marks delivered as false when no webhook URL provided', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/webhook-test/simulate/customer.created', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });

    const body = await res.json() as { data: { delivered: boolean } };
    expect(body.data.delivered).toBe(false);
  });

  it('includes SHA-256 payload hash', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/webhook-test/simulate/message.delivered', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });

    const body = await res.json() as { data: { payloadHash: string } };
    expect(body.data.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates audit log for simulate', async () => {
    const app = createTestApp();
    await app.request('/v1/webhook-test/simulate/customer.created', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });

    const events = auditStore.getAllEvents('developer-portal');
    const simEvent = events.find((e) => e.action === 'simulate');
    expect(simEvent).toBeDefined();
    expect(simEvent!.resource).toBe('webhook_test');
  });

  it('supports all declared event types', async () => {
    const app = createTestApp();

    for (const eventType of SUPPORTED_EVENTS) {
      const res = await app.request(`/v1/webhook-test/simulate/${eventType}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { eventType: string } };
      expect(body.data.eventType).toBe(eventType);
    }
  });

  it('does not expose webhook URL in response', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/webhook-test/simulate/customer.created', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ webhookUrl: 'https://secret.example.com/hook' }),
    });

    const body = await res.json() as { data: { deliveredTo: string } };
    expect(body.data.deliveredTo).toBe('[provided]');
  });
});
