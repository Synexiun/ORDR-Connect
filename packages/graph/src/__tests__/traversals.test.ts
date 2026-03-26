import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphTraversals } from '../traversals.js';
import { ok, err, InternalError } from '@ordr/core';
import { MAX_TRAVERSAL_DEPTH } from '../types.js';
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

// ─── Mock Records ────────────────────────────────────────────────

function makeNeighborRecord(id: string, label: string, edgeType: string) {
  return {
    neighbor: {
      properties: {
        id,
        tenantId: 'tenant-001',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        name: `Node ${id}`,
      },
    },
    neighborLabels: [label],
    r: {
      properties: { id: `edge-${id}`, tenantId: 'tenant-001', weight: 1 },
      type: edgeType,
    },
    originId: 'origin-1',
    neighborId: id,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('GraphTraversals', () => {
  let mockClient: GraphClient;
  let traversals: GraphTraversals;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    traversals = new GraphTraversals(mockClient);
  });

  // ─── getNeighbors ────────────────────────────────────────────

  describe('getNeighbors()', () => {
    it('returns neighbors within default depth of 1', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([
          makeNeighborRecord('n-1', 'Person', 'WORKS_AT'),
          makeNeighborRecord('n-2', 'Company', 'OWNS'),
        ]),
      );

      const result = await traversals.getNeighbors('origin-1', 'tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nodes).toHaveLength(2);
        expect(result.data.edges).toHaveLength(2);
      }
    });

    it('deduplicates nodes in the result', async () => {
      const duplicate = makeNeighborRecord('n-1', 'Person', 'CONTACTED');
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([duplicate, duplicate]),
      );

      const result = await traversals.getNeighbors('origin-1', 'tenant-001');

      if (result.success) {
        expect(result.data.nodes).toHaveLength(1);
      }
    });

    it('rejects empty nodeId', async () => {
      const result = await traversals.getNeighbors('', 'tenant-001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Node ID');
      }
    });

    it('passes tenantId for isolation', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await traversals.getNeighbors('node-1', 'tenant-secure');

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(callArgs[2]).toBe('tenant-secure');
    });

    it('caps depth at MAX_TRAVERSAL_DEPTH', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await traversals.getNeighbors('node-1', 'tenant-001', 100);

      const cypher = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(cypher).toContain(`*1..${MAX_TRAVERSAL_DEPTH}`);
    });

    it('clamps depth of 0 to 1', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await traversals.getNeighbors('node-1', 'tenant-001', 0);

      const cypher = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(cypher).toContain('*1..1');
    });

    it('propagates client errors', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('Connection lost')),
      );

      const result = await traversals.getNeighbors('node-1', 'tenant-001');

      expect(result.success).toBe(false);
    });
  });

  // ─── findPath ────────────────────────────────────────────────

  describe('findPath()', () => {
    it('returns path between two nodes', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{
          nodes: [
            {
              properties: {
                id: 'from-1',
                tenantId: 'tenant-001',
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
              },
              labels: ['Person'],
            },
            {
              properties: {
                id: 'to-1',
                tenantId: 'tenant-001',
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
              },
              labels: ['Company'],
            },
          ],
          rels: [
            {
              properties: { id: 'rel-1', tenantId: 'tenant-001', weight: 1 },
              type: 'WORKS_AT',
            },
          ],
          nodeIds: ['from-1', 'to-1'],
        }]),
      );

      const result = await traversals.findPath('from-1', 'to-1', 'tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nodes).toHaveLength(2);
        expect(result.data.edges).toHaveLength(1);
        expect(result.data.paths).toHaveLength(1);
        expect(result.data.paths[0]).toEqual(['from-1', 'to-1']);
      }
    });

    it('returns empty result when no path exists', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      const result = await traversals.findPath('a', 'b', 'tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nodes).toHaveLength(0);
        expect(result.data.paths).toHaveLength(0);
      }
    });

    it('rejects empty fromId', async () => {
      const result = await traversals.findPath('', 'b', 'tenant-001');
      expect(result.success).toBe(false);
    });

    it('rejects empty toId', async () => {
      const result = await traversals.findPath('a', '', 'tenant-001');
      expect(result.success).toBe(false);
    });

    it('caps max depth at MAX_TRAVERSAL_DEPTH', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await traversals.findPath('a', 'b', 'tenant-001', 999);

      const cypher = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(cypher).toContain(`*1..${MAX_TRAVERSAL_DEPTH}`);
    });
  });

  // ─── getCustomerNetwork ──────────────────────────────────────

  describe('getCustomerNetwork()', () => {
    it('returns connected entities for a customer', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([
          makeNeighborRecord('company-1', 'Company', 'WORKS_AT'),
          makeNeighborRecord('deal-1', 'Deal', 'OWNS'),
        ]),
      );

      const result = await traversals.getCustomerNetwork('cust-1', 'tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nodes).toHaveLength(2);
      }
    });

    it('rejects empty customerId', async () => {
      const result = await traversals.getCustomerNetwork('', 'tenant-001');
      expect(result.success).toBe(false);
    });
  });

  // ─── findInfluencers ─────────────────────────────────────────

  describe('findInfluencers()', () => {
    it('returns nodes sorted by degree centrality', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([
          {
            n: {
              properties: {
                id: 'influencer-1',
                tenantId: 'tenant-001',
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                name: 'Top Node',
              },
            },
            labels: ['Person'],
            degree: 42,
          },
        ]),
      );

      const result = await traversals.findInfluencers('tenant-001', 5);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]!.properties['_degreeCentrality']).toBe(42);
      }
    });

    it('caps limit to DEFAULT_QUERY_LIMIT', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await traversals.findInfluencers('tenant-001', 999);

      const params = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, unknown>;
      expect(params['limit']).toBe(100);
    });

    it('defaults limit to 10', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await traversals.findInfluencers('tenant-001');

      const params = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, unknown>;
      expect(params['limit']).toBe(10);
    });
  });
});
