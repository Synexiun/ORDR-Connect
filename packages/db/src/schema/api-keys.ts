import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** The user who created this API key */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 255 }).notNull(),

    /** SHA-256 of the full API key -- NEVER store the raw key */
    keyHash: text('key_hash').notNull(),

    /** First 8 characters of the key for identification (e.g. "ordr_k_a1b2c3d4") */
    keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),

    /** Scoped permissions: { "read": ["customers"], "write": ["interactions"] } */
    permissions: jsonb('permissions').notNull(),

    /** null = no expiry, but key rotation policy is enforced at app layer */
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),

    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('api_keys_tenant_id_idx').on(table.tenantId),
    index('api_keys_key_prefix_idx').on(table.keyPrefix),
  ],
);
