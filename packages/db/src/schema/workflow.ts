/**
 * Workflow — multi-step automation definitions and execution instances
 *
 * Workflow definitions describe what to do; instances track in-flight execution.
 * Step results are append-only — one row per (instance, step, attempt).
 *
 * SOC2 CC7.2 — Automated workflows logged and auditable.
 * ISO 27001 A.12.4.1 — Operational log for all automated processing.
 * HIPAA §164.312(b) — Audit controls: context is encrypted (AES-256-GCM).
 *
 * SECURITY:
 * - context column is encrypted before write (AES-256-GCM, field-level)
 * - No PHI stored in plaintext; only tokenized entity IDs
 * - Tenant isolation via RLS (set at migration time)
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
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const workflowStatusEnum = pgEnum('workflow_status', [
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

export const stepStatusEnum = pgEnum('step_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'waiting',
]);

export const stepTypeEnum = pgEnum('step_type', [
  'action',
  'condition',
  'delay',
  'parallel',
  'human-review',
]);

export const triggerTypeEnum = pgEnum('trigger_type', ['event', 'schedule', 'manual']);

// ---------------------------------------------------------------------------
// workflow_definitions — versioned workflow templates (tenant-scoped)
// ---------------------------------------------------------------------------

export const workflowDefinitions = pgTable(
  'workflow_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    version: integer('version').notNull().default(1),
    /** Steps array serialised as JSONB. No PHI. */
    steps: jsonb('steps').notNull().default('[]'),
    /** Triggers array serialised as JSONB. */
    triggers: jsonb('triggers').notNull().default('[]'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('workflow_definitions_tenant_idx').on(t.tenantId),
    index('workflow_definitions_active_idx').on(t.tenantId, t.isActive),
  ],
);

// ---------------------------------------------------------------------------
// workflow_instances — execution records (one per workflow run)
// ---------------------------------------------------------------------------

export const workflowInstances = pgTable(
  'workflow_instances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => workflowDefinitions.id),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    status: workflowStatusEnum('status').notNull().default('pending'),
    currentStepIndex: integer('current_step_index').notNull().default(0),
    /** AES-256-GCM encrypted WorkflowContext. No plaintext PHI. */
    context: jsonb('context').notNull().default('{}'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [
    index('workflow_instances_tenant_idx').on(t.tenantId),
    index('workflow_instances_status_idx').on(t.tenantId, t.status),
    index('workflow_instances_entity_idx').on(t.tenantId, t.entityType, t.entityId),
    index('workflow_instances_def_entity_idx').on(
      t.tenantId,
      t.definitionId,
      t.entityType,
      t.entityId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// workflow_step_results — per-step execution records (append-only)
// ---------------------------------------------------------------------------

export const workflowStepResults = pgTable(
  'workflow_step_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => workflowInstances.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    stepType: stepTypeEnum('step_type').notNull(),
    status: stepStatusEnum('status').notNull(),
    /** Input parameters — no PHI. */
    input: jsonb('input').notNull().default('{}'),
    /** Output data — no PHI. */
    output: jsonb('output').notNull().default('{}'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    error: text('error'),
    retryCount: integer('retry_count').notNull().default(0),
  },
  (t) => [
    index('workflow_step_results_instance_idx').on(t.instanceId),
    index('workflow_step_results_instance_step_idx').on(t.instanceId, t.stepIndex),
  ],
);
