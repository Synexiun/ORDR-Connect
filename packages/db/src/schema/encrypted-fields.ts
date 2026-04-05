/**
 * encrypted_fields — per-tenant DEK envelope store
 *
 * Canonical home for wrapped Data Encryption Keys (DEKs). Field-level
 * encryption in the application writes DEK envelopes here and reads them
 * back for decryption. The bulk ciphertext lives in the domain table;
 * only the small DEK envelope lives here.
 *
 * SOC2 CC6.7 — Encryption at rest: two-tier key hierarchy.
 * Rule 1 — AES-256-GCM envelope encryption; keys rotated ≤90 days.
 */

import { pgTable, uuid, text, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';

export const encryptedFields = pgTable(
  'encrypted_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Tenant that owns this DEK envelope — Row-Level Security anchor */
    tenantId: uuid('tenant_id').notNull(),

    /** Domain object type, e.g. 'customer', 'message' */
    resource: text('resource').notNull(),

    /** UUID of the domain object */
    resourceId: uuid('resource_id').notNull(),

    /** Field name within the resource, e.g. 'phone', 'email' */
    fieldName: text('field_name').notNull(),

    /**
     * EncryptedEnvelope — { wrappedDek, dekIv, dekAuthTag, keyVersion,
     *                        ciphertext, iv, authTag, algorithm }
     * keyVersion is the Vault KV v2 version of the KEK used to wrap this DEK.
     */
    dekEnvelope: jsonb('dek_envelope').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('uq_encrypted_fields_resource_field').on(
      table.tenantId,
      table.resource,
      table.resourceId,
      table.fieldName,
    ),
    index('idx_encrypted_fields_tenant').on(table.tenantId),
  ],
);
