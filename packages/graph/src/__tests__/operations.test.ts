import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphOperations } from '../operations.js';
import { ok, err, InternalError } from '@ordr/core';
import type { GraphClient } from '../client.js';

// ─── Mock Client ─────────────────────────────────────────────────

function createMockClient(): GraphClient {
  return {
    runQuery: vi.fn(),
    runWriteQuery: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  } as unknown as GraphClient;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('GraphOperations', () => {
  let mockClient: GraphClient;
  let ops: GraphOperations;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    ops = new GraphOperations(mockClient);
  });

  // ─── createNode ──────────────────────────────────────────────

  describe('createNode()', () => {
    it('creates a node with correct type and tenant', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ n: { properties: {} }, labels: ['Person'] }]),
      );

      const result = await ops.createNode({
        type: 'Person',
        tenantId: 'tenant-001',
        properties: { name: 'John Doe' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Person');
        expect(result.data.tenantId).toBe('tenant-001');
        expect(result.data.properties).toEqual({ name: 'John Doe' });
        expect(result.data.id).toBeTruthy();
      }
    });

    it('generates a UUID for the node id', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ n: { properties: {} }, labels: ['Company'] }]),
      );

      const result = await ops.createNode({
        type: 'Company',
        tenantId: 'tenant-001',
        properties: {},
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      }
    });

    it('rejects invalid node type', async () => {
      const result = await ops.createNode({
        type: 'InvalidType' as never,
        tenantId: 'tenant-001',
        properties: {},
      });

      expect(result.success).toBe(false);
    });

    it('rejects empty tenantId', async () => {
      const result = await ops.createNode({
        type: 'Person',
        tenantId: '',
        properties: {},
      });

      expect(result.success).toBe(false);
    });

    it('passes tenantId to the write query', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ n: { properties: {} }, labels: ['Deal'] }]),
      );

      await ops.createNode({
        type: 'Deal',
        tenantId: 'tenant-042',
        properties: { amount: 10000 },
      });

      expect(mockClient.runWriteQuery).toHaveBeenCalledOnce();
      const callArgs = (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(callArgs[2]).toBe('tenant-042');
    });

    it('propagates client errors', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('Connection lost')),
      );

      const result = await ops.createNode({
        type: 'Person',
        tenantId: 'tenant-001',
        properties: {},
      });

      expect(result.success).toBe(false);
    });
  });

  // ─── getNode ─────────────────────────────────────────────────

  describe('getNode()', () => {
    it('returns node when found', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{
          n: {
            properties: {
              id: 'node-1',
              tenantId: 'tenant-001',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
              name: 'Test',
            },
          },
          labels: ['Person'],
        }]),
      );

      const result = await ops.getNode('node-1', 'tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toBeNull();
        expect(result.data!.id).toBe('node-1');
        expect(result.data!.properties).toEqual({ name: 'Test' });
      }
    });

    it('returns null when not found', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      const result = await ops.getNode('nonexistent', 'tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('rejects empty node id', async () => {
      const result = await ops.getNode('', 'tenant-001');

      expect(result.success).toBe(false);
    });

    it('passes tenantId to query for isolation', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await ops.getNode('node-1', 'tenant-secure');

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(callArgs[2]).toBe('tenant-secure');
    });
  });

  // ─── updateNode ──────────────────────────────────────────────

  describe('updateNode()', () => {
    it('updates properties and returns updated node', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{
          n: {
            properties: {
              id: 'node-1',
              tenantId: 'tenant-001',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-06-01T00:00:00Z',
              name: 'Updated',
              email: 'new@test.com',
            },
          },
          labels: ['Person'],
        }]),
      );

      const result = await ops.updateNode('node-1', 'tenant-001', {
        name: 'Updated',
        email: 'new@test.com',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.properties).toEqual({
          name: 'Updated',
          email: 'new@test.com',
        });
      }
    });

    it('returns NotFoundError when node does not exist', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      const result = await ops.updateNode('nonexistent', 'tenant-001', { name: 'X' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('rejects empty node id', async () => {
      const result = await ops.updateNode('', 'tenant-001', {});

      expect(result.success).toBe(false);
    });
  });

  // ─── deleteNode ──────────────────────────────────────────────

  describe('deleteNode()', () => {
    it('deletes node and returns void on success', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ deleted: 1 }]),
      );

      const result = await ops.deleteNode('node-1', 'tenant-001');

      expect(result.success).toBe(true);
    });

    it('is idempotent — succeeds even if node does not exist', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ deleted: 0 }]),
      );

      const result = await ops.deleteNode('nonexistent', 'tenant-001');

      expect(result.success).toBe(true);
    });

    it('passes tenantId to enforce isolation', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ deleted: 1 }]),
      );

      await ops.deleteNode('node-1', 'tenant-isolated');

      const callArgs = (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(callArgs[2]).toBe('tenant-isolated');
    });

    it('rejects empty node id', async () => {
      const result = await ops.deleteNode('', 'tenant-001');
      expect(result.success).toBe(false);
    });
  });

  // ─── createEdge ──────────────────────────────────────────────

  describe('createEdge()', () => {
    it('creates an edge between two tenant-scoped nodes', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{
          r: { properties: {}, type: 'WORKS_AT' },
          sourceId: 'person-1',
          targetId: 'company-1',
        }]),
      );

      const result = await ops.createEdge({
        type: 'WORKS_AT',
        sourceId: 'person-1',
        targetId: 'company-1',
        tenantId: 'tenant-001',
        properties: { role: 'CEO' },
        weight: 0.9,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('WORKS_AT');
        expect(result.data.sourceId).toBe('person-1');
        expect(result.data.targetId).toBe('company-1');
      }
    });

    it('returns NotFoundError when source or target does not exist', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      const result = await ops.createEdge({
        type: 'CONTACTED',
        sourceId: 'missing-1',
        targetId: 'missing-2',
        tenantId: 'tenant-001',
        properties: {},
        weight: 1,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('rejects invalid edge type', async () => {
      const result = await ops.createEdge({
        type: 'INVALID_TYPE' as never,
        sourceId: 'a',
        targetId: 'b',
        tenantId: 'tenant-001',
        properties: {},
        weight: 1,
      });

      expect(result.success).toBe(false);
    });

    it('rejects empty sourceId', async () => {
      const result = await ops.createEdge({
        type: 'WORKS_AT',
        sourceId: '',
        targetId: 'b',
        tenantId: 'tenant-001',
        properties: {},
        weight: 1,
      });

      expect(result.success).toBe(false);
    });
  });

  // ─── getEdges ────────────────────────────────────────────────

  describe('getEdges()', () => {
    it('returns edges for a node', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{
          r: {
            properties: { id: 'edge-1', tenantId: 'tenant-001', weight: 0.8 },
            type: 'WORKS_AT',
          },
          sourceId: 'person-1',
          targetId: 'company-1',
        }]),
      );

      const result = await ops.getEdges('person-1', 'tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]!.type).toBe('WORKS_AT');
      }
    });

    it('filters by edge type when provided', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await ops.getEdges('node-1', 'tenant-001', 'CONTACTED');

      const cypher = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(cypher).toContain('$edgeType');
    });

    it('rejects empty nodeId', async () => {
      const result = await ops.getEdges('', 'tenant-001');
      expect(result.success).toBe(false);
    });
  });

  // ─── deleteEdge ──────────────────────────────────────────────

  describe('deleteEdge()', () => {
    it('deletes an edge and returns void', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ deleted: 1 }]),
      );

      const result = await ops.deleteEdge('edge-1', 'tenant-001');

      expect(result.success).toBe(true);
    });

    it('rejects empty edge id', async () => {
      const result = await ops.deleteEdge('', 'tenant-001');
      expect(result.success).toBe(false);
    });

    it('passes tenantId to enforce isolation on edge deletion', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ deleted: 1 }]),
      );

      await ops.deleteEdge('edge-1', 'tenant-scoped');

      const callArgs = (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(callArgs[2]).toBe('tenant-scoped');
    });
  });
});
