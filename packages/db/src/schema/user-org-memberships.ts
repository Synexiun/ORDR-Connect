import { pgTable, uuid, text, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// User <-> Organization Memberships (Phase 129)
// ---------------------------------------------------------------------------
//
// SOC 2 CC6.1 / CC6.3, ISO 27001 A.5.2 / A.5.15, HIPAA §164.312(a)(1):
// org-scoped access control with tenant isolation enforced via RLS.
// ---------------------------------------------------------------------------

export const userOrganizationMemberships = pgTable(
  'user_organization_memberships',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),

    addedBy: text('added_by').notNull().default('system'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.orgId, t.userId] }),
    index('user_org_memberships_user_idx').on(t.tenantId, t.userId),
    index('user_org_memberships_org_idx').on(t.tenantId, t.orgId),
  ],
);
