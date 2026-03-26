/**
 * Marketplace Route Tests — /api/v1/marketplace endpoints
 *
 * Tests listing, search, detail, publish, update, install, uninstall,
 * review submission, review listing, auth enforcement, validation,
 * ownership checks, and audit logging.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { marketplaceRouter, configureMarketplaceRoutes } from '../routes/marketplace.js';
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

interface MockReview {
  id: string;
  agentId: string;
  reviewerId: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
}

interface MockInstall {
  id: string;
  tenantId: string;
  agentId: string;
  version: string;
  status: 'active' | 'disabled' | 'uninstalled';
  installedAt: Date;
}

let jwtConfig: JwtConfig;
let auditLogger: AuditLogger;
let auditStore: InMemoryAuditStore;
let agentStore: Map<string, MockAgent>;
let reviewStore: Map<string, MockReview>;
let installStore: Map<string, MockInstall>;
let idCounter: number;

const VALID_HASH = 'a'.repeat(64);

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
  app.route('/api/v1/marketplace', marketplaceRouter);
  return app;
}

function seedAgent(overrides: Partial<MockAgent> = {}): MockAgent {
  const id = overrides.id ?? `agent-${String(idCounter++).padStart(3, '0')}`;
  const agent: MockAgent = {
    id,
    name: overrides.name ?? 'test-agent',
    version: overrides.version ?? '1.0.0',
    description: overrides.description ?? 'A test agent',
    author: overrides.author ?? 'Test Author',
    license: overrides.license ?? 'MIT',
    manifest: overrides.manifest ?? { name: 'test-agent', version: '1.0.0' },
    packageHash: overrides.packageHash ?? VALID_HASH,
    downloads: overrides.downloads ?? 0,
    rating: overrides.rating ?? null,
    status: overrides.status ?? 'published',
    publisherId: overrides.publisherId ?? 'user-001',
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
  reviewStore = new Map<string, MockReview>();
  installStore = new Map<string, MockInstall>();
  idCounter = 1;

  configureMarketplaceRoutes({
    auditLogger,
    listPublishedAgents: vi.fn(async ({ limit, offset, search }) => {
      let agents = [...agentStore.values()].filter((a) => a.status === 'published');
      if (search) {
        const q = search.toLowerCase();
        agents = agents.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));
      }
      const total = agents.length;
      agents = agents.slice(offset, offset + limit);
      return { agents, total };
    }),
    findAgentById: vi.fn(async (id: string) => agentStore.get(id) ?? null),
    findAgentByNameVersion: vi.fn(async (name: string, version: string) => {
      for (const a of agentStore.values()) {
        if (a.name === name && a.version === version) return a;
      }
      return null;
    }),
    createAgent: vi.fn(async (data) => {
      const id = `agent-${String(idCounter++).padStart(3, '0')}`;
      const agent: MockAgent = {
        id,
        ...data,
        downloads: 0,
        rating: null,
        status: 'review',
        rejectionReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      agentStore.set(id, agent);
      return agent;
    }),
    updateAgent: vi.fn(async (id: string, data) => {
      const agent = agentStore.get(id);
      if (!agent) return null;
      const updated: MockAgent = {
        ...agent,
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.manifest !== undefined ? { manifest: data.manifest } : {}),
        ...(data.packageHash !== undefined ? { packageHash: data.packageHash } : {}),
        updatedAt: new Date(),
      };
      agentStore.set(id, updated);
      return updated;
    }),
    incrementDownloads: vi.fn(async (id: string) => {
      const agent = agentStore.get(id);
      if (agent) {
        agentStore.set(id, { ...agent, downloads: agent.downloads + 1 });
      }
    }),
    createInstall: vi.fn(async (data) => {
      const id = `install-${String(idCounter++).padStart(3, '0')}`;
      const install: MockInstall = {
        id,
        tenantId: data.tenantId,
        agentId: data.agentId,
        version: data.version,
        status: 'active',
        installedAt: new Date(),
      };
      installStore.set(`${data.tenantId}:${data.agentId}`, install);
      return install;
    }),
    findInstall: vi.fn(async (tenantId: string, agentId: string) => {
      return installStore.get(`${tenantId}:${agentId}`) ?? null;
    }),
    removeInstall: vi.fn(async (tenantId: string, agentId: string) => {
      const key = `${tenantId}:${agentId}`;
      if (!installStore.has(key)) return false;
      installStore.delete(key);
      return true;
    }),
    createReview: vi.fn(async (data) => {
      const id = `review-${String(idCounter++).padStart(3, '0')}`;
      const review: MockReview = {
        id,
        agentId: data.agentId,
        reviewerId: data.reviewerId,
        rating: data.rating,
        comment: data.comment,
        createdAt: new Date(),
      };
      reviewStore.set(`${data.agentId}:${data.reviewerId}`, review);
      return review;
    }),
    findReviewByUser: vi.fn(async (agentId: string, reviewerId: string) => {
      return reviewStore.get(`${agentId}:${reviewerId}`) ?? null;
    }),
    listReviews: vi.fn(async (agentId: string) => {
      const reviews: MockReview[] = [];
      for (const r of reviewStore.values()) {
        if (r.agentId === agentId) reviews.push(r);
      }
      return reviews;
    }),
  });
});

// ─── GET /v1/marketplace — List Published Agents ─────────────────

describe('GET /api/v1/marketplace', () => {
  it('returns published agents', async () => {
    seedAgent({ name: 'agent-alpha', status: 'published' });
    seedAgent({ name: 'agent-beta', status: 'published' });
    seedAgent({ name: 'agent-draft', status: 'draft' });

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
  });

  it('supports pagination with limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      seedAgent({ name: `agent-${String(i)}`, version: `${String(i)}.0.0`, status: 'published' });
    }

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace?limit=2&offset=1', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta.limit).toBe(2);
    expect(body.meta.offset).toBe(1);
  });

  it('supports search query', async () => {
    seedAgent({ name: 'billing-agent', description: 'Handles billing', status: 'published' });
    seedAgent({ name: 'support-agent', description: 'Handles support', status: 'published' });

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace?search=billing', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('billing-agent');
  });

  it('returns meta with total count', async () => {
    seedAgent({ status: 'published' });

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.meta).toBeDefined();
    expect(body.meta.total).toBe(1);
  });

  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/marketplace');
    expect(res.status).toBe(401);
  });

  it('returns empty array when no published agents', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.data).toHaveLength(0);
    expect(body.meta.total).toBe(0);
  });

  it('rejects invalid limit parameter', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace?limit=0', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
  });

  it('does not return draft agents', async () => {
    seedAgent({ name: 'draft-agent', status: 'draft' });

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.data).toHaveLength(0);
  });
});

// ─── GET /v1/marketplace/:agentId — Agent Detail ─────────────────

describe('GET /api/v1/marketplace/:agentId', () => {
  it('returns agent detail', async () => {
    const agent = seedAgent({ name: 'detail-agent' });

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request(`/api/v1/marketplace/${agent.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(agent.id);
    expect(body.data.name).toBe('detail-agent');
    expect(body.data.manifest).toBeDefined();
  });

  it('returns 404 for non-existent agent', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace/non-existent', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('includes package hash in response', async () => {
    const agent = seedAgent();

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request(`/api/v1/marketplace/${agent.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.data.packageHash).toBe(VALID_HASH);
  });

  it('includes publisher ID in response', async () => {
    const agent = seedAgent({ publisherId: 'pub-123' });

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request(`/api/v1/marketplace/${agent.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.data.publisherId).toBe('pub-123');
  });
});

// ─── POST /v1/marketplace — Publish Agent ────────────────────────

describe('POST /api/v1/marketplace', () => {
  it('publishes a new agent with valid data', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'new-agent',
        version: '1.0.0',
        description: 'A new agent',
        author: 'Author',
        license: 'MIT',
        manifest: { name: 'new-agent' },
        packageHash: VALID_HASH,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('new-agent');
    expect(body.data.status).toBe('review');
  });

  it('validates manifest is provided', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'test',
        version: '1.0.0',
        description: 'test',
        author: 'test',
        license: 'MIT',
        packageHash: VALID_HASH,
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects invalid semver version', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'test',
        version: 'not-semver',
        description: 'test',
        author: 'test',
        license: 'MIT',
        manifest: {},
        packageHash: VALID_HASH,
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate name+version', async () => {
    seedAgent({ name: 'dup-agent', version: '1.0.0' });

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'dup-agent',
        version: '1.0.0',
        description: 'duplicate',
        author: 'test',
        license: 'MIT',
        manifest: {},
        packageHash: VALID_HASH,
      }),
    });

    expect(res.status).toBe(409);
  });

  it('rejects invalid package hash length', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'test',
        version: '1.0.0',
        description: 'test',
        author: 'test',
        license: 'MIT',
        manifest: {},
        packageHash: 'short',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects empty name', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: '',
        version: '1.0.0',
        description: 'test',
        author: 'test',
        license: 'MIT',
        manifest: {},
        packageHash: VALID_HASH,
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects missing description', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'test',
        version: '1.0.0',
        author: 'test',
        license: 'MIT',
        manifest: {},
        packageHash: VALID_HASH,
      }),
    });

    expect(res.status).toBe(400);
  });

  it('audit-logs the publish action', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    await app.request('/api/v1/marketplace', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'audit-agent',
        version: '1.0.0',
        description: 'test',
        author: 'test',
        license: 'MIT',
        manifest: {},
        packageHash: VALID_HASH,
      }),
    });

    const events = [...auditStore.getAllEvents('marketplace'), ...auditStore.getAllEvents('tenant-001')];
    const publishEvent = events.find((e) => e.action === 'publish_agent');
    expect(publishEvent).toBeDefined();
    expect(publishEvent?.resource).toBe('marketplace_agents');
  });

  it('returns 401 without auth', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/marketplace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'test',
        version: '1.0.0',
        description: 'test',
        author: 'test',
        license: 'MIT',
        manifest: {},
        packageHash: VALID_HASH,
      }),
    });

    expect(res.status).toBe(401);
  });
});

// ─── PUT /v1/marketplace/:agentId — Update Listing ───────────────

describe('PUT /api/v1/marketplace/:agentId', () => {
  it('updates agent listing for owner', async () => {
    const agent = seedAgent({ publisherId: 'user-001' });

    const app = createTestApp();
    const token = await makeJwt({ sub: 'user-001' });
    const res = await app.request(`/api/v1/marketplace/${agent.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ description: 'Updated description' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.description).toBe('Updated description');
  });

  it('rejects non-owner update', async () => {
    const agent = seedAgent({ publisherId: 'other-user' });

    const app = createTestApp();
    const token = await makeJwt({ sub: 'user-001' });
    const res = await app.request(`/api/v1/marketplace/${agent.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ description: 'Hacked' }),
    });

    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent agent', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace/non-existent', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ description: 'Update' }),
    });

    expect(res.status).toBe(404);
  });

  it('audit-logs the update action', async () => {
    const agent = seedAgent({ publisherId: 'user-001' });

    const app = createTestApp();
    const token = await makeJwt({ sub: 'user-001' });
    await app.request(`/api/v1/marketplace/${agent.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ description: 'Updated' }),
    });

    const events = [...auditStore.getAllEvents('marketplace'), ...auditStore.getAllEvents('tenant-001')];
    const updateEvent = events.find((e) => e.action === 'update_agent');
    expect(updateEvent).toBeDefined();
  });
});

// ─── POST /v1/marketplace/:agentId/install — Install Agent ───────

describe('POST /api/v1/marketplace/:agentId/install', () => {
  it('installs a published agent for tenant', async () => {
    const agent = seedAgent({ status: 'published' });

    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });
    const res = await app.request(`/api/v1/marketplace/${agent.id}/install`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.agentId).toBe(agent.id);
    expect(body.data.status).toBe('active');
  });

  it('rejects install of non-published agent', async () => {
    const agent = seedAgent({ status: 'draft' });

    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });
    const res = await app.request(`/api/v1/marketplace/${agent.id}/install`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate install', async () => {
    const agent = seedAgent({ status: 'published' });

    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    // First install
    await app.request(`/api/v1/marketplace/${agent.id}/install`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    // Duplicate
    const res = await app.request(`/api/v1/marketplace/${agent.id}/install`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(409);
  });

  it('returns 404 for non-existent agent', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });
    const res = await app.request('/api/v1/marketplace/non-existent/install', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('increments download count on install', async () => {
    const agent = seedAgent({ status: 'published', downloads: 5 });

    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });
    await app.request(`/api/v1/marketplace/${agent.id}/install`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    const updated = agentStore.get(agent.id);
    expect(updated?.downloads).toBe(6);
  });

  it('audit-logs the install action', async () => {
    const agent = seedAgent({ status: 'published' });

    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });
    await app.request(`/api/v1/marketplace/${agent.id}/install`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    const events = [...auditStore.getAllEvents('marketplace'), ...auditStore.getAllEvents('tenant-001')];
    const installEvent = events.find((e) => e.action === 'install_agent');
    expect(installEvent).toBeDefined();
    expect(installEvent?.resource).toBe('marketplace_installs');
  });
});

// ─── DELETE /v1/marketplace/:agentId/install — Uninstall Agent ───

describe('DELETE /api/v1/marketplace/:agentId/install', () => {
  it('uninstalls agent for tenant', async () => {
    const agent = seedAgent({ status: 'published' });

    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    // Install first
    await app.request(`/api/v1/marketplace/${agent.id}/install`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    // Uninstall
    const res = await app.request(`/api/v1/marketplace/${agent.id}/install`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 404 when no installation exists', async () => {
    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });
    const res = await app.request('/api/v1/marketplace/non-existent/install', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('audit-logs the uninstall action', async () => {
    const agent = seedAgent({ status: 'published' });

    const app = createTestApp();
    const token = await makeJwt({ role: 'tenant_admin' });

    await app.request(`/api/v1/marketplace/${agent.id}/install`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    await app.request(`/api/v1/marketplace/${agent.id}/install`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    const events = [...auditStore.getAllEvents('marketplace'), ...auditStore.getAllEvents('tenant-001')];
    const uninstallEvent = events.find((e) => e.action === 'uninstall_agent');
    expect(uninstallEvent).toBeDefined();
  });
});

// ─── POST /v1/marketplace/:agentId/review — Submit Review ────────

describe('POST /api/v1/marketplace/:agentId/review', () => {
  it('submits a review with valid rating', async () => {
    const agent = seedAgent();

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request(`/api/v1/marketplace/${agent.id}/review`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 4, comment: 'Great agent' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.rating).toBe(4);
    expect(body.data.comment).toBe('Great agent');
  });

  it('rejects rating below 1', async () => {
    const agent = seedAgent();

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request(`/api/v1/marketplace/${agent.id}/review`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 0 }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects rating above 5', async () => {
    const agent = seedAgent();

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request(`/api/v1/marketplace/${agent.id}/review`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 6 }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects non-integer rating', async () => {
    const agent = seedAgent();

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request(`/api/v1/marketplace/${agent.id}/review`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 3.5 }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate review by same user', async () => {
    const agent = seedAgent();

    const app = createTestApp();
    const token = await makeJwt();

    // First review
    await app.request(`/api/v1/marketplace/${agent.id}/review`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 4 }),
    });

    // Duplicate
    const res = await app.request(`/api/v1/marketplace/${agent.id}/review`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 5 }),
    });

    expect(res.status).toBe(409);
  });

  it('returns 404 for non-existent agent', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace/non-existent/review', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 3 }),
    });

    expect(res.status).toBe(404);
  });

  it('allows review without comment', async () => {
    const agent = seedAgent();

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request(`/api/v1/marketplace/${agent.id}/review`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 5 }),
    });

    expect(res.status).toBe(201);
  });

  it('audit-logs the review action', async () => {
    const agent = seedAgent();

    const app = createTestApp();
    const token = await makeJwt();
    await app.request(`/api/v1/marketplace/${agent.id}/review`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 4 }),
    });

    const events = [...auditStore.getAllEvents('marketplace'), ...auditStore.getAllEvents('tenant-001')];
    const reviewEvent = events.find((e) => e.action === 'submit_review');
    expect(reviewEvent).toBeDefined();
  });
});

// ─── GET /v1/marketplace/:agentId/reviews — List Reviews ─────────

describe('GET /api/v1/marketplace/:agentId/reviews', () => {
  it('returns reviews for agent', async () => {
    const agent = seedAgent();

    // Add a review
    reviewStore.set(`${agent.id}:reviewer-1`, {
      id: 'review-001',
      agentId: agent.id,
      reviewerId: 'reviewer-1',
      rating: 5,
      comment: 'Excellent',
      createdAt: new Date(),
    });

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request(`/api/v1/marketplace/${agent.id}/reviews`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].rating).toBe(5);
  });

  it('returns empty array when no reviews', async () => {
    const agent = seedAgent();

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request(`/api/v1/marketplace/${agent.id}/reviews`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.data).toHaveLength(0);
  });

  it('returns 404 for non-existent agent', async () => {
    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request('/api/v1/marketplace/non-existent/reviews', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('includes reviewer ID in response', async () => {
    const agent = seedAgent();

    reviewStore.set(`${agent.id}:rev-42`, {
      id: 'review-042',
      agentId: agent.id,
      reviewerId: 'rev-42',
      rating: 3,
      comment: null,
      createdAt: new Date(),
    });

    const app = createTestApp();
    const token = await makeJwt();
    const res = await app.request(`/api/v1/marketplace/${agent.id}/reviews`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.data[0].reviewerId).toBe('rev-42');
  });
});

// ─── Audit Logging Aggregate ────────────────────────────────────

describe('Audit logging', () => {
  it('all write operations produce audit events', async () => {
    const agent = seedAgent({ status: 'published', publisherId: 'user-001' });

    const app = createTestApp();
    const token = await makeJwt({ sub: 'user-001', role: 'tenant_admin' });

    // Publish
    await app.request('/api/v1/marketplace', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'audit-test',
        version: '2.0.0',
        description: 'test',
        author: 'test',
        license: 'MIT',
        manifest: {},
        packageHash: VALID_HASH,
      }),
    });

    // Update
    await app.request(`/api/v1/marketplace/${agent.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ description: 'Updated' }),
    });

    // Install
    await app.request(`/api/v1/marketplace/${agent.id}/install`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    // Review
    await app.request(`/api/v1/marketplace/${agent.id}/review`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 4 }),
    });

    const events = [...auditStore.getAllEvents('marketplace'), ...auditStore.getAllEvents('tenant-001')];
    const marketplaceEvents = events.filter((e) =>
      ['publish_agent', 'update_agent', 'install_agent', 'submit_review'].includes(e.action),
    );
    expect(marketplaceEvents.length).toBe(4);
  });
});
