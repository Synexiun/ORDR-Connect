/**
 * Scheduler — cron/one-time job definitions and execution instances
 *
 * job_definitions: what jobs exist and when they should run.
 * job_instances: individual execution records (one per scheduled run).
 * job_dead_letters: permanently failed jobs requiring manual review.
 *
 * SOC2 CC7.1 — Automated compliance and health checks scheduled here.
 * ISO 27001 A.12.4.1 — Event logging for all automated operations.
 * HIPAA §164.312(b) — Audit controls on system-level background tasks.
 *
 * SECURITY:
 * - Payloads are JSONB — must NEVER contain PHI
 * - tryLock/releaseLock implemented via UPDATE WHERE locked_by IS NULL (atomic)
 * - Tenant isolation: tenant_id nullable (null = system job)
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const jobStatusEnum = pgEnum('job_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'retrying',
  'cancelled',
]);

export const jobPriorityEnum = pgEnum('job_priority', ['critical', 'high', 'normal', 'low']);

// ---------------------------------------------------------------------------
// job_definitions — templates for scheduled or recurring jobs
// ---------------------------------------------------------------------------

export const jobDefinitions = pgTable(
  'job_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** 5-field cron expression. Null = one-time job. */
    cronExpression: text('cron_expression'),
    jobType: text('job_type').notNull(),
    /** Default payload template. Must NEVER contain PHI. */
    payloadTemplate: jsonb('payload_template').notNull().default('{}'),
    isActive: boolean('is_active').notNull().default(true),
    priority: jobPriorityEnum('priority').notNull().default('normal'),
    /** Retry policy serialised as JSONB. */
    retryPolicy: jsonb('retry_policy').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('job_definitions_job_type_idx').on(t.jobType),
    index('job_definitions_active_idx').on(t.isActive),
  ],
);

// ---------------------------------------------------------------------------
// job_instances — individual execution records
// ---------------------------------------------------------------------------

export const jobInstances = pgTable(
  'job_instances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => jobDefinitions.id),
    /** Null for system-level (non-tenant) jobs. */
    tenantId: uuid('tenant_id'),
    status: jobStatusEnum('status').notNull().default('pending'),
    /** Runtime payload. Must NEVER contain PHI. */
    payload: jsonb('payload').notNull().default('{}'),
    /** Execution result JSONB. Null until completed. */
    result: jsonb('result'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),
    /** Scheduler instance ID holding the lock. Null = unlocked. */
    lockedBy: text('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('job_instances_status_idx').on(t.status),
    index('job_instances_tenant_idx').on(t.tenantId),
    index('job_instances_next_retry_idx').on(t.nextRetryAt),
    index('job_instances_created_idx').on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// job_dead_letters — permanently failed jobs requiring manual review
// ---------------------------------------------------------------------------

export const jobDeadLetters = pgTable(
  'job_dead_letters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobInstanceId: uuid('job_instance_id')
      .notNull()
      .references(() => jobInstances.id),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => jobDefinitions.id),
    error: text('error').notNull(),
    /** Payload at time of final failure. No PHI. */
    payload: jsonb('payload').notNull().default('{}'),
    failedAt: timestamp('failed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('job_dead_letters_failed_at_idx').on(t.failedAt),
    index('job_dead_letters_definition_idx').on(t.definitionId),
  ],
);
