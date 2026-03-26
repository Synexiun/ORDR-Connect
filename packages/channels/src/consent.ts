/**
 * Consent management — TCPA/CAN-SPAM compliance for ORDR-Connect
 *
 * TCPA RULE: Consent MUST be verified before EVERY outbound SMS.
 * No exceptions. Failure to check consent is a compliance violation.
 *
 * CAN-SPAM: All marketing emails require unsubscribe mechanism.
 * Opt-out requests must be honored within 10 business days (we honor immediately).
 *
 * COMPLIANCE: All consent changes are recorded with evidence references
 * for audit trail. Consent revocation is immediate and irreversible
 * without explicit re-consent.
 */

import {
  type Result,
  ok,
  err,
  ComplianceViolationError,
  ValidationError,
} from '@ordr/core';

import type {
  Channel,
  ConsentStatus,
  ConsentRecord,
  ConsentStore,
  ConsentMethod,
} from './types.js';
import { CONSENT_STATUSES } from './types.js';

// ─── Opt-Out Keywords ────────────────────────────────────────────

/**
 * Industry-standard opt-out keywords per CTIA Short Code Monitoring guidelines.
 * All comparisons are case-insensitive.
 */
export const OPT_OUT_KEYWORDS = [
  'STOP',
  'UNSUBSCRIBE',
  'CANCEL',
  'QUIT',
  'END',
  'STOPALL',
  'STOP ALL',
  'OPT OUT',
  'OPTOUT',
  'OPT-OUT',
  'REMOVE',
] as const;

/**
 * Opt-in keywords for double opt-in flows.
 */
export const OPT_IN_KEYWORDS = [
  'START',
  'YES',
  'SUBSCRIBE',
  'OPTIN',
  'OPT IN',
  'OPT-IN',
  'UNSTOP',
] as const;

// ─── Consent Manager ─────────────────────────────────────────────

export class ConsentManager {
  /**
   * Check consent status for a customer on a given channel.
   * Returns the current consent status from the store.
   * If no consent record exists, returns 'unknown'.
   */
  async checkConsent(
    customerId: string,
    channel: Channel,
    store: ConsentStore,
  ): Promise<ConsentStatus> {
    const record = await store.getConsent(customerId, channel);

    if (record === undefined) {
      return CONSENT_STATUSES.UNKNOWN;
    }

    return record.status;
  }

  /**
   * Verify that a customer has opted in before sending on a given channel.
   * This is the TCPA gate — returns Result to enforce checking.
   *
   * TCPA: MUST be called before EVERY outbound SMS. No exceptions.
   */
  async verifyConsentForSend(
    customerId: string,
    channel: Channel,
    store: ConsentStore,
  ): Promise<Result<true, ComplianceViolationError>> {
    const status = await this.checkConsent(customerId, channel, store);

    if (status === CONSENT_STATUSES.OPTED_IN) {
      return ok(true as const);
    }

    const regulation = channel === 'sms' ? 'TCPA' : 'CAN-SPAM';
    return err(
      new ComplianceViolationError(
        `Customer has not opted in for ${channel} communication (status: ${status}). ${regulation} requires explicit consent.`,
        regulation,
      ),
    );
  }

  /**
   * Record a new consent decision. Validates required fields.
   */
  async recordConsent(
    record: ConsentRecord,
    store: ConsentStore,
  ): Promise<Result<void, ValidationError>> {
    const validationError = this.validateConsentRecord(record);
    if (validationError !== undefined) {
      return err(validationError);
    }

    await store.saveConsent(record);
    return ok(undefined);
  }

  /**
   * Revoke consent — immediate and absolute.
   * Creates an opt-out record that supersedes any prior opt-in.
   */
  async revokeConsent(
    customerId: string,
    channel: Channel,
    store: ConsentStore,
  ): Promise<Result<void, ValidationError>> {
    if (!customerId || customerId.trim().length === 0) {
      return err(
        new ValidationError('Customer ID is required for consent revocation', {
          customerId: ['Required'],
        }),
      );
    }

    await store.revokeConsent(customerId, channel, new Date());
    return ok(undefined);
  }

  /**
   * Check if an inbound message body contains an opt-out keyword.
   * Comparison is case-insensitive and trims whitespace.
   */
  isOptOutKeyword(message: string): boolean {
    const normalized = message.trim().toUpperCase();
    return OPT_OUT_KEYWORDS.some((keyword) => normalized === keyword);
  }

  /**
   * Check if an inbound message body contains an opt-in keyword.
   */
  isOptInKeyword(message: string): boolean {
    const normalized = message.trim().toUpperCase();
    return OPT_IN_KEYWORDS.some((keyword) => normalized === keyword);
  }

  /**
   * Build a consent record for opt-out via SMS keyword.
   */
  buildOptOutRecord(
    customerId: string,
    tenantId: string,
    channel: Channel,
    evidenceRef: string,
  ): ConsentRecord {
    return {
      customerId,
      tenantId,
      channel,
      status: CONSENT_STATUSES.OPTED_OUT,
      consentedAt: new Date(),
      method: 'sms_keyword' as ConsentMethod,
      evidenceRef,
    };
  }

  // ─── Private ─────────────────────────────────────────────────

  private validateConsentRecord(record: ConsentRecord): ValidationError | undefined {
    const fieldErrors: Record<string, string[]> = {};

    if (!record.customerId || record.customerId.trim().length === 0) {
      fieldErrors['customerId'] = ['Customer ID is required'];
    }

    if (!record.tenantId || record.tenantId.trim().length === 0) {
      fieldErrors['tenantId'] = ['Tenant ID is required'];
    }

    if (!record.channel) {
      fieldErrors['channel'] = ['Channel is required'];
    }

    if (!record.status) {
      fieldErrors['status'] = ['Consent status is required'];
    }

    if (!record.evidenceRef || record.evidenceRef.trim().length === 0) {
      fieldErrors['evidenceRef'] = ['Evidence reference is required for audit compliance'];
    }

    if (Object.keys(fieldErrors).length > 0) {
      return new ValidationError('Invalid consent record', fieldErrors);
    }

    return undefined;
  }
}
