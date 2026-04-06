import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// WorkOS Webhook Events (idempotency log)
// ---------------------------------------------------------------------------

export const workosEvents = pgTable('workos_events', {
  id: uuid('id').primaryKey().defaultRandom(),

  workosId: text('workos_id').notNull().unique(),

  eventType: text('event_type').notNull(),

  directoryId: text('directory_id'),

  payload: jsonb('payload').notNull(),

  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
