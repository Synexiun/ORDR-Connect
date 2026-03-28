import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const developerTierEnum = pgEnum('developer_tier', ['free', 'pro', 'enterprise']);

export const developerStatusEnum = pgEnum('developer_status', ['active', 'suspended', 'revoked']);

export const sandboxStatusEnum = pgEnum('sandbox_status', ['active', 'expired', 'destroyed']);

export const seedDataProfileEnum = pgEnum('seed_data_profile', [
  'minimal',
  'collections',
  'healthcare',
]);

// ---------------------------------------------------------------------------
// Developer Accounts
// ---------------------------------------------------------------------------

export const developerAccounts = pgTable(
  'developer_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    email: text('email').notNull(),

    displayName: text('display_name'),

    organization: text('organization'),

    /** Argon2id hash of the developer's password (Rule 2 — NO bcrypt, NO scrypt) */
    passwordHash: text('password_hash').notNull().default(''),

    /** SHA-256 hash of the full API key — NEVER store the raw key (Rule 2) */
    apiKeyHash: text('api_key_hash').notNull(),

    /** First 8 characters of the key for identification (e.g. "devk_a1b") */
    apiKeyPrefix: varchar('api_key_prefix', { length: 8 }).notNull(),

    tier: developerTierEnum('tier').notNull().default('free'),

    /** Rate limit in requests per minute */
    rateLimitRpm: integer('rate_limit_rpm').notNull().default(60),

    /** Sandbox tenant ID — null if no sandbox provisioned */
    sandboxTenantId: text('sandbox_tenant_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),

    status: developerStatusEnum('status').notNull().default('active'),
  },
  (table) => [
    uniqueIndex('developer_accounts_email_uniq').on(table.email),
    index('developer_accounts_api_key_prefix_idx').on(table.apiKeyPrefix),
    index('developer_accounts_status_idx').on(table.status),
  ],
);

// ---------------------------------------------------------------------------
// Developer API Keys — named, revocable keys per developer account
// ---------------------------------------------------------------------------

export const developerApiKeys = pgTable(
  'developer_api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** FK to developer_accounts */
    developerId: uuid('developer_id')
      .notNull()
      .references(() => developerAccounts.id, { onDelete: 'cascade' }),

    /** Human-readable key name */
    name: text('name').notNull(),

    /** SHA-256 hash of the raw key — NEVER store raw (Rule 2) */
    keyHash: text('key_hash').notNull(),

    /** First 8 characters for UI identification */
    keyPrefix: varchar('key_prefix', { length: 8 }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Null means the key never expires */
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    /** Set when revoked — null means still active */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('developer_api_keys_developer_id_idx').on(table.developerId),
    index('developer_api_keys_key_prefix_idx').on(table.keyPrefix),
  ],
);

// ---------------------------------------------------------------------------
// Developer Usage Tracking
// ---------------------------------------------------------------------------

export const developerUsage = pgTable(
  'developer_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    developerId: uuid('developer_id')
      .notNull()
      .references(() => developerAccounts.id, { onDelete: 'cascade' }),

    endpoint: text('endpoint').notNull(),

    method: text('method').notNull(),

    statusCode: integer('status_code').notNull(),

    latencyMs: integer('latency_ms').notNull(),

    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('developer_usage_developer_id_idx').on(table.developerId),
    index('developer_usage_timestamp_idx').on(table.timestamp),
  ],
);

// ---------------------------------------------------------------------------
// Sandbox Tenants
// ---------------------------------------------------------------------------

export const sandboxTenants = pgTable(
  'sandbox_tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    developerId: uuid('developer_id')
      .notNull()
      .references(() => developerAccounts.id, { onDelete: 'cascade' }),

    tenantId: text('tenant_id').notNull(),

    /** Human-readable sandbox name */
    name: text('name').notNull().default(''),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    status: sandboxStatusEnum('status').notNull().default('active'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    seedDataProfile: seedDataProfileEnum('seed_data_profile').notNull().default('minimal'),
  },
  (table) => [
    uniqueIndex('sandbox_tenants_tenant_id_uniq').on(table.tenantId),
    index('sandbox_tenants_developer_id_idx').on(table.developerId),
    index('sandbox_tenants_status_idx').on(table.status),
  ],
);
