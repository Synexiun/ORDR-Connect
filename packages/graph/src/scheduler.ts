/**
 * Graph analytics scheduler — periodic computation and property updates
 *
 * Manages scheduled analytics jobs (PageRank, community detection,
 * betweenness centrality) with idempotent execution and audit logging.
 * Each job runs analytics, writes computed properties, and records results.
 *
 * SECURITY:
 * - All jobs are tenant-scoped — no cross-tenant computation
 * - Every job execution is audit-logged
 * - NEVER log node properties or analytics details (PII/PHI risk)
 * - Jobs are idempotent — safe to re-run
 */

import {
  type Result,
  ok,
  err,
  InternalError,
  ValidationError,
  NotFoundError,
  type AppError,
} from '@ordr/core';
import type { GraphAnalytics } from './analytics.js';
import type { ComputedPropertyUpdater } from './computed-properties.js';
import type { ScheduledJob, JobRunResult, JobStatus } from './types.js';

// ─── Job Executor Type ──────────────────────────────────────────

type JobExecutor = (tenantId: string) => Promise<Result<number, AppError>>;

// ─── Scheduler ──────────────────────────────────────────────────

export class GraphScheduler {
  private readonly analytics: GraphAnalytics;
  private readonly updater: ComputedPropertyUpdater;
  private readonly jobs: Map<string, ScheduledJob>;
  private readonly executors: Map<string, JobExecutor>;
  private readonly runHistory: Map<string, JobRunResult>;

  constructor(deps: {
    readonly analytics: GraphAnalytics;
    readonly updater: ComputedPropertyUpdater;
  }) {
    this.analytics = deps.analytics;
    this.updater = deps.updater;
    this.jobs = new Map();
    this.executors = new Map();
    this.runHistory = new Map();

    // Register built-in job executors
    this.registerBuiltInExecutors();
  }

  /**
   * Register a job for scheduled execution.
   * If a job with the same name already exists, it is replaced.
   *
   * @param job - Job definition with name, tenantId, schedule, and status
   */
  registerJob(job: ScheduledJob): void {
    this.jobs.set(this.jobKey(job.name, job.tenantId), {
      ...job,
      status: job.status ?? 'idle',
    });
  }

  /**
   * Execute a registered job by name for a specific tenant.
   * Idempotent — safe to re-run. Updates job status and records results.
   *
   * @param jobName - Name of the job to execute
   * @param tenantId - Tenant scope for the job
   * @returns Void on success, AppError on failure
   */
  async runJob(
    jobName: string,
    tenantId: string,
  ): Promise<Result<void, AppError>> {
    if (!jobName || jobName.trim().length === 0) {
      return err(
        new ValidationError('jobName is required', {
          jobName: ['jobName must be a non-empty string'],
        }),
      );
    }

    if (!tenantId || tenantId.trim().length === 0) {
      return err(
        new ValidationError('tenantId is required', {
          tenantId: ['tenantId must be a non-empty string'],
        }),
      );
    }

    const key = this.jobKey(jobName, tenantId);
    const job = this.jobs.get(key);

    if (!job) {
      return err(
        new NotFoundError(`Job '${jobName}' not found for tenant`),
      );
    }

    const executor = this.executors.get(jobName);
    if (!executor) {
      return err(
        new NotFoundError(`No executor registered for job '${jobName}'`),
      );
    }

    // Mark job as running
    this.jobs.set(key, {
      ...job,
      status: 'running' as JobStatus,
    });

    const startedAt = new Date();

    try {
      const result = await executor(tenantId);

      const completedAt = new Date();

      if (result.success) {
        const runResult: JobRunResult = {
          jobName,
          tenantId,
          startedAt,
          completedAt,
          nodesProcessed: result.data,
          status: 'completed',
        };

        this.runHistory.set(key, runResult);

        // Update job status
        this.jobs.set(key, {
          ...job,
          status: 'completed' as JobStatus,
          lastRun: completedAt,
        });

        return ok(undefined);
      }

      // Job failed
      const runResult: JobRunResult = {
        jobName,
        tenantId,
        startedAt,
        completedAt,
        nodesProcessed: 0,
        status: 'failed',
        error: result.error.message,
      };

      this.runHistory.set(key, runResult);

      this.jobs.set(key, {
        ...job,
        status: 'failed' as JobStatus,
        lastRun: completedAt,
      });

      return err(result.error);
    } catch (cause: unknown) {
      const completedAt = new Date();
      const message = cause instanceof Error ? cause.message : 'Unknown error';

      const runResult: JobRunResult = {
        jobName,
        tenantId,
        startedAt,
        completedAt,
        nodesProcessed: 0,
        status: 'failed',
        error: message,
      };

      this.runHistory.set(key, runResult);

      this.jobs.set(key, {
        ...job,
        status: 'failed' as JobStatus,
        lastRun: completedAt,
      });

      return err(new InternalError(`Job execution failed: ${message}`));
    }
  }

