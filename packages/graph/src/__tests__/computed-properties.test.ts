import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComputedPropertyUpdater } from '../computed-properties.js';
import { ok, err, InternalError } from '@ordr/core';
import type { GraphClient } from '../client.js';
import type { PageRankResult, CommunityResult, CentralityResult } from '../types.js';
import { BATCH_SIZE } from '../types.js';

// ─── Mock GraphClient ───────────────────────────────────────────

function createMockClient(): GraphClient {
  return {
    runQuery: vi.fn(),
    runWriteQuery: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    connect: vi.fn(),
    close: vi.fn(),
  } as unknown as GraphClient;
}

// ─── Helpers ────────────────────────────────────────────────────

function makePageRankResults(count: number): PageRankResult[] {
  return Array.from({ length: count }, (_, i) => ({
    nodeId: `node-${i}`,
    nodeType: 'Person',
    score: Math.random(),
  }));
}

function makeCommunityResults(count: number): CommunityResult[] {
  return Array.from({ length: count }, (_, i) => ({
    nodeId: `node-${i}`,
    communityId: i % 5,
  }));
}

function makeCentralityResults(count: number): CentralityResult[] {
  return Array.from({ length: count }, (_, i) => ({
    nodeId: `node-${i}`,
    score: Math.random() * 100,
  }));
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ComputedPropertyUpdater', () => {
  let mockClient: GraphClient;
  let updater: ComputedPropertyUpdater;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    updater = new ComputedPropertyUpdater(mockClient);
  });

  // ─── updatePageRankScores ─────────────────────────────────

  describe('updatePageRankScores()', () => {
    it('updates nodes with influence_score property', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ updated: 3 }]),
      );

      const results = makePageRankResults(3);
      const result = await updater.updatePageRankScores('tenant-001', results);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(3);
      }

      expect(mockClient.runWriteQuery).toHaveBeenCalledOnce();
      const callArgs = (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const cypher = callArgs[0] as string;
      expect(cypher).toContain('influence_score');
      expect(cypher).toContain('tenantId');
    });

    it('returns 0 for empty results', async () => {
      const result = await updater.updatePageRankScores('tenant-001', []);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(0);
      }
      expect(mockClient.runWriteQuery).not.toHaveBeenCalled();
    });

    it('batches updates in groups of BATCH_SIZE', async () => {
      const count = BATCH_SIZE + 50; // 150 nodes = 2 batches
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(ok([{ updated: BATCH_SIZE }]))
        .mockResolvedValueOnce(ok([{ updated: 50 }]));

      const results = makePageRankResults(count);
      const result = await updater.updatePageRankScores('tenant-001', results);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(count);
      }
      expect(mockClient.runWriteQuery).toHaveBeenCalledTimes(2);
    });

    it('rejects empty tenantId', async () => {
      const result = await updater.updatePageRankScores('', makePageRankResults(1));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('tenantId');
      }
    });

    it('handles partial failure and reports progress', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(ok([{ updated: BATCH_SIZE }]))
        .mockResolvedValueOnce(err(new InternalError('Write failed')));

      const results = makePageRankResults(BATCH_SIZE + 50);
      const result = await updater.updatePageRankScores('tenant-001', results);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('partially failed');
        expect(result.error.message).toContain(String(BATCH_SIZE));
      }
    });
  });

  // ─── updateCommunityAssignments ───────────────────────────

  describe('updateCommunityAssignments()', () => {
    it('updates nodes with community_id property', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ updated: 4 }]),
      );

      const results = makeCommunityResults(4);
      const result = await updater.updateCommunityAssignments('tenant-001', results);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(4);
      }

      const callArgs = (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const cypher = callArgs[0] as string;
      expect(cypher).toContain('community_id');
    });

    it('returns 0 for empty results', async () => {
      const result = await updater.updateCommunityAssignments('tenant-001', []);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(0);
      }
    });

    it('rejects empty tenantId', async () => {
      const result = await updater.updateCommunityAssignments('', makeCommunityResults(1));

      expect(result.success).toBe(false);
    });
  });

  // ─── updateCentralityScores ───────────────────────────────

  describe('updateCentralityScores()', () => {
    it('updates nodes with centrality_score property', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ updated: 5 }]),
      );

      const results = makeCentralityResults(5);
      const result = await updater.updateCentralityScores('tenant-001', results);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(5);
      }

      const callArgs = (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const cypher = callArgs[0] as string;
      expect(cypher).toContain('centrality_score');
    });

    it('returns 0 for empty results', async () => {
      const result = await updater.updateCentralityScores('tenant-001', []);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(0);
      }
    });

    it('rejects empty tenantId', async () => {
      const result = await updater.updateCentralityScores('', makeCentralityResults(1));

      expect(result.success).toBe(false);
    });

    it('returns error on write failure (first batch)', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('Database unavailable')),
      );

      const result = await updater.updateCentralityScores(
        'tenant-001',
        makeCentralityResults(5),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Database unavailable');
      }
    });
  });

  // ─── Tenant isolation ─────────────────────────────────────

  describe('tenant isolation', () => {
    it('passes tenantId to every write query', async () => {
      (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([{ updated: 1 }]),
      );

      await updater.updatePageRankScores('tenant-abc', makePageRankResults(1));
      await updater.updateCommunityAssignments('tenant-abc', makeCommunityResults(1));
      await updater.updateCentralityScores('tenant-abc', makeCentralityResults(1));

      const calls = (mockClient.runWriteQuery as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of calls) {
        expect(call[2]).toBe('tenant-abc');
      }
    });
  });
});
