/**
 * Notifications — in-app alerts for HITL approvals, compliance, escalations, SLA
 *
 * Stores tenant-scoped notification records. Feeds the Notification Center UI.
 * No PHI in notifications — metadata and action descriptions only.
 *
 * SOC2 CC7.2 — Monitoring: in-app alerts for security-relevant events.
 * ISO 27001 A.16.1.2 — Reporting information security events.
 * HIPAA §164.312(b) — Audit controls: notification lifecycle logged.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const notificationTypeEnum = pgEnum('notification_type', [
  'hitl',
  'compliance',
  'escalation',
  'sla',
  'system',
]);

export const notificationSeverityEnum = pgEnum('notification_severity', [
  'critical',
  'high',
  'medium',
  'low',
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** Null = tenant-wide notification; set = user-specific */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    type: notificationTypeEnum('type').notNull(),

    severity: notificationSeverityEnum('severity').notNull().default('low'),

    /** Short title — displayed in the notification list header */
    title: text('title').notNull(),

    /** Full description — no PHI, metadata/action references only */
    description: text('description').notNull(),

    read: boolean('read').notNull().default(false),

    dismissed: boolean('dismissed').notNull().default(false),

    /** Optional CTA label (e.g., "Review", "Approve") */
    actionLabel: varchar('action_label', { length: 100 }),

    /** Optional frontend route to navigate to on action */
    actionRoute: varchar('action_route', { length: 500 }),

    /** Non-PHI metadata for additional context (keys and non-sensitive values only) */
    metadata: jsonb('metadata').$type<Record<string, string>>().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    readAt: timestamp('read_at', { withTimezone: true }),

    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => [
    index('notifications_tenant_read_idx').on(t.tenantId, t.read),
    index('notifications_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('notifications_tenant_type_idx').on(t.tenantId, t.type),
  ],
);
