// apps/api/src/__tests__/developer-agents.test.ts
/**
 * Developer Agents Route Tests — /api/v1/developers/agents
 *
 * Tests: list (scoped to caller), submit (valid/invalid manifest/hash).
 * Key invariants: invalid manifests never write to DB, uppercase packageHash rejected.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { developerAgentsRouter, configureAgentRoutes } from '../routes/developer-agents.js';
import { configureAuth } from '../middleware/auth.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import { loadKeyPair, createAccessToken } from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { generateKeyPair } from '@ordr/crypto';

// ─── Mock @ordr/sdk ──────────────────────────────────────────────────

const mockCheckManifest = vi.fn();
vi.mock('@ordr/sdk', () => ({
  checkManifest: (...args: unknown[]) => mockCheckManifest(...args) as unknown,
}));

// ─── Types ──────────────────────────────────────────────────────────

interface AgentListItem {
  id: string;
  name: string;
  version: string;
  status: 'draft' | 'review' | 'published' | 'suspended' | 'rejected';
  installCount: number;
  createdAt: Date;
}

// ─── Helpers ────────────────────────────────────────────────────────

let jwtConfig: JwtConfig;
let auditLogger: AuditLogger;
let agentStore: AgentListItem[];
let mockListAgents: ReturnType<typeof vi.fn>;
let mockCreateListing: ReturnType<typeof vi.fn>;

async function makeJwt(sub = 'dev-001'): Promise<string> {
  return createAccessToken(jwtConfig, {
    sub,
    tid: 'developer-portal',
    role: 'tenant_admin' as const,
    permissions: [],
  });
}

const VALID_MANIFEST = {
  name: 'test-agent',
  version: '1.0.0',
  description: 'A test agent',
  author: 'test@example.com',
  license: 'MIT',
  requiredTools: [],
  complianceRequirements: [],
  permissions: ['internal'],
  entryPoint: 'index.js',
  minConfidenceThreshold: 0.8,
  maxBudget: { maxTokens: 10000, maxCostCents: 100, maxActions: 50 },
};

const VALID_HASH = 'a'.repeat(64);

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/api/v1/developers/agents', developerAgentsRouter);
  return app;
}

// ─── Setup ──────────────────────────────────────────────────────────

beforeEach(async () => {
  const { privateKey, publicKey } = generateKeyPair(); // synchronous — no await
  jwtConfig = await loadKeyPair(privateKey, publicKey, {
    issuer: 'ordr-connect',
    audience: 'ordr-connect',
  });
  configureAuth(jwtConfig);

  const auditStore = new InMemoryAuditStore();
  auditLogger = new AuditLogger(auditStore);
  agentStore = [];

  mockListAgents = vi.fn((publisherId: string) =>
    Promise.resolve(
      agentStore.filter(
        (a) => (a as unknown as { publisherId: string }).publisherId === publisherId,
      ),
    ),
  );

  mockCreateListing = vi.fn((data: { name: string; version: string; publisherId: string }) => {
    const item: AgentListItem & { publisherId: string } = {
      id: 'agent-001',
      name: data.name,
      version: data.version,
      status: 'review',
      installCount: 0,
      createdAt: new Date(),
      publisherId: data.publisherId,
    };
    agentStore.push(item);
    return Promise.resolve(item);
  });

  configureAgentRoutes({
    auditLogger,
    listAgentsByPublisher: mockListAgents,
    createMarketplaceListing: mockCreateListing,
  });

  // Default: manifest is valid
  mockCheckManifest.mockReturnValue({ valid: true, errors: [], warnings: [] });
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('GET /api/v1/developers/agents', () => {
  it('returns only agents owned by the caller', async () => {
    agentStore.push({
      id: 'a1',
      name: 'My Agent',
      version: '1.0.0',
      status: 'review',
      installCount: 0,
      createdAt: new Date(),
    } as unknown as AgentListItem);

    const token = await makeJwt('dev-001');
    const app = createTestApp();
    const res = await app.request('/api/v1/developers/agents', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(mockListAgents).toHaveBeenCalledWith('dev-001');
  });
});

describe('POST /api/v1/developers/agents/submit', () => {
  it('valid manifest → 201, status review', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/agents/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: VALID_MANIFEST,
        packageHash: VALID_HASH,
        description: 'An agent that does things',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('review');
    expect(mockCreateListing).toHaveBeenCalledOnce();
  });

  it('invalid manifest → 422 with errors, no DB write', async () => {
    mockCheckManifest.mockReturnValue({
      valid: false,
      errors: ['name is required', 'license must be OSI-approved'],
      warnings: [],
    });

    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/agents/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: {},
        packageHash: VALID_HASH,
        description: 'test',
      }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors).toContain('name is required');
    expect(mockCreateListing).not.toHaveBeenCalled();
  });

  it('uppercase packageHash → 400', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/agents/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: VALID_MANIFEST,
        packageHash: 'A'.repeat(64),
        description: 'test',
      }),
    });

    expect(res.status).toBe(400);
    expect(mockCreateListing).not.toHaveBeenCalled();
  });

  it('wrong-length packageHash → 400', async () => {
    const token = await makeJwt();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/agents/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: VALID_MANIFEST,
        packageHash: 'abc',
        description: 'test',
      }),
    });

    expect(res.status).toBe(400);
  });
});