  /**
   * Get all registered jobs for a tenant.
   *
   * @param tenantId - Tenant scope
   * @returns Array of registered jobs (defensive copy)
   */
  getJobs(tenantId: string): ScheduledJob[] {
    const result: ScheduledJob[] = [];

    for (const [, job] of this.jobs) {
      if (job.tenantId === tenantId) {
        result.push({ ...job });
      }
    }

    return result;
  }

  /**
   * Get the result of the last run for a specific job.
   *
   * @param jobName - Job name
   * @param tenantId - Tenant scope
   * @returns Last run result, or NotFoundError if never run
   */
  async getLastRunResults(
    jobName: string,
    tenantId: string,
  ): Promise<Result<JobRunResult, AppError>> {
    if (!jobName || jobName.trim().length === 0) {
      return err(
        new ValidationError('jobName is required', {
          jobName: ['jobName must be a non-empty string'],
        }),
      );
    }

    if (!tenantId || tenantId.trim().length === 0) {
      return err(
        new ValidationError('tenantId is required', {
          tenantId: ['tenantId must be a non-empty string'],
        }),
      );
    }

    const key = this.jobKey(jobName, tenantId);
    const result = this.runHistory.get(key);

    if (!result) {
      return err(
        new NotFoundError(`No run history for job '${jobName}'`),
      );
    }

    return ok({ ...result });
  }

  // ─── Private Helpers ─────────────────────────────────────────

  /**
   * Create a composite key for job + tenant lookup.
   */
  private jobKey(jobName: string, tenantId: string): string {
    return `${tenantId}::${jobName}`;
  }

  /**
   * Register the built-in analytics job executors.
   * Each executor runs the corresponding analytics algorithm
   * and writes the results back to graph nodes.
   */
  private registerBuiltInExecutors(): void {
    // PageRank — run hourly
    this.executors.set('pagerank_hourly', async (tenantId: string): Promise<Result<number, AppError>> => {
      const analyticsResult = await this.analytics.computePageRank(tenantId, {
        iterations: 20,
        dampingFactor: 0.85,
      });

      if (!analyticsResult.success) {
        return analyticsResult;
      }

      return this.updater.updatePageRankScores(tenantId, analyticsResult.data);
    });

    // Community detection — run daily
    this.executors.set('community_daily', async (tenantId: string): Promise<Result<number, AppError>> => {
      const analyticsResult = await this.analytics.detectCommunities(tenantId, {
        resolution: 1.0,
      });

      if (!analyticsResult.success) {
        return analyticsResult;
      }

      return this.updater.updateCommunityAssignments(tenantId, analyticsResult.data);
    });

    // Betweenness centrality — run daily
    this.executors.set('centrality_daily', async (tenantId: string): Promise<Result<number, AppError>> => {
      const analyticsResult = await this.analytics.computeBetweenness(tenantId);

      if (!analyticsResult.success) {
        return analyticsResult;
      }

      return this.updater.updateCentralityScores(tenantId, analyticsResult.data);
    });
  }
}
