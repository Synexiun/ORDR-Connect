import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphAnalytics } from '../analytics.js';
import { ok, err, InternalError } from '@ordr/core';
import type { GraphClient } from '../client.js';

// ─── Mock GraphClient ───────────────────────────────────────────

function createMockClient(connected = true): GraphClient {
  return {
    runQuery: vi.fn(),
    runWriteQuery: vi.fn(),
    isConnected: vi.fn().mockReturnValue(connected),
    connect: vi.fn(),
    close: vi.fn(),
  } as unknown as GraphClient;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('GraphAnalytics', () => {
  let mockClient: GraphClient;
  let analytics: GraphAnalytics;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    analytics = new GraphAnalytics(mockClient);
  });

  // ─── computePageRank ────────────────────────────────────────

  describe('computePageRank()', () => {
    it('returns sorted PageRank results for tenant', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([
          { nodeId: 'node-1', nodeType: 'Person', score: 0.95 },
          { nodeId: 'node-2', nodeType: 'Company', score: 0.72 },
          { nodeId: 'node-3', nodeType: 'Deal', score: 0.45 },
        ]),
      );

      const result = await analytics.computePageRank('tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(3);
        expect(result.data[0]!.nodeId).toBe('node-1');
        expect(result.data[0]!.score).toBe(0.95);
        expect(result.data[1]!.nodeType).toBe('Company');
      }
    });

    it('uses default iterations (20) and damping factor (0.85)', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.computePageRank('tenant-001');

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as Record<string, unknown>;
      expect(params['iterations']).toBe(20);
      expect(params['dampingFactor']).toBe(0.85);
    });

    it('accepts custom iterations and damping factor', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.computePageRank('tenant-001', {
        iterations: 50,
        dampingFactor: 0.9,
      });

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as Record<string, unknown>;
      expect(params['iterations']).toBe(50);
      expect(params['dampingFactor']).toBe(0.9);
    });

    it('clamps iterations to valid range (1-100)', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.computePageRank('tenant-001', { iterations: 999 });

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as Record<string, unknown>;
      expect(params['iterations']).toBe(100);
    });

    it('clamps damping factor to valid range (0.0-1.0)', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.computePageRank('tenant-001', { dampingFactor: 1.5 });

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as Record<string, unknown>;
      expect(params['dampingFactor']).toBe(1.0);
    });

    it('includes tenantId in query parameters for isolation', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.computePageRank('tenant-042');

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const tenantId = callArgs[2] as string;
      expect(tenantId).toBe('tenant-042');
    });

    it('returns empty array when no nodes exist', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      const result = await analytics.computePageRank('tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('rejects empty tenantId', async () => {
      const result = await analytics.computePageRank('');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('tenantId');
      }
    });

    it('rejects whitespace-only tenantId', async () => {
      const result = await analytics.computePageRank('   ');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('tenantId');
      }
    });

    it('propagates client errors', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('Connection timeout')),
      );

      const result = await analytics.computePageRank('tenant-001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Connection timeout');
      }
    });
  });

  // ─── detectCommunities ──────────────────────────────────────

  describe('detectCommunities()', () => {
    it('returns community assignments sorted by communityId', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([
          { nodeId: 'node-1', communityId: 0 },
          { nodeId: 'node-2', communityId: 0 },
          { nodeId: 'node-3', communityId: 1 },
          { nodeId: 'node-4', communityId: 1 },
        ]),
      );

      const result = await analytics.detectCommunities('tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(4);
        expect(result.data[0]!.communityId).toBe(0);
        expect(result.data[2]!.communityId).toBe(1);
      }
    });

    it('uses default resolution of 1.0', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.detectCommunities('tenant-001');

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as Record<string, unknown>;
      expect(params['resolution']).toBe(1.0);
    });

    it('accepts custom resolution', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.detectCommunities('tenant-001', { resolution: 2.5 });

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as Record<string, unknown>;
      expect(params['resolution']).toBe(2.5);
    });

    it('clamps resolution to valid range (0.1-10.0)', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.detectCommunities('tenant-001', { resolution: 50 });

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as Record<string, unknown>;
      expect(params['resolution']).toBe(10.0);
    });

    it('enforces tenant isolation in query', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.detectCommunities('tenant-099');

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const tenantId = callArgs[2] as string;
      expect(tenantId).toBe('tenant-099');
    });

    it('rejects empty tenantId', async () => {
      const result = await analytics.detectCommunities('');

      expect(result.success).toBe(false);
    });

    it('propagates client errors', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('GDS not installed')),
      );

      const result = await analytics.detectCommunities('tenant-001');

      expect(result.success).toBe(false);
    });
  });

  // ─── computeBetweenness ─────────────────────────────────────

  describe('computeBetweenness()', () => {
    it('returns centrality scores sorted descending', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([
          { nodeId: 'bridge-1', score: 150.5 },
          { nodeId: 'bridge-2', score: 80.3 },
          { nodeId: 'leaf-1', score: 0.0 },
        ]),
      );

      const result = await analytics.computeBetweenness('tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(3);
        expect(result.data[0]!.score).toBe(150.5);
        expect(result.data[2]!.score).toBe(0.0);
      }
    });

    it('runs without sampling by default', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.computeBetweenness('tenant-001');

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as Record<string, unknown>;
      expect(params['samplingSize']).toBeUndefined();
    });

    it('passes sampling size when specified', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.computeBetweenness('tenant-001', { samplingSize: 500 });

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as Record<string, unknown>;
      expect(params['samplingSize']).toBe(500);
    });

    it('clamps sampling size to valid range', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.computeBetweenness('tenant-001', { samplingSize: 999_999 });

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as Record<string, unknown>;
      expect(params['samplingSize']).toBe(100_000);
    });

    it('rejects empty tenantId', async () => {
      const result = await analytics.computeBetweenness('');

      expect(result.success).toBe(false);
    });

    it('propagates client errors', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('Query timeout')),
      );

      const result = await analytics.computeBetweenness('tenant-001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Query timeout');
      }
    });
  });

  // ─── findSimilar ────────────────────────────────────────────

  describe('findSimilar()', () => {
    it('returns similar nodes with Jaccard scores', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([
          { nodeId: 'similar-1', similarity: 0.87 },
          { nodeId: 'similar-2', similarity: 0.65 },
        ]),
      );

      const result = await analytics.findSimilar('node-1', 'tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0]!.similarity).toBe(0.87);
      }
    });

    it('uses default topK of 10', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.findSimilar('node-1', 'tenant-001');

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as Record<string, unknown>;
      expect(params['topK']).toBe(10);
    });

    it('accepts custom topK', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.findSimilar('node-1', 'tenant-001', { topK: 25 });

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as Record<string, unknown>;
      expect(params['topK']).toBe(25);
    });

    it('clamps topK to valid range (1-100)', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      await analytics.findSimilar('node-1', 'tenant-001', { topK: 500 });

      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as Record<string, unknown>;
      expect(params['topK']).toBe(100);
    });

    it('excludes the source node from results (via query design)', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ nodeId: 'other-1', similarity: 0.5 }]),
      );

      const result = await analytics.findSimilar('node-1', 'tenant-001');

      // The Cypher query includes WHERE candidate.id <> $nodeId
      const callArgs = (mockClient.runQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const cypher = callArgs[0] as string;
      expect(cypher).toContain('candidate.id <> $nodeId');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.every((r) => r.nodeId !== 'node-1')).toBe(true);
      }
    });

    it('rejects empty nodeId', async () => {
      const result = await analytics.findSimilar('', 'tenant-001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('nodeId');
      }
    });

    it('rejects empty tenantId', async () => {
      const result = await analytics.findSimilar('node-1', '');

      expect(result.success).toBe(false);
    });

    it('propagates client errors', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('Connection lost')),
      );

      const result = await analytics.findSimilar('node-1', 'tenant-001');

      expect(result.success).toBe(false);
    });

    it('returns empty array when no similar nodes found', async () => {
      (mockClient.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));

      const result = await analytics.findSimilar('isolated-node', 'tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(0);
      }
    });
  });

  // ─── Client connectivity ────────────────────────────────────

  describe('client connectivity', () => {
    it('returns error when client is not connected', async () => {
      const disconnected = createMockClient(false);
      const analyticsDisc = new GraphAnalytics(disconnected);
      (disconnected.runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('Neo4j client is not connected')),
      );

      const result = await analyticsDisc.computePageRank('tenant-001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('not connected');
      }
    });
  });
});
