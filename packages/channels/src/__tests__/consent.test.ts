import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsentManager, OPT_OUT_KEYWORDS, OPT_IN_KEYWORDS } from '../consent.js';
import type { ConsentStore, ConsentRecord, Channel } from '../types.js';
import { CONSENT_STATUSES } from '../types.js';

// ─── Mock Store ──────────────────────────────────────────────────

function createMockStore(initialRecords?: Map<string, ConsentRecord>): ConsentStore {
  const records = initialRecords ?? new Map<string, ConsentRecord>();

  return {
    getConsent: vi.fn(async (customerId: string, channel: Channel) => {
      return records.get(`${customerId}:${channel}`);
    }),
    saveConsent: vi.fn(async (record: ConsentRecord) => {
      records.set(`${record.customerId}:${record.channel}`, record);
    }),
    revokeConsent: vi.fn(async (customerId: string, channel: Channel, _revokedAt: Date) => {
      const existing = records.get(`${customerId}:${channel}`);
      if (existing) {
        records.set(`${customerId}:${channel}`, {
          ...existing,
          status: CONSENT_STATUSES.REVOKED,
        });
      }
    }),
  };
}

function makeConsentRecord(overrides?: Partial<ConsentRecord>): ConsentRecord {
  return {
    customerId: 'cust_123',
    tenantId: 'tenant_abc',
    channel: 'sms' as Channel,
    status: CONSENT_STATUSES.OPTED_IN,
    consentedAt: new Date(),
    method: 'web_form',
    evidenceRef: 'form_submission_456',
    ...overrides,
  };
}

// ─── Setup ───────────────────────────────────────────────────────

let manager: ConsentManager;

beforeEach(() => {
  manager = new ConsentManager();
});

// ─── checkConsent ────────────────────────────────────────────────

describe('ConsentManager — checkConsent', () => {
  it('returns "unknown" when no record exists', async () => {
    const store = createMockStore();
    const status = await manager.checkConsent('cust_999', 'sms', store);
    expect(status).toBe(CONSENT_STATUSES.UNKNOWN);
  });

  it('returns "opted_in" when customer has opted in', async () => {
    const records = new Map<string, ConsentRecord>();
    records.set('cust_123:sms', makeConsentRecord());
    const store = createMockStore(records);

    const status = await manager.checkConsent('cust_123', 'sms', store);
    expect(status).toBe(CONSENT_STATUSES.OPTED_IN);
  });

  it('returns "opted_out" when customer has opted out', async () => {
    const records = new Map<string, ConsentRecord>();
    records.set(
      'cust_123:sms',
      makeConsentRecord({ status: CONSENT_STATUSES.OPTED_OUT }),
    );
    const store = createMockStore(records);

    const status = await manager.checkConsent('cust_123', 'sms', store);
    expect(status).toBe(CONSENT_STATUSES.OPTED_OUT);
  });

  it('returns channel-specific consent (sms opted_in, email unknown)', async () => {
    const records = new Map<string, ConsentRecord>();
    records.set('cust_123:sms', makeConsentRecord());
    const store = createMockStore(records);

    expect(await manager.checkConsent('cust_123', 'sms', store)).toBe(CONSENT_STATUSES.OPTED_IN);
    expect(await manager.checkConsent('cust_123', 'email', store)).toBe(CONSENT_STATUSES.UNKNOWN);
  });
});

// ─── verifyConsentForSend ────────────────────────────────────────

describe('ConsentManager — verifyConsentForSend (TCPA gate)', () => {
  it('returns ok(true) when customer is opted in', async () => {
    const records = new Map<string, ConsentRecord>();
    records.set('cust_123:sms', makeConsentRecord());
    const store = createMockStore(records);

    const result = await manager.verifyConsentForSend('cust_123', 'sms', store);
    expect(result.success).toBe(true);
  });

  it('returns ComplianceViolationError when not opted in', async () => {
    const store = createMockStore();
    const result = await manager.verifyConsentForSend('cust_123', 'sms', store);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('COMPLIANCE_VIOLATION');
      expect(result.error.message).toContain('TCPA');
    }
  });

  it('returns ComplianceViolationError for opted_out customer', async () => {
    const records = new Map<string, ConsentRecord>();
    records.set(
      'cust_123:sms',
      makeConsentRecord({ status: CONSENT_STATUSES.OPTED_OUT }),
    );
    const store = createMockStore(records);

    const result = await manager.verifyConsentForSend('cust_123', 'sms', store);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('opted in');
    }
  });

  it('returns CAN-SPAM regulation for email channel', async () => {
    const store = createMockStore();
    const result = await manager.verifyConsentForSend('cust_123', 'email', store);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('CAN-SPAM');
    }
  });

  it('returns ComplianceViolationError for revoked consent', async () => {
    const records = new Map<string, ConsentRecord>();
    records.set(
      'cust_123:sms',
      makeConsentRecord({ status: CONSENT_STATUSES.REVOKED }),
    );
    const store = createMockStore(records);

    const result = await manager.verifyConsentForSend('cust_123', 'sms', store);
    expect(result.success).toBe(false);
  });
});

