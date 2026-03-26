import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** SHA-256 of refresh token -- NEVER store the raw token */
    tokenHash: text('token_hash').notNull(),

    ipAddress: varchar('ip_address', { length: 45 }),

    userAgent: text('user_agent'),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /**
     * Updated on every authenticated request.
     * HIPAA requires idle-timeout logout after 15 minutes of inactivity.
     */
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),

    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sessions_tenant_id_idx').on(table.tenantId),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);
