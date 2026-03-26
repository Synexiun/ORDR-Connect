/**
 * Marketplace schema — Agent Marketplace tables for ORDR-Connect
 *
 * SOC2 CC6.1 — Access control: tenant-scoped installs, role-gated publishing.
 * ISO 27001 A.14.2.1 — Secure development: agents reviewed before publishing.
 * HIPAA §164.312(a)(1) — Access control: marketplace installs are tenant-isolated.
 *
 * Tables:
 * - marketplace_agents — published agent listings with review status
 * - marketplace_reviews — user reviews and ratings
 * - marketplace_installs — tenant-scoped agent installations
 *
 * SECURITY:
 * - manifest stored as JSONB for structured validation at query time
 * - package_hash is SHA-256 of the agent package content (tamper detection)
 * - status enum gates publishing — only 'published' agents are publicly listed
 * - publisher_id FK enforces ownership chain
 * - tenant_id on installs enforces tenant isolation
 */

import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  real,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { developerAccounts } from './developer.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const marketplaceAgentStatusEnum = pgEnum('marketplace_agent_status', [
  'draft',
  'review',
  'published',
  'suspended',
  'rejected',
]);

export const marketplaceInstallStatusEnum = pgEnum('marketplace_install_status', [
  'active',
  'disabled',
  'uninstalled',
]);

// ---------------------------------------------------------------------------
// Marketplace Agents — published agent listings
// ---------------------------------------------------------------------------

export const marketplaceAgents = pgTable(
  'marketplace_agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Agent name — must be unique per version */
    name: varchar('name', { length: 255 }).notNull(),

    /** Semver version string */
    version: varchar('version', { length: 64 }).notNull(),

    /** Short description of the agent */
    description: text('description').notNull(),

    /** Author display name */
    author: varchar('author', { length: 255 }).notNull(),

    /** OSI-approved license identifier */
    license: varchar('license', { length: 64 }).notNull(),

    /** Full agent manifest — validated JSONB */
    manifest: jsonb('manifest').notNull(),

    /** SHA-256 hash of the packaged agent content */
    packageHash: varchar('package_hash', { length: 64 }).notNull(),

    /** Total download/install count */
    downloads: integer('downloads').notNull().default(0),

    /** Average rating (1.0–5.0) */
    rating: real('rating').default(0),

    /** Publishing lifecycle status */
    status: marketplaceAgentStatusEnum('status').notNull().default('draft'),

    /** FK to developer_accounts — who published this agent */
    publisherId: uuid('publisher_id')
      .notNull()
      .references(() => developerAccounts.id, { onDelete: 'restrict' }),

    /** Admin rejection reason (null unless status = rejected) */
    rejectionReason: text('rejection_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('marketplace_agents_name_version_uniq').on(table.name, table.version),
    index('marketplace_agents_status_idx').on(table.status),
    index('marketplace_agents_publisher_id_idx').on(table.publisherId),
    index('marketplace_agents_name_idx').on(table.name),
    index('marketplace_agents_rating_idx').on(table.rating),
  ],
);

// ---------------------------------------------------------------------------
// Marketplace Reviews — user reviews and ratings
// ---------------------------------------------------------------------------

export const marketplaceReviews = pgTable(
  'marketplace_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** FK to marketplace_agents */
    agentId: uuid('agent_id')
      .notNull()
      .references(() => marketplaceAgents.id, { onDelete: 'cascade' }),

    /** ID of the user leaving the review */
    reviewerId: uuid('reviewer_id').notNull(),

    /** Rating 1–5 */
    rating: integer('rating').notNull(),

    /** Review comment */
    comment: text('comment'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('marketplace_reviews_agent_id_idx').on(table.agentId),
    index('marketplace_reviews_reviewer_id_idx').on(table.reviewerId),
    uniqueIndex('marketplace_reviews_agent_reviewer_uniq').on(table.agentId, table.reviewerId),
  ],
);

// ---------------------------------------------------------------------------
// Marketplace Installs — tenant-scoped agent installations
// ---------------------------------------------------------------------------

export const marketplaceInstalls = pgTable(
  'marketplace_installs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Tenant that installed the agent */
    tenantId: uuid('tenant_id').notNull(),

    /** FK to marketplace_agents */
    agentId: uuid('agent_id')
      .notNull()
      .references(() => marketplaceAgents.id, { onDelete: 'restrict' }),

    /** Installed version (snapshot at install time) */
    version: varchar('version', { length: 64 }).notNull(),

    /** Installation lifecycle status */
    status: marketplaceInstallStatusEnum('status').notNull().default('active'),

    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('marketplace_installs_tenant_agent_uniq').on(table.tenantId, table.agentId),
    index('marketplace_installs_tenant_id_idx').on(table.tenantId),
    index('marketplace_installs_agent_id_idx').on(table.agentId),
    index('marketplace_installs_status_idx').on(table.status),
  ],
);
