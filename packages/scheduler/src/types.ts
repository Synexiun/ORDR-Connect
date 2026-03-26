/**
 * @ordr/scheduler — Type definitions for the scheduled jobs system.
 *
 * SOC2 CC7.1 — Monitoring: scheduled compliance checks and health probes.
 * ISO 27001 A.12.4.1 — Event logging for all automated operations.
 * HIPAA §164.312(b) — Audit controls on system-level background tasks.
 *
 * All types are strict — zero `any`, zero optional where required.
 */

// ─── Job Status ──────────────────────────────────────────────────

export const JOB_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'retrying',
  'cancelled',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

// ─── Job Priority ────────────────────────────────────────────────

export const JOB_PRIORITIES = [
  'critical',
  'high',
  'normal',
  'low',
] as const;

export type JobPriority = (typeof JOB_PRIORITIES)[number];

/** Numeric ranking — critical executes first. */
export const PRIORITY_RANK: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
} as const;

// ─── Cron Expression ─────────────────────────────────────────────

/** A validated 5-field cron expression string. */
export type CronExpression = string & { readonly __cronBrand: never };

// ─── Retry Policy ────────────────────────────────────────────────

export interface RetryPolicy {
  /** Maximum number of retry attempts. */
  readonly maxRetries: number;
  /** Base delay in milliseconds before first retry. */
  readonly baseDelayMs: number;
  /** Maximum delay in milliseconds (cap for exponential backoff). */
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 30_000,    // 30 seconds
  maxDelayMs: 3_600_000,  // 1 hour
} as const;

// ─── Job Definition ──────────────────────────────────────────────

export interface JobDefinition {
  /** Unique identifier for the job type. */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Description of what this job does. */
  readonly description: string;
  /** 5-field cron expression for scheduling. Null for one-time jobs. */
  readonly cronExpression: CronExpression | null;
  /** Job type identifier for handler routing. */
  readonly jobType: string;
  /** Default payload template (JSONB). */
  readonly payloadTemplate: Record<string, unknown>;
  /** Whether this job definition is active. */
  readonly isActive: boolean;
  /** Execution priority. */
  readonly priority: JobPriority;
  /** Retry policy for failed executions. */
  readonly retryPolicy: RetryPolicy;
  /** When this definition was created. */
  readonly createdAt: Date;
  /** When this definition was last updated. */
  readonly updatedAt: Date;
}

// ─── Job Instance ────────────────────────────────────────────────

export interface JobInstance {
  /** Unique instance identifier. */
  readonly id: string;
  /** Reference to the job definition. */
  readonly definitionId: string;
  /** Tenant ID for tenant-scoped jobs, null for system jobs. */
  readonly tenantId: string | null;
  /** Current execution status. */
  readonly status: JobStatus;
  /** Job payload (JSONB). */
  readonly payload: Record<string, unknown>;
  /** Execution result (JSONB), null until completed. */
  readonly result: Record<string, unknown> | null;
  /** Error message if failed. */
  readonly error: string | null;
  /** When execution started. */
  readonly startedAt: Date | null;
  /** When execution completed (success or final failure). */
  readonly completedAt: Date | null;
  /** When the next retry should occur. */
  readonly nextRetryAt: Date | null;
  /** Number of retry attempts completed. */
  readonly retryCount: number;
  /** Instance ID that holds the advisory lock. */
  readonly lockedBy: string | null;
  /** When the lock was acquired. */
  readonly lockedAt: Date | null;
  /** When this instance was created. */
  readonly createdAt: Date;
}

// ─── Job Result ──────────────────────────────────────────────────

export interface JobResult {
  readonly success: boolean;
  readonly data: Record<string, unknown>;
  readonly error?: string | undefined;
  readonly durationMs: number;
}

// ─── Job Handler ─────────────────────────────────────────────────

/**
 * Handler function that executes a job.
 * Receives the job payload and returns a result.
 * MUST NOT throw — return a failed JobResult instead.
 */
export type JobHandler = (payload: Record<string, unknown>) => Promise<JobResult>;

// ─── Dead Letter Entry ───────────────────────────────────────────

export interface DeadLetterEntry {
  readonly id: string;
  readonly jobInstanceId: string;
  readonly definitionId: string;
  readonly error: string;
  readonly payload: Record<string, unknown>;
  readonly failedAt: Date;
}

// ─── Scheduler Config ────────────────────────────────────────────

export interface SchedulerConfig {
  /** How often to poll for due jobs, in milliseconds. Default: 15000. */
  readonly pollIntervalMs: number;
  /** Unique identifier for this scheduler instance (for advisory locks). */
  readonly instanceId: string;
  /** Maximum number of concurrent jobs. Default: 10. */
  readonly maxConcurrentJobs: number;
  /** Stale lock timeout in milliseconds. Default: 300000 (5 min). */
  readonly staleLockTimeoutMs: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  pollIntervalMs: 15_000,
  instanceId: 'scheduler-default',
  maxConcurrentJobs: 10,
  staleLockTimeoutMs: 300_000,
} as const;

// ─── Scheduler Status ────────────────────────────────────────────

export interface SchedulerStatus {
  readonly running: boolean;
  readonly instanceId: string;
  readonly runningJobs: number;
  readonly registeredHandlers: number;
  readonly uptime: number;
  readonly lastPollAt: Date | null;
  readonly nextScheduled: ReadonlyArray<{
    readonly definitionId: string;
    readonly jobType: string;
    readonly nextRunAt: Date;
  }>;
}
