/**
 * White-Label Configuration Schema — per-tenant branding and custom domains
 *
 * SOC2 CC6.1 — Access control: tenant-scoped, unique constraint on tenant_id.
 * ISO 27001 A.14.1.2 — Securing application services on public networks.
 * HIPAA §164.312(e)(1) — Transmission security for custom domains.
 *
 * Each tenant can customize branding (logo, colors, footer) and optionally
 * register a custom domain for their white-labeled instance.
 *
 * SECURITY:
 * - tenant_id is unique — one config per tenant
 * - custom_domain is nullable + unique — no domain collisions
 * - No PHI/PII stored in this table
 * - custom_css is sanitized before render (application layer)
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const whiteLabelConfigs = pgTable(
  'white_label_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: text('tenant_id')
      .notNull()
      .unique(),

    /** Custom domain for white-labeled access (e.g., app.clientbrand.com) */
    customDomain: text('custom_domain'),

    /** URL to tenant's custom logo */
    logoUrl: text('logo_url'),

    /** URL to tenant's custom favicon */
    faviconUrl: text('favicon_url'),

    /** Primary brand color (hex) */
    primaryColor: text('primary_color').notNull().default('#3b82f6'),

    /** Accent brand color (hex) */
    accentColor: text('accent_color').notNull().default('#10b981'),

    /** Background color (hex) */
    bgColor: text('bg_color').notNull().default('#0f172a'),

    /** Text color (hex) */
    textColor: text('text_color').notNull().default('#e2e8f0'),

    /** Custom "from" name for outbound emails */
    emailFromName: text('email_from_name'),

    /** Custom "from" address for outbound emails */
    emailFromAddress: text('email_from_address'),

    /** Custom CSS overrides (sanitized at application layer before injection) */
    customCss: text('custom_css'),

    /** Custom footer text for emails and dashboard */
    footerText: text('footer_text'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('white_label_configs_custom_domain_uniq')
      .on(table.customDomain),
  ],
);
