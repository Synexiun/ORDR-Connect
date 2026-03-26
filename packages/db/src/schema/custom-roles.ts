import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// Custom Roles Table
// ---------------------------------------------------------------------------

export const customRoles = pgTable(
  'custom_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: varchar('name', { length: 100 }).notNull(),

    description: text('description').notNull().default(''),

    /** Built-in role this custom role extends */
    baseRole: varchar('base_role', { length: 50 }).notNull(),

    /** Array of Permission objects: [{ resource, action, scope }] */
    permissions: jsonb('permissions').notNull().default('[]'),

    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('custom_roles_tenant_name_uniq').on(table.tenantId, table.name),
    index('custom_roles_tenant_id_idx').on(table.tenantId),
  ],
);

// ---------------------------------------------------------------------------
// User ↔ Custom Role Junction Table
// ---------------------------------------------------------------------------

export const userCustomRoles = pgTable(
  'user_custom_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    roleId: uuid('role_id')
      .notNull()
      .references(() => customRoles.id, { onDelete: 'cascade' }),

    assignedBy: uuid('assigned_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_custom_roles_tenant_user_role_uniq').on(
      table.tenantId,
      table.userId,
      table.roleId,
    ),
    index('user_custom_roles_tenant_id_idx').on(table.tenantId),
    index('user_custom_roles_user_id_idx').on(table.userId),
  ],
);
