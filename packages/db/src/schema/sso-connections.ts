import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ssoConnectionTypeEnum = pgEnum('sso_connection_type', [
  'saml',
  'oidc',
]);

export const ssoConnectionStatusEnum = pgEnum('sso_connection_status', [
  'active',
  'inactive',
  'validating',
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const ssoConnections = pgTable(
  'sso_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: varchar('name', { length: 255 }).notNull(),

    type: ssoConnectionTypeEnum('type').notNull(),

    provider: varchar('provider', { length: 100 }).notNull(),

    /** External ID from WorkOS or the IdP */
    externalConnectionId: varchar('external_connection_id', { length: 255 }),

    status: ssoConnectionStatusEnum('status').notNull().default('validating'),

    /** When true, password login is DISABLED for this tenant */
    enforceSso: boolean('enforce_sso').notNull().default(false),

    metadata: jsonb('metadata').default('{}'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sso_connections_tenant_id_idx').on(table.tenantId),
    index('sso_connections_tenant_status_idx').on(table.tenantId, table.status),
    uniqueIndex('sso_connections_tenant_ext_id_uniq').on(
      table.tenantId,
      table.externalConnectionId,
    ),
  ],
);