// ─── recordConsent ───────────────────────────────────────────────

describe('ConsentManager — recordConsent', () => {
  it('saves a valid consent record', async () => {
    const store = createMockStore();
    const record = makeConsentRecord();

    const result = await manager.recordConsent(record, store);
    expect(result.success).toBe(true);
    expect(store.saveConsent).toHaveBeenCalledWith(record);
  });

  it('rejects record with missing customerId', async () => {
    const store = createMockStore();
    const record = makeConsentRecord({ customerId: '' });

    const result = await manager.recordConsent(record, store);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects record with missing evidenceRef', async () => {
    const store = createMockStore();
    const record = makeConsentRecord({ evidenceRef: '' });

    const result = await manager.recordConsent(record, store);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects record with missing tenantId', async () => {
    const store = createMockStore();
    const record = makeConsentRecord({ tenantId: '' });

    const result = await manager.recordConsent(record, store);
    expect(result.success).toBe(false);
  });
});

// ─── revokeConsent ───────────────────────────────────────────────

describe('ConsentManager — revokeConsent', () => {
  it('revokes consent for a customer', async () => {
    const store = createMockStore();
    const result = await manager.revokeConsent('cust_123', 'sms', store);
    expect(result.success).toBe(true);
    expect(store.revokeConsent).toHaveBeenCalledWith('cust_123', 'sms', expect.any(Date));
  });

  it('rejects revocation with empty customerId', async () => {
    const store = createMockStore();
    const result = await manager.revokeConsent('', 'sms', store);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });
});

// ─── isOptOutKeyword ─────────────────────────────────────────────

describe('ConsentManager — isOptOutKeyword', () => {
  it('detects STOP as opt-out', () => {
    expect(manager.isOptOutKeyword('STOP')).toBe(true);
  });

  it('detects stop (case insensitive)', () => {
    expect(manager.isOptOutKeyword('stop')).toBe(true);
  });

  it('detects UNSUBSCRIBE as opt-out', () => {
    expect(manager.isOptOutKeyword('UNSUBSCRIBE')).toBe(true);
  });

  it('detects CANCEL as opt-out', () => {
    expect(manager.isOptOutKeyword('CANCEL')).toBe(true);
  });

  it('detects QUIT as opt-out', () => {
    expect(manager.isOptOutKeyword('QUIT')).toBe(true);
  });

  it('detects END as opt-out', () => {
    expect(manager.isOptOutKeyword('END')).toBe(true);
  });

  it('detects OPT OUT (with space) as opt-out', () => {
    expect(manager.isOptOutKeyword('OPT OUT')).toBe(true);
  });

  it('trims whitespace before checking', () => {
    expect(manager.isOptOutKeyword('  STOP  ')).toBe(true);
  });

  it('returns false for non-opt-out text', () => {
    expect(manager.isOptOutKeyword('Hello')).toBe(false);
    expect(manager.isOptOutKeyword('YES')).toBe(false);
    expect(manager.isOptOutKeyword('I want to stop by later')).toBe(false);
  });

  it('covers all OPT_OUT_KEYWORDS', () => {
    for (const keyword of OPT_OUT_KEYWORDS) {
      expect(manager.isOptOutKeyword(keyword)).toBe(true);
    }
  });
});

// ─── isOptInKeyword ──────────────────────────────────────────────

describe('ConsentManager — isOptInKeyword', () => {
  it('detects START as opt-in', () => {
    expect(manager.isOptInKeyword('START')).toBe(true);
  });

  it('detects YES as opt-in', () => {
    expect(manager.isOptInKeyword('YES')).toBe(true);
  });

  it('returns false for opt-out keywords', () => {
    expect(manager.isOptInKeyword('STOP')).toBe(false);
  });

  it('covers all OPT_IN_KEYWORDS', () => {
    for (const keyword of OPT_IN_KEYWORDS) {
      expect(manager.isOptInKeyword(keyword)).toBe(true);
    }
  });
});

// ─── buildOptOutRecord ───────────────────────────────────────────

describe('ConsentManager — buildOptOutRecord', () => {
  it('builds a valid opt-out record', () => {
    const record = manager.buildOptOutRecord('cust_123', 'tenant_abc', 'sms', 'msg_sid_789');
    expect(record.customerId).toBe('cust_123');
    expect(record.tenantId).toBe('tenant_abc');
    expect(record.channel).toBe('sms');
    expect(record.status).toBe(CONSENT_STATUSES.OPTED_OUT);
    expect(record.method).toBe('sms_keyword');
    expect(record.evidenceRef).toBe('msg_sid_789');
    expect(record.consentedAt).toBeInstanceOf(Date);
  });
});
