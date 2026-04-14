import { pgTable, uuid, text, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
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

    /**
     * Refresh token family UUID — all rotations of a single login share the same
     * family. Reuse of a revoked token revokes the whole family (anti-session-fixation).
     */
    tokenFamily: uuid('token_family').notNull(),

    /**
     * User role at session creation — stored so refreshSession() can reconstruct
     * the access token without a round-trip users JOIN (avoids TOCTOU race).
     */
    role: varchar('role', { length: 50 }).notNull().default('agent'),

    /**
     * User permissions at session creation — stored alongside role so the
     * SessionManager can re-issue tokens without a permissions DB lookup.
     */
    permissions: jsonb('permissions').notNull().default([]),

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
    index('sessions_token_family_idx').on(table.tokenFamily),
  ],
);
