/**
 * Support Tickets — internal ticketing system for ops, compliance, and billing issues
 *
 * SOC2 CC9.1 — Vendor management: customer-reported issues tracked to resolution.
 * ISO 27001 A.16 — Information security incident management lifecycle.
 * HIPAA §164.308(a)(6) — Security incident response and reporting procedures.
 *
 * No PHI stored in ticket content — operational and technical descriptions only.
 */

import { pgTable, pgEnum, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ticketStatusEnum = pgEnum('ticket_status', [
  'open',
  'in-progress',
  'waiting',
  'resolved',
  'closed',
]);

export const ticketPriorityEnum = pgEnum('ticket_priority', ['low', 'medium', 'high', 'critical']);

export const ticketCategoryEnum = pgEnum('ticket_category', [
  'bug',
  'feature',
  'question',
  'compliance',
  'billing',
]);

export const ticketMessageAuthorRoleEnum = pgEnum('ticket_message_author_role', [
  'user',
  'admin',
  'system',
]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),

    status: ticketStatusEnum('status').notNull().default('open'),

    priority: ticketPriorityEnum('priority').notNull().default('medium'),

    category: ticketCategoryEnum('category').notNull(),

    /** Display name of the assigned agent — null when unassigned */
    assigneeName: text('assignee_name'),

    /** Display name of the reporter captured at creation time */
    reporterName: text('reporter_name').notNull(),

    /** No PHI in description — operational/technical content only */
    description: text('description').notNull(),

    /** Denormalized count kept in sync with ticket_messages rows */
    messageCount: integer('message_count').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tickets_tenant_status_idx').on(t.tenantId, t.status),
    index('tickets_tenant_created_idx').on(t.tenantId, t.createdAt),
  ],
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    authorName: text('author_name').notNull(),

    authorRole: ticketMessageAuthorRoleEnum('author_role').notNull().default('user'),

    /** No PHI in content — operational/technical content only */
    content: text('content').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ticket_messages_ticket_idx').on(t.ticketId)],
);
