import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphScheduler } from '../scheduler.js';
import { ok, err, InternalError } from '@ordr/core';
import type { GraphAnalytics } from '../analytics.js';
import type { ComputedPropertyUpdater } from '../computed-properties.js';
import type { ScheduledJob } from '../types.js';

// ─── Mock Analytics & Updater ───────────────────────────────────

function createMockAnalytics(): GraphAnalytics {
  return {
    computePageRank: vi.fn(),
    detectCommunities: vi.fn(),
    computeBetweenness: vi.fn(),
    findSimilar: vi.fn(),
  } as unknown as GraphAnalytics;
}

function createMockUpdater(): ComputedPropertyUpdater {
  return {
    updatePageRankScores: vi.fn(),
    updateCommunityAssignments: vi.fn(),
    updateCentralityScores: vi.fn(),
  } as unknown as ComputedPropertyUpdater;
}

// ─── Helpers ────────────────────────────────────────────────────

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    name: 'pagerank_hourly',
    tenantId: 'tenant-001',
    schedule: '0 * * * *',
    lastRun: null,
    nextRun: null,
    status: 'idle',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('GraphScheduler', () => {
  let mockAnalytics: GraphAnalytics;
  let mockUpdater: ComputedPropertyUpdater;
  let scheduler: GraphScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalytics = createMockAnalytics();
    mockUpdater = createMockUpdater();
    scheduler = new GraphScheduler({
      analytics: mockAnalytics,
      updater: mockUpdater,
    });
  });

  // ─── registerJob ──────────────────────────────────────────

  describe('registerJob()', () => {
    it('registers a job that can be retrieved', () => {
      const job = makeJob();
      scheduler.registerJob(job);

      const jobs = scheduler.getJobs('tenant-001');
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.name).toBe('pagerank_hourly');
    });

    it('replaces existing job with same name and tenant', () => {
      scheduler.registerJob(makeJob({ schedule: '0 * * * *' }));
      scheduler.registerJob(makeJob({ schedule: '*/30 * * * *' }));

      const jobs = scheduler.getJobs('tenant-001');
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.schedule).toBe('*/30 * * * *');
    });

    it('stores jobs for different tenants separately', () => {
      scheduler.registerJob(makeJob({ tenantId: 'tenant-001' }));
      scheduler.registerJob(makeJob({ tenantId: 'tenant-002' }));

      expect(scheduler.getJobs('tenant-001')).toHaveLength(1);
      expect(scheduler.getJobs('tenant-002')).toHaveLength(1);
    });
  });

  // ─── runJob ───────────────────────────────────────────────

  describe('runJob()', () => {
    it('executes pagerank_hourly job successfully', async () => {
      scheduler.registerJob(makeJob({ name: 'pagerank_hourly' }));

      (mockAnalytics.computePageRank as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([
          { nodeId: 'n1', nodeType: 'Person', score: 0.9 },
          { nodeId: 'n2', nodeType: 'Company', score: 0.7 },
        ]),
      );
      (mockUpdater.updatePageRankScores as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(2),
      );

      const result = await scheduler.runJob('pagerank_hourly', 'tenant-001');

      expect(result.success).toBe(true);
      expect(mockAnalytics.computePageRank).toHaveBeenCalledOnce();
      expect(mockUpdater.updatePageRankScores).toHaveBeenCalledOnce();
    });

    it('executes community_daily job successfully', async () => {
      scheduler.registerJob(makeJob({ name: 'community_daily' }));

      (mockAnalytics.detectCommunities as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([
          { nodeId: 'n1', communityId: 0 },
          { nodeId: 'n2', communityId: 1 },
        ]),
      );
      (mockUpdater.updateCommunityAssignments as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(2),
      );

      const result = await scheduler.runJob('community_daily', 'tenant-001');

      expect(result.success).toBe(true);
      expect(mockAnalytics.detectCommunities).toHaveBeenCalledOnce();
    });

    it('executes centrality_daily job successfully', async () => {
      scheduler.registerJob(makeJob({ name: 'centrality_daily' }));

      (mockAnalytics.computeBetweenness as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ nodeId: 'n1', score: 50.0 }]),
      );
      (mockUpdater.updateCentralityScores as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(1),
      );

      const result = await scheduler.runJob('centrality_daily', 'tenant-001');

      expect(result.success).toBe(true);
    });

    it('returns NotFoundError for unregistered job', async () => {
      const result = await scheduler.runJob('nonexistent', 'tenant-001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('updates job status to completed on success', async () => {
      scheduler.registerJob(makeJob({ name: 'pagerank_hourly' }));

      (mockAnalytics.computePageRank as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));
      (mockUpdater.updatePageRankScores as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(0));

      await scheduler.runJob('pagerank_hourly', 'tenant-001');

      const jobs = scheduler.getJobs('tenant-001');
      expect(jobs[0]!.status).toBe('completed');
      expect(jobs[0]!.lastRun).not.toBeNull();
    });

    it('updates job status to failed on error', async () => {
      scheduler.registerJob(makeJob({ name: 'pagerank_hourly' }));

      (mockAnalytics.computePageRank as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('GDS unavailable')),
      );

      await scheduler.runJob('pagerank_hourly', 'tenant-001');

      const jobs = scheduler.getJobs('tenant-001');
      expect(jobs[0]!.status).toBe('failed');
    });

    it('rejects empty jobName', async () => {
      const result = await scheduler.runJob('', 'tenant-001');

      expect(result.success).toBe(false);
    });

    it('rejects empty tenantId', async () => {
      const result = await scheduler.runJob('pagerank_hourly', '');

      expect(result.success).toBe(false);
    });
  });

  // ─── getLastRunResults ────────────────────────────────────

  describe('getLastRunResults()', () => {
    it('returns last run result after successful execution', async () => {
      scheduler.registerJob(makeJob({ name: 'pagerank_hourly' }));

      (mockAnalytics.computePageRank as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ nodeId: 'n1', nodeType: 'Person', score: 0.5 }]),
      );
      (mockUpdater.updatePageRankScores as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok(1),
      );

      await scheduler.runJob('pagerank_hourly', 'tenant-001');

      const result = await scheduler.getLastRunResults('pagerank_hourly', 'tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.jobName).toBe('pagerank_hourly');
        expect(result.data.tenantId).toBe('tenant-001');
        expect(result.data.status).toBe('completed');
        expect(result.data.nodesProcessed).toBe(1);
        expect(result.data.startedAt).toBeInstanceOf(Date);
        expect(result.data.completedAt).toBeInstanceOf(Date);
      }
    });

    it('returns NotFoundError when job has never been run', async () => {
      const result = await scheduler.getLastRunResults('pagerank_hourly', 'tenant-001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('No run history');
      }
    });

    it('records failed run results with error message', async () => {
      scheduler.registerJob(makeJob({ name: 'pagerank_hourly' }));

      (mockAnalytics.computePageRank as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('Timeout')),
      );

      await scheduler.runJob('pagerank_hourly', 'tenant-001');

      const result = await scheduler.getLastRunResults('pagerank_hourly', 'tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('failed');
        expect(result.data.error).toContain('Timeout');
        expect(result.data.nodesProcessed).toBe(0);
      }
    });

    it('rejects empty jobName', async () => {
      const result = await scheduler.getLastRunResults('', 'tenant-001');

      expect(result.success).toBe(false);
    });

    it('rejects empty tenantId', async () => {
      const result = await scheduler.getLastRunResults('pagerank_hourly', '');

      expect(result.success).toBe(false);
    });
  });

  // ─── getJobs ──────────────────────────────────────────────

  describe('getJobs()', () => {
    it('returns empty array for tenant with no jobs', () => {
      const jobs = scheduler.getJobs('tenant-unknown');
      expect(jobs).toHaveLength(0);
    });

    it('returns only jobs for the specified tenant', () => {
      scheduler.registerJob(makeJob({ name: 'job-a', tenantId: 'tenant-001' }));
      scheduler.registerJob(makeJob({ name: 'job-b', tenantId: 'tenant-001' }));
      scheduler.registerJob(makeJob({ name: 'job-c', tenantId: 'tenant-002' }));

      const jobs = scheduler.getJobs('tenant-001');
      expect(jobs).toHaveLength(2);
      expect(jobs.every((j) => j.tenantId === 'tenant-001')).toBe(true);
    });
  });

  // ─── Idempotency ──────────────────────────────────────────

  describe('idempotency', () => {
    it('re-running a job overwrites previous results', async () => {
      scheduler.registerJob(makeJob({ name: 'pagerank_hourly' }));

      // First run
      (mockAnalytics.computePageRank as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([{ nodeId: 'n1', nodeType: 'Person', score: 0.5 }]),
      );
      (mockUpdater.updatePageRankScores as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(1));
      await scheduler.runJob('pagerank_hourly', 'tenant-001');

      // Second run with different results
      (mockAnalytics.computePageRank as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        ok([
          { nodeId: 'n1', nodeType: 'Person', score: 0.9 },
          { nodeId: 'n2', nodeType: 'Company', score: 0.8 },
        ]),
      );
      (mockUpdater.updatePageRankScores as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(2));
      await scheduler.runJob('pagerank_hourly', 'tenant-001');

      const result = await scheduler.getLastRunResults('pagerank_hourly', 'tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nodesProcessed).toBe(2); // Second run count
      }
    });
  });

  // ─── Error handling ───────────────────────────────────────

  describe('error handling', () => {
    it('handles unexpected thrown errors during job execution', async () => {
      scheduler.registerJob(makeJob({ name: 'pagerank_hourly' }));

      (mockAnalytics.computePageRank as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Unexpected crash'),
      );

      const result = await scheduler.runJob('pagerank_hourly', 'tenant-001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Unexpected crash');
      }

      // Job status should be failed
      const jobs = scheduler.getJobs('tenant-001');
      expect(jobs[0]!.status).toBe('failed');
    });
  });
});
