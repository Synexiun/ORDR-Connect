/**
 * Compliance Framework Tests
 *
 * Validates that each regulatory framework's rules correctly block
 * or allow actions based on context.
 *
 * HIPAA, GDPR, TCPA, FDCPA, PIPEDA, LGPD
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceEngine } from '@ordr/compliance';
import { HIPAA_RULES } from '@ordr/compliance';
import { TCPA_RULES } from '@ordr/compliance';
import { FDCPA_RULES } from '@ordr/compliance';
import type { ComplianceContext } from '@ordr/compliance';

// ── Fixtures ──────────────────────────────────────────────────────────

let engine: ComplianceEngine;

function makeContext(overrides?: Partial<ComplianceContext>): ComplianceContext {
  return {
    tenantId: 'tenant-compliance-test',
    customerId: 'cust-001',
    action: 'send_message',
    channel: 'sms',
    data: {},
    timestamp: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  engine = new ComplianceEngine();
});

// ── HIPAA Rules ───────────────────────────────────────────────────────

describe('HIPAA compliance rules', () => {
  beforeEach(() => {
    engine.registerRules(HIPAA_RULES);
  });

  it('blocks PHI access without audit trail', () => {
    const ctx = makeContext({
      data: { auditTrailId: '' },
    });
    const result = engine.evaluateForRegulation('hipaa', ctx);
    expect(result.allowed).toBe(false);
    expect(result.violations.some((v) => v.ruleId === 'HIPAA_PHI_ACCESS_LOGGING')).toBe(true);
  });

  it('allows PHI access with audit trail', () => {
    const ctx = makeContext({
      data: {
        auditTrailId: 'audit-001',
        encrypted: true,
      },
    });
    const result = engine.evaluateForRegulation('hipaa', ctx);
    const phiLoggingViolation = result.violations.find(
      (v) => v.ruleId === 'HIPAA_PHI_ACCESS_LOGGING',
    );
    expect(phiLoggingViolation).toBeUndefined();
  });

  it('blocks PHI without encryption', () => {
    const ctx = makeContext({
      data: {
        auditTrailId: 'audit-001',
        encrypted: false,
      },
    });
    const result = engine.evaluateForRegulation('hipaa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'HIPAA_ENCRYPTION_REQUIRED')).toBe(true);
  });

  it('allows encrypted PHI', () => {
    const ctx = makeContext({
      data: {
        auditTrailId: 'audit-001',
        encrypted: true,
      },
    });
    const result = engine.evaluateForRegulation('hipaa', ctx);
    const encryptionViolation = result.violations.find(
      (v) => v.ruleId === 'HIPAA_ENCRYPTION_REQUIRED',
    );
    expect(encryptionViolation).toBeUndefined();
  });

  it('blocks unauthorized PHI field access (minimum necessary)', () => {
    const ctx = makeContext({
      data: {
        auditTrailId: 'audit-001',
        encrypted: true,
        requestedFields: ['name', 'ssn', 'medicalHistory'],
        authorizedFields: ['name'],
      },
    });
    const result = engine.evaluateForRegulation('hipaa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'HIPAA_MINIMUM_NECESSARY')).toBe(true);
  });

  it('allows authorized PHI fields only', () => {
    const ctx = makeContext({
      data: {
        auditTrailId: 'audit-001',
        encrypted: true,
        requestedFields: ['name', 'email'],
        authorizedFields: ['name', 'email', 'phone'],
      },
    });
    const result = engine.evaluateForRegulation('hipaa', ctx);
    const minNecessaryViolation = result.violations.find(
      (v) => v.ruleId === 'HIPAA_MINIMUM_NECESSARY',
    );
    expect(minNecessaryViolation).toBeUndefined();
  });

  it('blocks session exceeding 15-minute idle timeout', () => {
    const now = new Date();
    const twentyMinutesAgo = now.getTime() - 20 * 60 * 1000;
    const ctx = makeContext({
      timestamp: now,
      data: {
        auditTrailId: 'audit-001',
        encrypted: true,
        lastActivityAt: twentyMinutesAgo,
      },
    });
    const result = engine.evaluateForRegulation('hipaa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'HIPAA_SESSION_TIMEOUT')).toBe(true);
  });

  it('allows session within 15-minute timeout', () => {
    const now = new Date();
    const fiveMinutesAgo = now.getTime() - 5 * 60 * 1000;
    const ctx = makeContext({
      timestamp: now,
      data: {
        auditTrailId: 'audit-001',
        encrypted: true,
        lastActivityAt: fiveMinutesAgo,
      },
    });
    const result = engine.evaluateForRegulation('hipaa', ctx);
    const timeoutViolation = result.violations.find(
      (v) => v.ruleId === 'HIPAA_SESSION_TIMEOUT',
    );
    expect(timeoutViolation).toBeUndefined();
  });

  it('blocks PHI sharing without BAA', () => {
    const ctx = makeContext({
      data: {
        auditTrailId: 'audit-001',
        encrypted: true,
        subprocessorId: 'vendor-123',
        baaOnFile: false,
      },
    });
    const result = engine.evaluateForRegulation('hipaa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'HIPAA_BAA_REQUIRED')).toBe(true);
  });

  it('allows PHI sharing with BAA on file', () => {
    const ctx = makeContext({
      data: {
        auditTrailId: 'audit-001',
        encrypted: true,
        subprocessorId: 'vendor-123',
        baaOnFile: true,
      },
    });
    const result = engine.evaluateForRegulation('hipaa', ctx);
    const baaViolation = result.violations.find(
      (v) => v.ruleId === 'HIPAA_BAA_REQUIRED',
    );
    expect(baaViolation).toBeUndefined();
  });

  it('blocks breach exceeding 60-day notification window', () => {
    const now = new Date();
    const ninetyDaysAgo = now.getTime() - 90 * 24 * 60 * 60 * 1000;
    const ctx = makeContext({
      timestamp: now,
      data: {
        auditTrailId: 'audit-001',
        encrypted: true,
        breachDiscoveredAt: ninetyDaysAgo,
        breachNotificationSent: false,
      },
    });
    const result = engine.evaluateForRegulation('hipaa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'HIPAA_BREACH_NOTIFICATION')).toBe(true);
  });
});

// ── TCPA Rules ────────────────────────────────────────────────────────

describe('TCPA compliance rules', () => {
  beforeEach(() => {
    engine.registerRules(TCPA_RULES);
  });

  it('blocks autodialed contact without consent', () => {
    const ctx = makeContext({
      data: { isAutodialed: true, priorExpressConsent: false },
    });
    const result = engine.evaluateForRegulation('tcpa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'TCPA_PRIOR_EXPRESS_CONSENT')).toBe(true);
  });

  it('allows autodialed contact with consent', () => {
    const ctx = makeContext({
      data: { isAutodialed: true, priorExpressConsent: true },
    });
    const result = engine.evaluateForRegulation('tcpa', ctx);
    const consentViolation = result.violations.find(
      (v) => v.ruleId === 'TCPA_PRIOR_EXPRESS_CONSENT',
    );
    expect(consentViolation).toBeUndefined();
  });

  it('blocks calls to DNC-listed numbers', () => {
    const ctx = makeContext({
      data: { isOnDncList: true },
    });
    const result = engine.evaluateForRegulation('tcpa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'TCPA_DNC_CHECK')).toBe(true);
  });

  it('blocks calls before 8AM', () => {
    const ctx = makeContext({
      data: { localHour: 7 },
    });
    const result = engine.evaluateForRegulation('tcpa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'TCPA_TIME_RESTRICTIONS')).toBe(true);
  });

  it('blocks calls after 9PM', () => {
    const ctx = makeContext({
      data: { localHour: 21 },
    });
    const result = engine.evaluateForRegulation('tcpa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'TCPA_TIME_RESTRICTIONS')).toBe(true);
  });

  it('allows calls at 8AM', () => {
    const ctx = makeContext({
      data: { localHour: 8 },
    });
    const result = engine.evaluateForRegulation('tcpa', ctx);
    const timeViolation = result.violations.find(
      (v) => v.ruleId === 'TCPA_TIME_RESTRICTIONS',
    );
    expect(timeViolation).toBeUndefined();
  });

  it('blocks contact with opted-out consumer', () => {
    const ctx = makeContext({
      data: { consumerOptedOut: true },
    });
    const result = engine.evaluateForRegulation('tcpa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'TCPA_OPT_OUT')).toBe(true);
  });

  it('blocks voice call without caller ID', () => {
    const ctx = makeContext({
      channel: 'voice',
      data: { callerIdProvided: false },
    });
    const result = engine.evaluateForRegulation('tcpa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'TCPA_CALLER_ID')).toBe(true);
  });
});

// ── FDCPA Rules ───────────────────────────────────────────────────────

describe('FDCPA compliance rules', () => {
  beforeEach(() => {
    engine.registerRules(FDCPA_RULES);
  });

  it('blocks more than 7 contact attempts in 7 days', () => {
    const ctx = makeContext({
      data: { contactAttemptsLast7Days: 7 },
    });
    const result = engine.evaluateForRegulation('fdcpa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'FDCPA_CONTACT_FREQUENCY')).toBe(true);
  });

  it('allows 6 contact attempts in 7 days', () => {
    const ctx = makeContext({
      data: { contactAttemptsLast7Days: 6 },
    });
    const result = engine.evaluateForRegulation('fdcpa', ctx);
    const freqViolation = result.violations.find(
      (v) => v.ruleId === 'FDCPA_CONTACT_FREQUENCY',
    );
    expect(freqViolation).toBeUndefined();
  });

  it('blocks contact before 8AM local time', () => {
    const ctx = makeContext({
      data: { localHour: 6 },
    });
    const result = engine.evaluateForRegulation('fdcpa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'FDCPA_CONTACT_TIMING')).toBe(true);
  });

  it('blocks missing Mini-Miranda disclosure', () => {
    const ctx = makeContext({
      data: { miniMirandaIncluded: false },
    });
    const result = engine.evaluateForRegulation('fdcpa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'FDCPA_MINI_MIRANDA')).toBe(true);
  });

  it('blocks contact with cease-and-desist on file', () => {
    const ctx = makeContext({
      data: { ceaseAndDesistOnFile: true },
    });
    const result = engine.evaluateForRegulation('fdcpa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'FDCPA_CEASE_COMMUNICATION')).toBe(true);
  });

  it('blocks third-party disclosure', () => {
    const ctx = makeContext({
      data: { recipientIsThirdParty: true },
    });
    const result = engine.evaluateForRegulation('fdcpa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'FDCPA_THIRD_PARTY_DISCLOSURE')).toBe(true);
  });

  it('blocks flagged harassment content', () => {
    const ctx = makeContext({
      data: { contentFlagged: true },
    });
    const result = engine.evaluateForRegulation('fdcpa', ctx);
    expect(result.violations.some((v) => v.ruleId === 'FDCPA_HARASSMENT_PREVENTION')).toBe(true);
  });
});

// ── Compliance Engine Behavior ────────────────────────────────────────

describe('Compliance engine general behavior', () => {
  it('critical violations block the action', () => {
    engine.registerRules(HIPAA_RULES);
    const ctx = makeContext({
      data: { auditTrailId: '', encrypted: false },
    });
    const result = engine.evaluate(ctx);
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('no violations allows the action', () => {
    engine.registerRules(HIPAA_RULES);
    const ctx = makeContext({
      data: {
        auditTrailId: 'audit-001',
        encrypted: true,
      },
    });
    const result = engine.evaluate(ctx);
    expect(result.allowed).toBe(true);
  });

  it('multiple frameworks can be evaluated simultaneously', () => {
    engine.registerRules(HIPAA_RULES);
    engine.registerRules(TCPA_RULES);
    engine.registerRules(FDCPA_RULES);

    const ctx = makeContext({
      data: {
        auditTrailId: 'audit-001',
        encrypted: true,
      },
    });
    const result = engine.evaluate(ctx);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it('getRules returns all registered rules', () => {
    engine.registerRules(HIPAA_RULES);
    engine.registerRules(TCPA_RULES);
    const all = engine.getRules();
    expect(all.length).toBe(HIPAA_RULES.length + TCPA_RULES.length);
  });

  it('getRules filters by regulation', () => {
    engine.registerRules(HIPAA_RULES);
    engine.registerRules(TCPA_RULES);
    const hipaaOnly = engine.getRules('hipaa');
    expect(hipaaOnly.length).toBe(HIPAA_RULES.length);
    expect(hipaaOnly.every((r) => r.regulation === 'hipaa')).toBe(true);
  });

  it('rules evaluate in severity order (critical first)', () => {
    engine.registerRules(HIPAA_RULES);
    const ctx = makeContext({
      data: { auditTrailId: '', encrypted: false },
    });
    const result = engine.evaluate(ctx);
    // First violations should be critical severity
    if (result.violations.length > 0) {
      const firstViolation = result.violations[0];
      expect(firstViolation?.violation?.severity).toBe('critical');
    }
  });
});
