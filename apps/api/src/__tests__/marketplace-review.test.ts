/**
 * Marketplace Review Pipeline Tests — /api/v1/admin/marketplace endpoints
 *
 * Tests the admin review queue, approve, reject, suspend flows,
 * security review checks, RBAC enforcement, and audit logging.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { marketplaceReviewRouter, configureMarketplaceReviewRoutes } from '../routes/marketplace-review.js';
import { configureAuth } from '../middleware/auth.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import {
  loadKeyPair,
  createAccessToken,
} from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { generateKeyPair } from '@ordr/crypto';

// ─── Mock Data ──────────────────────────────────────────────────

interface MockAgent {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  manifest: Record<string, unknown>;
  packageHash: string;
  downloads: number;
  rating: number | null;
  status: 'draft' | 'review' | 'published' | 'suspended' | 'rejected';
  publisherId: string;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

let jwtConfig: JwtConfig;
let auditLogger: AuditLogger;
let auditStore: InMemoryAuditStore;
let agentStore: Map<string, MockAgent>;
let idCounter: number;

const VALID_HASH = 'b'.repeat(64);

async function makeAdminJwt(overrides: {
  readonly sub?: string;
  readonly tid?: string;
  readonly role?: string;
} = {}): Promise<string> {
  return createAccessToken(jwtConfig, {
    sub: overrides.sub ?? 'admin-001',
    tid: overrides.tid ?? 'system',
    role: (overrides.role ?? 'tenant_admin') as 'tenant_admin',
    permissions: [],
  });
}

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/api/v1/admin/marketplace', marketplaceReviewRouter);
  return app;
}

function seedAgent(overrides: Partial<MockAgent> = {}): MockAgent {
  const id = overrides.id ?? `agent-${String(idCounter++).padStart(3, '0')}`;
  const agent: MockAgent = {
    id,
    name: overrides.name ?? 'review-agent',
    version: overrides.version ?? '1.0.0',
    description: overrides.description ?? 'Agent under review',
    author: overrides.author ?? 'Author',
    license: overrides.license ?? 'MIT',
    manifest: overrides.manifest ?? {
      name: 'review-agent',
      version: '1.0.0',
      minConfidenceThreshold: 0.8,
      maxBudget: { maxTokens: 100000, maxCostCents: 500, maxActions: 50 },
      permissions: [],
      complianceRequirements: [],
      requiredTools: ['search_knowledge'],
    },
    packageHash: overrides.packageHash ?? VALID_HASH,
    downloads: overrides.downloads ?? 0,
    rating: overrides.rating ?? null,
    status: overrides.status ?? 'review',
    publisherId: overrides.publisherId ?? 'dev-001',
    rejectionReason: overrides.rejectionReason ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  };
  agentStore.set(id, agent);
  return agent;
}

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  jwtConfig = await loadKeyPair(privateKey, publicKey, {
    issuer: 'ordr-connect',
    audience: 'ordr-connect',
  });

  configureAuth(jwtConfig);

  auditStore = new InMemoryAuditStore();
  auditLogger = new AuditLogger(auditStore);
  agentStore = new Map<string, MockAgent>();
  idCounter = 1;

  configureMarketplaceReviewRoutes({
    auditLogger,
    listPendingAgents: vi.fn(async () => {
      return [...agentStore.values()].filter((a) => a.status === 'review');
    }),
    findAgentById: vi.fn(async (id: string) => agentStore.get(id) ?? null),
    updateAgentStatus: vi.fn(async (id: string, status: 'published' | 'rejected' | 'suspended', reason?: string) => {
      const agent = agentStore.get(id);
      if (!agent) return null;
      const updated: MockAgent = {
        ...agent,
        status,
        rejectionReason: reason ?? null,
        updatedAt: new Date(),
      };
      agentStore.set(id, updated);
      return updated;
    }),
  });
});

// ─── GET /queue — List Pending Agents ────────────────────────────

describe('GET /api/v1/admin/marketplace/queue', () => {
  it('returns agents in review status', async () => {
    seedAgent({ name: 'pending-1', status: 'review' });
    seedAgent({ name: 'pending-2', status: 'review' });
    seedAgent({ name: 'published-1', status: 'published' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request('/api/v1/admin/marketplace/queue', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
  });

  it('returns empty array when no pending agents', async () => {
    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request('/api/v1/admin/marketplace/queue', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.data).toHaveLength(0);
  });

  it('returns 401 without authentication', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/admin/marketplace/queue');
    expect(res.status).toBe(401);
  });

  it('includes agent metadata in response', async () => {
    seedAgent({ name: 'detailed-agent', author: 'Test Dev', version: '2.1.0', status: 'review' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request('/api/v1/admin/marketplace/queue', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.data[0].name).toBe('detailed-agent');
    expect(body.data[0].author).toBe('Test Dev');
    expect(body.data[0].version).toBe('2.1.0');
  });
});

// ─── POST /:agentId/approve — Approve Agent ─────────────────────

describe('POST /api/v1/admin/marketplace/:agentId/approve', () => {
  it('transitions agent to published status', async () => {
    const agent = seedAgent({ status: 'review' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request(`/api/v1/admin/marketplace/${agent.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('published');
  });

  it('returns 404 for non-existent agent', async () => {
    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request('/api/v1/admin/marketplace/non-existent/approve', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('rejects agent with non-OSI license', async () => {
    const agent = seedAgent({ license: 'Proprietary' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request(`/api/v1/admin/marketplace/${agent.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('security review');
  });

  it('rejects agent with budget exceeding platform limits', async () => {
    const agent = seedAgent({
      manifest: {
        maxBudget: { maxTokens: 2_000_000, maxCostCents: 500, maxActions: 50 },
        minConfidenceThreshold: 0.8,
        permissions: [],
        complianceRequirements: [],
        requiredTools: [],
      },
    });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request(`/api/v1/admin/marketplace/${agent.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
  });

  it('rejects agent with restricted data but no compliance requirements', async () => {
    const agent = seedAgent({
      manifest: {
        maxBudget: { maxTokens: 100000, maxCostCents: 500, maxActions: 50 },
        minConfidenceThreshold: 0.8,
        permissions: ['restricted'],
        complianceRequirements: [],
        requiredTools: [],
      },
    });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request(`/api/v1/admin/marketplace/${agent.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
  });

  it('rejects agent with confidence threshold below 0.7', async () => {
    const agent = seedAgent({
      manifest: {
        maxBudget: { maxTokens: 100000, maxCostCents: 500, maxActions: 50 },
        minConfidenceThreshold: 0.5,
        permissions: [],
        complianceRequirements: [],
        requiredTools: [],
      },
    });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request(`/api/v1/admin/marketplace/${agent.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
  });

  it('audit-logs the approve action', async () => {
    const agent = seedAgent({ status: 'review' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    await app.request(`/api/v1/admin/marketplace/${agent.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    const events = auditStore.getAllEvents('marketplace');
    const approveEvent = events.find((e) => e.action === 'approve_agent');
    expect(approveEvent).toBeDefined();
    expect(approveEvent?.resource).toBe('marketplace_agents');
  });

  it('approves agent with valid OSI license', async () => {
    const agent = seedAgent({ license: 'Apache-2.0' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request(`/api/v1/admin/marketplace/${agent.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
  });

  it('approves agent with restricted data AND compliance requirements', async () => {
    const agent = seedAgent({
      manifest: {
        maxBudget: { maxTokens: 100000, maxCostCents: 500, maxActions: 50 },
        minConfidenceThreshold: 0.8,
        permissions: ['restricted'],
        complianceRequirements: ['hipaa'],
        requiredTools: [],
      },
    });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request(`/api/v1/admin/marketplace/${agent.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
  });
});

// ─── POST /:agentId/reject — Reject Agent ───────────────────────

describe('POST /api/v1/admin/marketplace/:agentId/reject', () => {
  it('transitions agent to rejected with reason', async () => {
    const agent = seedAgent({ status: 'review' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request(`/api/v1/admin/marketplace/${agent.id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Does not meet security requirements' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('rejected');
    expect(body.data.rejectionReason).toBe('Does not meet security requirements');
  });

  it('requires rejection reason', async () => {
    const agent = seedAgent({ status: 'review' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request(`/api/v1/admin/marketplace/${agent.id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('rejects empty reason string', async () => {
    const agent = seedAgent({ status: 'review' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request(`/api/v1/admin/marketplace/${agent.id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: '' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent agent', async () => {
    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request('/api/v1/admin/marketplace/non-existent/reject', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Not found' }),
    });

    expect(res.status).toBe(404);
  });

  it('audit-logs the reject action', async () => {
    const agent = seedAgent({ status: 'review' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    await app.request(`/api/v1/admin/marketplace/${agent.id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Security concern' }),
    });

    const events = auditStore.getAllEvents('marketplace');
    const rejectEvent = events.find((e) => e.action === 'reject_agent');
    expect(rejectEvent).toBeDefined();
  });

  it('includes previous status in audit details', async () => {
    const agent = seedAgent({ status: 'review' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    await app.request(`/api/v1/admin/marketplace/${agent.id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Rejected' }),
    });

    const events = auditStore.getAllEvents('marketplace');
    const rejectEvent = events.find((e) => e.action === 'reject_agent');
    expect(rejectEvent?.details).toHaveProperty('previousStatus', 'review');
  });
});

// ─── POST /:agentId/suspend — Suspend Agent ─────────────────────

describe('POST /api/v1/admin/marketplace/:agentId/suspend', () => {
  it('transitions published agent to suspended', async () => {
    const agent = seedAgent({ status: 'published' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request(`/api/v1/admin/marketplace/${agent.id}/suspend`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Security vulnerability found' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('suspended');
  });

  it('requires suspension reason', async () => {
    const agent = seedAgent({ status: 'published' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request(`/api/v1/admin/marketplace/${agent.id}/suspend`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent agent', async () => {
    const app = createTestApp();
    const token = await makeAdminJwt();
    const res = await app.request('/api/v1/admin/marketplace/non-existent/suspend', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Not found' }),
    });

    expect(res.status).toBe(404);
  });

  it('audit-logs the suspend action', async () => {
    const agent = seedAgent({ status: 'published' });

    const app = createTestApp();
    const token = await makeAdminJwt();
    await app.request(`/api/v1/admin/marketplace/${agent.id}/suspend`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Vulnerability' }),
    });

    const events = auditStore.getAllEvents('marketplace');
    const suspendEvent = events.find((e) => e.action === 'suspend_agent');
    expect(suspendEvent).toBeDefined();
    expect(suspendEvent?.resource).toBe('marketplace_agents');
  });
});

// ─── RBAC Enforcement ────────────────────────────────────────────

describe('RBAC enforcement', () => {
  it('returns 401 without auth for all routes', async () => {
    const app = createTestApp();

    const routes = [
      { method: 'GET', path: '/api/v1/admin/marketplace/queue' },
      { method: 'POST', path: '/api/v1/admin/marketplace/agent-1/approve' },
      { method: 'POST', path: '/api/v1/admin/marketplace/agent-1/reject' },
      { method: 'POST', path: '/api/v1/admin/marketplace/agent-1/suspend' },
    ];

    for (const route of routes) {
      const res = await app.request(route.path, {
        method: route.method,
        ...(route.method === 'POST' ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'test' }),
        } : {}),
      });
      expect(res.status).toBe(401);
    }
  });
});

// ─── Audit Logging Aggregate ─────────────────────────────────────

describe('Audit logging completeness', () => {
  it('all admin review actions produce audit events', async () => {
    const agent1 = seedAgent({ name: 'approve-me', status: 'review' });
    const agent2 = seedAgent({ name: 'reject-me', status: 'review' });
    const agent3 = seedAgent({ name: 'suspend-me', status: 'published' });

    const app = createTestApp();
    const token = await makeAdminJwt();

    await app.request(`/api/v1/admin/marketplace/${agent1.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    await app.request(`/api/v1/admin/marketplace/${agent2.id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Not suitable' }),
    });

    await app.request(`/api/v1/admin/marketplace/${agent3.id}/suspend`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'CVE found' }),
    });

    const events = auditStore.getAllEvents('marketplace');
    const reviewActions = events.filter((e) =>
      ['approve_agent', 'reject_agent', 'suspend_agent'].includes(e.action),
    );
    expect(reviewActions.length).toBe(3);
  });
});
