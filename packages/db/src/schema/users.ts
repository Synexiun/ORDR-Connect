import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum('user_role', [
  'super_admin',
  'tenant_admin',
  'manager',
  'agent',
  'viewer',
]);

export const userStatusEnum = pgEnum('user_status', [
  'active',
  'suspended',
  'deactivated',
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    email: varchar('email', { length: 255 }).notNull(),

    name: varchar('name', { length: 255 }).notNull(),

    /** Argon2id hash -- NEVER store plaintext passwords */
    passwordHash: text('password_hash').notNull(),

    role: userRoleEnum('role').notNull(),

    status: userStatusEnum('status').notNull().default('active'),

    mfaEnabled: boolean('mfa_enabled').notNull().default(false),

    /** ENCRYPTED at field-level -- contains TOTP secret */
    mfaSecret: text('mfa_secret'),

    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

    failedLoginAttempts: integer('failed_login_attempts').default(0),

    lockedUntil: timestamp('locked_until', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_tenant_email_uniq').on(table.tenantId, table.email),
    index('users_tenant_id_idx').on(table.tenantId),
  ],
);
