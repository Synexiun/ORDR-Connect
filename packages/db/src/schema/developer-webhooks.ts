/**
 * packages/db/src/schema/developer-webhooks.ts
 *
 * developer_webhooks — per-developer webhook registrations
 *
 * SOC2 CC6.1 — developer-scoped, never cross-tenant.
 * Rule 1 — HMAC secret stored AES-256-GCM encrypted, never plaintext.
 * Rule 3 — mutations audited externally (route-level).
 */

import { pgTable, uuid, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { developerAccounts } from './developer.js';

export const developerWebhooks = pgTable(
  'developer_webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** FK to developer_accounts — ON DELETE CASCADE cleans up on account removal */
    developerId: uuid('developer_id')
      .notNull()
      .references(() => developerAccounts.id, { onDelete: 'cascade' }),

    /** Webhook target URL — https:// only, SSRF-validated at route layer */
    url: text('url').notNull(),

    /** Subscribed event type strings — validated against DELIVERABLE_EVENTS */
    events: text('events').array().notNull().default([]),

    /** AES-256-GCM ciphertext of 32-byte random HMAC secret — plaintext NEVER stored */
    hmacSecretEncrypted: text('hmac_secret_encrypted').notNull(),

    /** Whether this webhook is currently active */
    active: boolean('active').notNull().default(true),

    /** Set when the webhook last received a delivery (future phase) */
    lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Auto-updated on every mutation via .$onUpdate() */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_developer_webhooks_developer_id').on(table.developerId),
    index('idx_developer_webhooks_active').on(table.active),
  ],
);
