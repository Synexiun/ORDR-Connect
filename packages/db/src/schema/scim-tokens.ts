import { pgTable, uuid, varchar, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// SCIM Bearer Tokens
//
// SECURITY: Token values are NEVER stored. Only the SHA-256 hash is persisted.
// Raw tokens are shown once at creation and cannot be retrieved.
// ---------------------------------------------------------------------------

export const scimTokens = pgTable(
  'scim_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** SHA-256 hash of the bearer token — NEVER store raw */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),

    description: varchar('description', { length: 255 }).notNull().default(''),

    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),

    expiresAt: timestamp('expires_at', { withTimezone: true }),

    directoryId: text('directory_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('scim_tokens_tenant_id_idx').on(table.tenantId),
    uniqueIndex('scim_tokens_hash_uniq').on(table.tokenHash),
  ],
);
