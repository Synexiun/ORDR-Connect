/**
 * DrizzleConsentStore — PostgreSQL-backed consent persistence (WORM).
 *
 * Implements the ConsentStore interface from @ordr/channels using Drizzle ORM.
 * Consent records are append-only (WORM) with SHA-256 content hashes for
 * integrity verification — no UPDATE or DELETE operations are issued.
 *
 * SOC2 CC6.1 — Tenant-scoped consent management.
 * HIPAA §164.530 — Consent record retention.
 * GDPR Art.7 — Conditions for consent; proof of consent.
 *
 * SECURITY:
 * - customer_id is a UUID FK to the tenant-scoped customers table — cross-tenant
 *   collision is impossible because UUIDs are globally unique.
 * - Records are WORM: only INSERT, never UPDATE or DELETE.
 * - contentHash provides tamper detection on each record.
 */

import { eq, and, desc } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import * as schema from '@ordr/db';
import { sha256 } from '@ordr/crypto';
import type { ConsentStore, ConsentRecord, Channel } from './types.js';

// ─── DrizzleConsentStore ─────────────────────────────────────────────────────

export class DrizzleConsentStore implements ConsentStore {
  constructor(private readonly db: OrdrDatabase) {}

  async getConsent(customerId: string, channel: Channel): Promise<ConsentRecord | undefined> {
    // Get the latest consent record for this customer+channel.
    // customerId is a UUID FK → globally unique → tenant isolation implicit.
    const rows = await this.db
      .select()
      .from(schema.consentRecords)
      .where(
        and(
          eq(schema.consentRecords.customerId, customerId),
          eq(schema.consentRecords.channel, channel),
        ),
      )
      .orderBy(desc(schema.consentRecords.recordedAt))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return undefined;

    return {
      customerId: row.customerId,
      tenantId: row.tenantId,
      channel: row.channel as Channel,
      status: row.newStatus as ConsentRecord['status'],
      consentedAt: row.recordedAt,
      method: row.method as ConsentRecord['method'],
      evidenceRef: row.evidenceRef ?? '',
    };
  }

  async saveConsent(record: ConsentRecord): Promise<void> {
    // Look up the contact for this customer+channel to get contactId (required FK).
    const contact = await this.findContact(record.customerId, record.channel);
    if (!contact) {
      throw new Error(
        `No contact found for customer=${record.customerId} channel=${record.channel}`,
      );
    }

    // Determine the previous status from the contact's current consentStatus.
    const previousStatus = contact.consentStatus;

    // Compute integrity hash (WORM tamper detection).
    const hashPayload = JSON.stringify({
      tenantId: record.tenantId,
      customerId: record.customerId,
      contactId: contact.id,
      channel: record.channel,
      action: 'opt_in',
      method: record.method,
      previousStatus,
      newStatus: record.status,
      recordedAt: record.consentedAt.toISOString(),
    });
    const contentHash = sha256(hashPayload);

    // Insert the WORM consent record.
    await this.db.insert(schema.consentRecords).values({
      tenantId: record.tenantId,
      customerId: record.customerId,
      contactId: contact.id,
      channel: record.channel,
      action: 'opt_in',
      method: record.method as 'sms_keyword' | 'web_form' | 'verbal' | 'written' | 'api',
      evidenceRef: record.evidenceRef || null,
      previousStatus: previousStatus as 'opted_in' | 'opted_out' | 'unknown' | 'revoked',
      newStatus: record.status as 'opted_in' | 'opted_out' | 'unknown' | 'revoked',
      recordedAt: record.consentedAt,
      contentHash,
    });

    // Update the contact's current consent status for fast lookups.
    await this.db
      .update(schema.contacts)
      .set({
        consentStatus: record.status as 'opted_in' | 'opted_out' | 'unknown' | 'revoked',
        consentUpdatedAt: record.consentedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.contacts.id, contact.id));
  }

  async revokeConsent(customerId: string, channel: Channel, revokedAt: Date): Promise<void> {
    const contact = await this.findContact(customerId, channel);
    if (!contact) return; // No contact = no consent to revoke

    const previousStatus = contact.consentStatus;

    // Derive tenantId from the contact's tenant scope.
    const tenantId = contact.tenantId;

    const hashPayload = JSON.stringify({
      tenantId,
      customerId,
      contactId: contact.id,
      channel,
      action: 'revoke',
      method: 'api',
      previousStatus,
      newStatus: 'revoked',
      recordedAt: revokedAt.toISOString(),
    });
    const contentHash = sha256(hashPayload);

    // Insert WORM revocation record.
    await this.db.insert(schema.consentRecords).values({
      tenantId,
      customerId,
      contactId: contact.id,
      channel,
      action: 'revoke',
      method: 'api',
      previousStatus: previousStatus as 'opted_in' | 'opted_out' | 'unknown' | 'revoked',
      newStatus: 'revoked',
      recordedAt: revokedAt,
      contentHash,
    });

    // Update contact's consent status.
    await this.db
      .update(schema.contacts)
      .set({
        consentStatus: 'revoked',
        consentUpdatedAt: revokedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.contacts.id, contact.id));
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async findContact(
    customerId: string,
    channel: Channel,
  ): Promise<{ id: string; tenantId: string; consentStatus: string } | undefined> {
    const rows = await this.db
      .select({
        id: schema.contacts.id,
        tenantId: schema.contacts.tenantId,
        consentStatus: schema.contacts.consentStatus,
      })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.customerId, customerId), eq(schema.contacts.channel, channel)))
      .limit(1);
    return rows[0];
  }
}
