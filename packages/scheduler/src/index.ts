/**
 * @ordr/scheduler — Scheduled Jobs & Cron Engine
 *
 * Manages recurring and one-off scheduled jobs with cron expressions,
 * retry policies, dead-letter queuing, and advisory locking.
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - All job executions audit-logged (CC7.2)
 * - Failed jobs tracked in dead-letter queue (A.12.1.3)
 * - Tenant isolation on all operations (CC6.1)
 * - Advisory locks prevent duplicate execution (PI1.4)
 *
 * Usage:
 *   import { JobScheduler, InMemorySchedulerStore, parseCron } from '@ordr/scheduler';
 *
 *   const store = new InMemorySchedulerStore();
 *   const scheduler = new JobScheduler({ store });
 *   scheduler.registerJob(jobDefinition, handler);
 *   await scheduler.start();
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  JobStatus,
  JobPriority,
  CronExpression,
  RetryPolicy,
  JobDefinition,
  JobInstance,
  JobResult,
  JobHandler,
  DeadLetterEntry,
  SchedulerConfig,
  SchedulerStatus,
} from './types.js';

export {
  JOB_STATUSES,
  JOB_PRIORITIES,
  DEFAULT_RETRY_POLICY,
  DEFAULT_SCHEDULER_CONFIG,
} from './types.js';

// ─── Cron Parser ──────────────────────────────────────────────────
export { parseCron, isValidCron, createCronExpression, nextOccurrence } from './cron-parser.js';

export type { ParsedCron } from './cron-parser.js';

// ─── Scheduler ────────────────────────────────────────────────────
export { JobScheduler, InMemorySchedulerStore } from './scheduler.js';

export type { SchedulerStore, SchedulerAuditLogger, SchedulerAlertCallback } from './scheduler.js';

// ─── Drizzle Store ────────────────────────────────────────────────
export { DrizzleSchedulerStore } from './drizzle-store.js';

// ─── Job Definitions ──────────────────────────────────────────────
export {
  createDsrDeadlineCheckDefinition,
  createDsrDeadlineCheckHandler,
  DSR_DEADLINE_CHECK_JOB_ID,
  DSR_DEADLINE_CHECK_CRON,
} from './jobs/dsr-deadline-check.js';

export type { DsrDeadlineCheckDeps } from './jobs/dsr-deadline-check.js';

export {
  createIntegrationBatchSyncDefinition,
  createIntegrationBatchSyncHandler,
  INTEGRATION_BATCH_SYNC_JOB_ID,
  INTEGRATION_BATCH_SYNC_CRON,
} from './jobs/integration-batch-sync.js';

export type { IntegrationBatchSyncDeps } from './jobs/integration-batch-sync.js';

export {
  createKeyRotationCheckDefinition,
  createKeyRotationCheckHandler,
  KEY_ROTATION_CHECK_JOB_ID,
  KEY_ROTATION_CHECK_CRON,
} from './jobs/key-rotation-check.js';

export type { KeyRotationCheckDeps } from './jobs/key-rotation-check.js';
