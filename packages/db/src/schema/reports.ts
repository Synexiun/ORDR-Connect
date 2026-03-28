/**
 * Reports — generated report metadata and scheduled report definitions
 *
 * Stores report metadata and computed aggregate snapshots (non-PHI).
 * Report content is aggregate data only — no PII or PHI in stored values.
 *
 * SOC2 PI1.4 — Processing integrity: audit trail for all generated reports.
 * ISO 27001 A.18.1 — Compliance with legal and contractual requirements.
 * HIPAA §164.308(a)(8) — Periodic technical and non-technical evaluation.
 */

import { pgTable, pgEnum, uuid, text, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const reportTypeEnum = pgEnum('report_type', [
  'operations',
  'agent-performance',
  'compliance-audit',
  'channel-analytics',
  'customer-health',
  'revenue',
  'hipaa',
  'sla',
]);

export const reportStatusEnum = pgEnum('report_status', ['completed', 'generating', 'failed']);

export const scheduleFrequencyEnum = pgEnum('schedule_frequency', [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
]);

export const scheduleStatusEnum = pgEnum('schedule_status', ['active', 'paused']);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const generatedReports = pgTable(
  'generated_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    type: reportTypeEnum('type').notNull(),

    name: text('name').notNull(),

    /** Email or system identifier of the requesting user — NOT PHI */
    generatedBy: text('generated_by').notNull(),

    timeRangeStart: timestamp('time_range_start', { withTimezone: true }).notNull(),

    timeRangeEnd: timestamp('time_range_end', { withTimezone: true }).notNull(),

    status: reportStatusEnum('status').notNull().default('generating'),

    rowCount: integer('row_count').notNull().default(0),

    sizeBytes: integer('size_bytes').notNull().default(0),

    /**
     * Computed ReportData snapshot stored as JSONB.
     * Aggregate non-PHI values only — no PII, no patient refs.
     * Null while status='generating'.
     */
    reportData: jsonb('report_data').$type<Record<string, unknown>>(),

    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('generated_reports_tenant_idx').on(t.tenantId, t.generatedAt)],
);

export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),

    type: reportTypeEnum('type').notNull(),

    frequency: scheduleFrequencyEnum('frequency').notNull(),

    /** Array of recipient email addresses */
    recipients: jsonb('recipients').$type<string[]>().notNull().default([]),

    status: scheduleStatusEnum('status').notNull().default('active'),

    nextRun: timestamp('next_run', { withTimezone: true }).notNull(),

    lastRun: timestamp('last_run', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('report_schedules_tenant_idx').on(t.tenantId)],
);
