import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphEnricher } from '../enrichment.js';
import { ok, err, InternalError, NotFoundError } from '@ordr/core';
import type { GraphOperations } from '../operations.js';
import type { GraphNode, GraphEdge } from '../types.js';

// ─── Mock Operations ─────────────────────────────────────────────

function createMockOperations(): GraphOperations {
  return {
    createNode: vi.fn(),
    getNode: vi.fn(),
    updateNode: vi.fn(),
    deleteNode: vi.fn(),
    createEdge: vi.fn(),
    getEdges: vi.fn(),
    deleteEdge: vi.fn(),
  } as unknown as GraphOperations;
}

// ─── Helpers ─────────────────────────────────────────────────────

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'node-1',
    type: 'Person',
    tenantId: 'tenant-001',
    properties: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: 'edge-1',
    type: 'CONTACTED',
    sourceId: 'source-1',
    targetId: 'target-1',
    tenantId: 'tenant-001',
    properties: {},
    weight: 1,
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('GraphEnricher', () => {
  let mockOps: GraphOperations;
  let enricher: GraphEnricher;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOps = createMockOperations();
    enricher = new GraphEnricher(mockOps);
  });

  // ─── handleCustomerCreated ───────────────────────────────────

  describe('handleCustomerCreated()', () => {
    it('creates a Person node for person type', async () => {
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(null));
      (mockOps.createNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(makeNode({ type: 'Person' })),
      );

      const result = await enricher.handleCustomerCreated({
        customerId: 'cust-1',
        name: 'John Doe',
        email: 'john@test.com',
        type: 'person',
        tenantId: 'tenant-001',
      });

      expect(result.success).toBe(true);
      expect(mockOps.createNode).toHaveBeenCalledOnce();
      const createArgs = (mockOps.createNode as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { type: string };
      expect(createArgs.type).toBe('Person');
    });

    it('creates a Company node for company type', async () => {
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(null));
      (mockOps.createNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(makeNode({ type: 'Company' })),
      );

      const result = await enricher.handleCustomerCreated({
        customerId: 'cust-2',
        name: 'Acme Corp',
        email: 'info@acme.com',
        type: 'company',
        tenantId: 'tenant-001',
      });

      expect(result.success).toBe(true);
      const createArgs = (mockOps.createNode as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { type: string };
      expect(createArgs.type).toBe('Company');
    });

    it('updates existing node instead of creating duplicate (idempotent)', async () => {
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(makeNode({ id: 'cust-1' })),
      );
      (mockOps.updateNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(makeNode({ id: 'cust-1' })),
      );

      const result = await enricher.handleCustomerCreated({
        customerId: 'cust-1',
        name: 'Updated Name',
        email: 'updated@test.com',
        type: 'person',
        tenantId: 'tenant-001',
      });

      expect(result.success).toBe(true);
      expect(mockOps.createNode).not.toHaveBeenCalled();
      expect(mockOps.updateNode).toHaveBeenCalledOnce();
    });

    it('rejects empty tenantId', async () => {
      const result = await enricher.handleCustomerCreated({
        customerId: 'cust-1',
        name: 'Test',
        email: 'test@test.com',
        type: 'person',
        tenantId: '',
      });

      expect(result.success).toBe(false);
    });

    it('rejects empty customerId', async () => {
      const result = await enricher.handleCustomerCreated({
        customerId: '',
        name: 'Test',
        email: 'test@test.com',
        type: 'person',
        tenantId: 'tenant-001',
      });

      expect(result.success).toBe(false);
    });
  });

  // ─── handleInteractionLogged ─────────────────────────────────

  describe('handleInteractionLogged()', () => {
    it('creates Interaction node and CONTACTED edge', async () => {
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(null));
      (mockOps.createNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(makeNode({ type: 'Interaction' })),
      );
      (mockOps.createEdge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(makeEdge()),
      );

      const result = await enricher.handleInteractionLogged({
        interactionId: 'int-1',
        customerId: 'cust-1',
        channel: 'email',
        direction: 'outbound',
        tenantId: 'tenant-001',
      });

      expect(result.success).toBe(true);
      expect(mockOps.createNode).toHaveBeenCalledOnce();
      expect(mockOps.createEdge).toHaveBeenCalledOnce();
    });

    it('skips node creation if interaction already exists (idempotent)', async () => {
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(makeNode({ type: 'Interaction', id: 'int-1' })),
      );
      (mockOps.createEdge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(makeEdge()),
      );

      await enricher.handleInteractionLogged({
        interactionId: 'int-1',
        customerId: 'cust-1',
        channel: 'sms',
        direction: 'inbound',
        tenantId: 'tenant-001',
      });

      expect(mockOps.createNode).not.toHaveBeenCalled();
      expect(mockOps.createEdge).toHaveBeenCalledOnce();
    });

    it('rejects empty interactionId', async () => {
      const result = await enricher.handleInteractionLogged({
        interactionId: '',
        customerId: 'cust-1',
        channel: 'email',
        direction: 'inbound',
        tenantId: 'tenant-001',
      });

      expect(result.success).toBe(false);
    });

    it('rejects empty tenantId', async () => {
      const result = await enricher.handleInteractionLogged({
        interactionId: 'int-1',
        customerId: 'cust-1',
        channel: 'email',
        direction: 'inbound',
        tenantId: '',
      });

      expect(result.success).toBe(false);
    });
  });

  // ─── handleAgentAction ───────────────────────────────────────

  describe('handleAgentAction()', () => {
    it('creates Agent node and ASSIGNED_TO edge', async () => {
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(null));
      (mockOps.createNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(makeNode({ type: 'Agent' })),
      );
      (mockOps.createEdge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(makeEdge({ type: 'ASSIGNED_TO' })),
      );

      const result = await enricher.handleAgentAction({
        actionId: 'act-1',
        agentId: 'agent-1',
        customerId: 'cust-1',
        actionType: 'score_lead',
        tenantId: 'tenant-001',
      });

      expect(result.success).toBe(true);
      expect(mockOps.createNode).toHaveBeenCalledOnce();
      expect(mockOps.createEdge).toHaveBeenCalledOnce();
    });

    it('updates existing Agent node instead of creating duplicate', async () => {
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(makeNode({ type: 'Agent', id: 'agent-1' })),
      );
      (mockOps.updateNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(makeNode({ type: 'Agent', id: 'agent-1' })),
      );
      (mockOps.createEdge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(makeEdge({ type: 'ASSIGNED_TO' })),
      );

      await enricher.handleAgentAction({
        actionId: 'act-2',
        agentId: 'agent-1',
        customerId: 'cust-1',
        actionType: 'send_email',
        tenantId: 'tenant-001',
      });

      expect(mockOps.createNode).not.toHaveBeenCalled();
      expect(mockOps.updateNode).toHaveBeenCalledOnce();
    });

    it('rejects empty agentId', async () => {
      const result = await enricher.handleAgentAction({
        actionId: 'act-1',
        agentId: '',
        customerId: 'cust-1',
        actionType: 'score_lead',
        tenantId: 'tenant-001',
      });

      expect(result.success).toBe(false);
    });

    it('rejects empty tenantId', async () => {
      const result = await enricher.handleAgentAction({
        actionId: 'act-1',
        agentId: 'agent-1',
        customerId: 'cust-1',
        actionType: 'score_lead',
        tenantId: '',
      });

      expect(result.success).toBe(false);
    });

    it('propagates errors from getNode', async () => {
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('DB down')),
      );

      const result = await enricher.handleAgentAction({
        actionId: 'act-1',
        agentId: 'agent-1',
        customerId: 'cust-1',
        actionType: 'score_lead',
        tenantId: 'tenant-001',
      });

      expect(result.success).toBe(false);
    });
  });
});
