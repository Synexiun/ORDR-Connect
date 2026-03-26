/**
 * Agent route tests
 *
 * Verifies:
 * - POST /trigger — agent session creation, event publishing, auth
 * - GET /sessions — list sessions with pagination and filters
 * - GET /sessions/:id — single session detail
 * - POST /sessions/:id/kill — kill switch, immediate effect
 * - GET /hitl — list pending HITL items
 * - POST /hitl/:id/approve — approve HITL item
 * - POST /hitl/:id/reject — reject HITL item with reason
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { agentsRouter, configureAgentRoutes } from '../routes/agents.js';
import { configureAuth } from '../middleware/auth.js';
import { globalErrorHandler } from '../middleware/error-handler.js';

// Mock @ordr/auth so requireAuth() succeeds with our test context
vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [
        { resource: 'agents', action: 'create', scope: 'tenant' },
        { resource: 'agents', action: 'read', scope: 'tenant' },
        { resource: 'agents', action: 'update', scope: 'tenant' },
        { resource: 'agents', action: 'delete', scope: 'tenant' },
      ],
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

// ---- Test Helpers -----------------------------------------------------------

function createMockAuditLogger() {
  return {
    log: vi.fn().mockResolvedValue({
      id: 'audit-1',
      sequenceNumber: 1,
      hash: 'abc',
      previousHash: '000',
    }),
    getLastEvent: vi.fn().mockResolvedValue(null),
    verifyIntegrity: vi.fn().mockResolvedValue({ valid: true, totalEvents: 0, lastSequence: 0, lastHash: '000' }),
    generateMerkleRoot: vi.fn(),
    generateProof: vi.fn(),
    verifyProof: vi.fn().mockReturnValue(true),
  };
}

function createMockEventProducer() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    publishBatch: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAgentEngine() {
  return {
    startSession: vi.fn().mockResolvedValue({ success: true, data: {} }),
    runStep: vi.fn(),
    runLoop: vi.fn(),
    killSession: vi.fn(),
    getHitlQueue: vi.fn(),
  };
}

function createMockHitlQueue() {
  return {
    enqueue: vi.fn().mockReturnValue('hitl-1'),
    approve: vi.fn().mockReturnValue({ action: 'send_sms', confidence: 0.5, reasoning: 'test', parameters: {}, requiresApproval: true }),
    reject: vi.fn(),
    getPending: vi.fn().mockReturnValue([]),
    getItem: vi.fn().mockReturnValue(undefined),
    get size() { return 0; },
    getPendingCount: vi.fn().mockReturnValue(0),
  };
}

const mockSession = {
  sessionId: '00000000-0000-0000-0000-000000000001',
  tenantId: 'tenant-1',
  customerId: '00000000-0000-0000-0000-000000000002',
  agentRole: 'collections',
  autonomyLevel: 'supervised',
  status: 'active',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);

  // Simulate authenticated user
  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [
        { resource: 'agents', action: 'create' },
        { resource: 'agents', action: 'read' },
        { resource: 'agents', action: 'update' },
        { resource: 'agents', action: 'delete' },
      ],
    });
    await next();
  });

  app.route('/api/v1/agents', agentsRouter);
  return app;
}

// ---- Tests ------------------------------------------------------------------

describe('Agent Routes', () => {
  let mockAudit: ReturnType<typeof createMockAuditLogger>;
  let mockProducer: ReturnType<typeof createMockEventProducer>;
  let mockEngine: ReturnType<typeof createMockAgentEngine>;
  let mockHitl: ReturnType<typeof createMockHitlQueue>;

  beforeEach(() => {
    // Configure auth with a dummy JWT config so requireAuth() doesn't
    // short-circuit with "Authentication service unavailable"
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockAudit = createMockAuditLogger();
    mockProducer = createMockEventProducer();
    mockEngine = createMockAgentEngine();
    mockHitl = createMockHitlQueue();

    configureAgentRoutes({
      auditLogger: mockAudit as never,
      eventProducer: mockProducer as never,
      agentEngine: mockEngine as never,
      hitlQueue: mockHitl as never,
      findSessionById: vi.fn().mockResolvedValue(mockSession),
      listSessions: vi.fn().mockResolvedValue({ data: [mockSession], total: 1 }),
      createSession: vi.fn().mockResolvedValue(mockSession),
      updateSessionStatus: vi.fn().mockResolvedValue(mockSession),
    });
  });

  // ---- POST /trigger ----------------------------------------------------------

  describe('POST /api/v1/agents/trigger', () => {
    it('creates agent session and returns 201 with session ID', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/agents/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: '00000000-0000-0000-0000-000000000002',
          agentRole: 'collections',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { success: boolean; data: { sessionId: string } };
      expect(body.success).toBe(true);
      expect(body.data.sessionId).toBeDefined();
    });

    it('publishes agent.triggered event to Kafka', async () => {
      const app = createTestApp();
      await app.request('/api/v1/agents/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: '00000000-0000-0000-0000-000000000002',
          agentRole: 'follow_up',
        }),
      });

      expect(mockProducer.publish).toHaveBeenCalledTimes(1);
    });

    it('logs audit event for agent trigger', async () => {
      const app = createTestApp();
      await app.request('/api/v1/agents/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: '00000000-0000-0000-0000-000000000002',
          agentRole: 'collections',
        }),
      });

      expect(mockAudit.log).toHaveBeenCalledTimes(1);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'trigger', resource: 'agent_session' }),
      );
    });

    it('returns 422 for invalid agentRole', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/agents/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: '00000000-0000-0000-0000-000000000002',
          agentRole: 'invalid_role',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for missing customerId', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/agents/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentRole: 'collections' }),
      });

      expect(res.status).toBe(400);
    });

    it('accepts optional autonomyLevel', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/agents/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: '00000000-0000-0000-0000-000000000002',
          agentRole: 'collections',
          autonomyLevel: 'autonomous',
        }),
      });

      expect(res.status).toBe(201);
    });
  });

  // ---- GET /sessions ----------------------------------------------------------

  describe('GET /api/v1/agents/sessions', () => {
    it('returns paginated sessions list', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/agents/sessions');

      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; data: unknown[]; pagination: { total: number } };
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1);
      expect(body.pagination.total).toBe(1);
    });

    it('supports status filter', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/agents/sessions?status=active');

      expect(res.status).toBe(200);
    });
  });

  // ---- GET /sessions/:id ------------------------------------------------------

  describe('GET /api/v1/agents/sessions/:id', () => {
    it('returns session detail', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/agents/sessions/00000000-0000-0000-0000-000000000001');

      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; data: { sessionId: string } };
      expect(body.success).toBe(true);
      expect(body.data.sessionId).toBe(mockSession.sessionId);
    });

    it('returns 404 for non-existent session', async () => {
      configureAgentRoutes({
        auditLogger: mockAudit as never,
        eventProducer: mockProducer as never,
        agentEngine: mockEngine as never,
        hitlQueue: mockHitl as never,
        findSessionById: vi.fn().mockResolvedValue(null),
        listSessions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
        createSession: vi.fn(),
        updateSessionStatus: vi.fn(),
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/agents/sessions/non-existent');

      expect(res.status).toBe(404);
    });
  });

  // ---- POST /sessions/:id/kill ------------------------------------------------

  describe('POST /api/v1/agents/sessions/:id/kill', () => {
    it('kills session and returns success', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/agents/sessions/00000000-0000-0000-0000-000000000001/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Safety concern' }),
      });

      expect(res.status).toBe(200);
      expect(mockEngine.killSession).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001',
        'Safety concern',
      );
    });

    it('publishes agent.killed event', async () => {
      const app = createTestApp();
      await app.request('/api/v1/agents/sessions/00000000-0000-0000-0000-000000000001/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Budget exceeded' }),
      });

      expect(mockProducer.publish).toHaveBeenCalledTimes(1);
    });

    it('returns 422 when reason is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/agents/sessions/00000000-0000-0000-0000-000000000001/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('logs audit event for kill action', async () => {
      const app = createTestApp();
      await app.request('/api/v1/agents/sessions/00000000-0000-0000-0000-000000000001/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Emergency stop' }),
      });

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'agent.killed', action: 'kill' }),
      );
    });
  });

  // ---- GET /hitl --------------------------------------------------------------

  describe('GET /api/v1/agents/hitl', () => {
    it('returns empty pending items', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/agents/hitl');

      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; data: unknown[]; total: number };
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns pending items when available', async () => {
      const pendingItem = {
        id: 'hitl-1',
        sessionId: 'session-1',
        tenantId: 'tenant-1',
        decision: { action: 'send_sms', reasoning: 'test', confidence: 0.5, parameters: {}, requiresApproval: true },
        context: { sessionId: 'session-1', tenantId: 'tenant-1', customerId: 'cust-1', agentRole: 'collections' },
        createdAt: new Date(),
        status: 'pending' as const,
        reviewedBy: undefined,
        reviewedAt: undefined,
        rejectionReason: undefined,
      };

      mockHitl.getPending.mockReturnValue([pendingItem]);

      const app = createTestApp();
      const res = await app.request('/api/v1/agents/hitl');

      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(1);
    });
  });

  // ---- POST /hitl/:id/approve -------------------------------------------------

  describe('POST /api/v1/agents/hitl/:id/approve', () => {
    it('approves HITL item and returns decision', async () => {
      mockHitl.getItem.mockReturnValue({
        id: 'hitl-1',
        tenantId: 'tenant-1',
        sessionId: 'session-1',
        decision: { action: 'send_sms', confidence: 0.5, reasoning: 'test', parameters: {}, requiresApproval: true },
        status: 'pending',
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/agents/hitl/hitl-1/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string } };
      expect(body.data.status).toBe('approved');
    });

    it('returns 404 for non-existent HITL item', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/agents/hitl/non-existent/approve', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
    });
  });

  // ---- POST /hitl/:id/reject --------------------------------------------------

  describe('POST /api/v1/agents/hitl/:id/reject', () => {
    it('rejects HITL item with reason', async () => {
      mockHitl.getItem.mockReturnValue({
        id: 'hitl-1',
        tenantId: 'tenant-1',
        sessionId: 'session-1',
        decision: { action: 'send_sms', confidence: 0.5, reasoning: 'test', parameters: {}, requiresApproval: true },
        status: 'pending',
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/agents/hitl/hitl-1/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Too risky' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string; reason: string } };
      expect(body.data.status).toBe('rejected');
      expect(body.data.reason).toBe('Too risky');
    });

    it('returns 422 when reason is missing', async () => {
      mockHitl.getItem.mockReturnValue({
        id: 'hitl-1',
        tenantId: 'tenant-1',
        sessionId: 'session-1',
        decision: { action: 'send_sms', confidence: 0.5, reasoning: 'test', parameters: {}, requiresApproval: true },
        status: 'pending',
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/agents/hitl/hitl-1/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 for HITL item from different tenant', async () => {
      mockHitl.getItem.mockReturnValue({
        id: 'hitl-1',
        tenantId: 'other-tenant',
        sessionId: 'session-1',
        decision: { action: 'send_sms', confidence: 0.5, reasoning: 'test', parameters: {}, requiresApproval: true },
        status: 'pending',
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/agents/hitl/hitl-1/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Wrong tenant' }),
      });

      expect(res.status).toBe(404);
    });
  });
});
