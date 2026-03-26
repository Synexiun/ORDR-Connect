import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceEngine } from '../engine.js';
import { PIPEDA_RULES } from '../rules/pipeda.js';
import type { ComplianceContext } from '../types.js';

function makeContext(overrides: Partial<ComplianceContext> = {}): ComplianceContext {
  return {
    tenantId: 'tenant-ca',
    action: 'process_data',
    data: {},
    timestamp: new Date('2026-03-24T12:00:00Z'),
    ...overrides,
  };
}

describe('PIPEDA Rules', () => {
  let engine: ComplianceEngine;

  beforeEach(() => {
    engine = new ComplianceEngine();
    engine.registerRules([...PIPEDA_RULES]);
  });

  it('exports 8 PIPEDA rules', () => {
    expect(PIPEDA_RULES).toHaveLength(8);
  });

  it('all rules have regulation set to pipeda', () => {
    for (const rule of PIPEDA_RULES) {
      expect(rule.regulation).toBe('pipeda');
    }
  });

  it('all rules have non-empty id, name, and description', () => {
    for (const rule of PIPEDA_RULES) {
      expect(rule.id.length).toBeGreaterThan(0);
      expect(rule.name.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });

  // ── Meaningful Consent (Principle 3) ──────────────────────────

  describe('PIPEDA_MEANINGFUL_CONSENT', () => {
    it('passes when consent is informed and specific', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: { consentObtained: true, consentInformed: true, consentSpecific: true },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_MEANINGFUL_CONSENT');
      expect(rule?.passed).toBe(true);
    });

    it('fails when consent obtained but not informed', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: { consentObtained: true, consentInformed: false, consentSpecific: true },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_MEANINGFUL_CONSENT');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('PIPEDA-P3');
    });

    it('fails when consent obtained but not specific', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: { consentObtained: true, consentInformed: true, consentSpecific: false },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_MEANINGFUL_CONSENT');
      expect(rule?.passed).toBe(false);
    });

    it('fails when consent not obtained at all', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: { consentObtained: false },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_MEANINGFUL_CONSENT');
      expect(rule?.passed).toBe(false);
    });

    it('passes when consent field not present', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_MEANINGFUL_CONSENT');
      expect(rule?.passed).toBe(true);
    });

    it('fails when consent obtained but neither informed nor specific', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: { consentObtained: true, consentInformed: false, consentSpecific: false },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_MEANINGFUL_CONSENT');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.severity).toBe('critical');
    });

    it('returns remediation guidance on failure', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: { consentObtained: true, consentInformed: false, consentSpecific: false },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_MEANINGFUL_CONSENT');
      expect(rule?.violation?.remediation).toBeDefined();
      expect(rule?.violation?.remediation.length).toBeGreaterThan(0);
    });

    it('has severity critical', () => {
      const pipedaRule = PIPEDA_RULES.find((r) => r.id === 'PIPEDA_MEANINGFUL_CONSENT');
      expect(pipedaRule?.severity).toBe('critical');
    });
  });

  // ── Limited Collection (Principle 4) ──────────────────────────

  describe('PIPEDA_LIMITED_COLLECTION', () => {
    it('passes when only required fields collected', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: { collectedFields: ['name', 'email'], requiredFields: ['name', 'email'] },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_LIMITED_COLLECTION');
      expect(rule?.passed).toBe(true);
    });

    it('fails when excessive fields collected', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: { collectedFields: ['name', 'email', 'ssn'], requiredFields: ['name', 'email'] },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_LIMITED_COLLECTION');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('PIPEDA-P4');
      expect(rule?.violation?.message).toContain('ssn');
    });

    it('passes when fields not declared', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_LIMITED_COLLECTION');
      expect(rule?.passed).toBe(true);
    });

    it('passes when collected is a subset of required', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: { collectedFields: ['name'], requiredFields: ['name', 'email'] },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_LIMITED_COLLECTION');
      expect(rule?.passed).toBe(true);
    });

    it('fails with multiple excessive fields and lists them all', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: {
            collectedFields: ['name', 'email', 'ssn', 'dob', 'mothers_maiden_name'],
            requiredFields: ['name', 'email'],
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_LIMITED_COLLECTION');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.message).toContain('ssn');
      expect(rule?.violation?.message).toContain('dob');
      expect(rule?.violation?.message).toContain('mothers_maiden_name');
    });

    it('passes when collectedFields is not an array', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: { collectedFields: 'name', requiredFields: ['name'] },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_LIMITED_COLLECTION');
      expect(rule?.passed).toBe(true);
    });

    it('passes when both arrays are empty', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: { collectedFields: [], requiredFields: [] },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_LIMITED_COLLECTION');
      expect(rule?.passed).toBe(true);
    });

    it('has severity high', () => {
      const pipedaRule = PIPEDA_RULES.find((r) => r.id === 'PIPEDA_LIMITED_COLLECTION');
      expect(pipedaRule?.severity).toBe('high');
    });
  });

  // ── Retention Schedule (Principle 5) ──────────────────────────

  describe('PIPEDA_RETENTION_SCHEDULE', () => {
    it('passes when retention schedule is defined', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { retentionScheduleDefined: true } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_RETENTION_SCHEDULE');
      expect(rule?.passed).toBe(true);
    });

    it('fails when retention schedule not defined', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { retentionScheduleDefined: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_RETENTION_SCHEDULE');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('PIPEDA-P5');
    });

    it('passes when retention field not present', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_RETENTION_SCHEDULE');
      expect(rule?.passed).toBe(true);
    });

    it('returns remediation guidance on failure', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { retentionScheduleDefined: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_RETENTION_SCHEDULE');
      expect(rule?.violation?.remediation).toContain('retention schedule');
    });

    it('has severity high', () => {
      const pipedaRule = PIPEDA_RULES.find((r) => r.id === 'PIPEDA_RETENTION_SCHEDULE');
      expect(pipedaRule?.severity).toBe('high');
    });
  });

  // ── Access Request 30 Days (Principle 9) ──────────────────────

  describe('PIPEDA_ACCESS_REQUEST_30D', () => {
    const now = new Date('2026-03-24T12:00:00Z');

    it('passes when access request fulfilled', () => {
      const requestedAt = now.getTime() - 40 * 24 * 60 * 60 * 1000;
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          timestamp: now,
          data: { accessRequestedAt: requestedAt, accessRequestFulfilled: true },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_ACCESS_REQUEST_30D');
      expect(rule?.passed).toBe(true);
    });

    it('passes when request is within 30-day window', () => {
      const requestedAt = now.getTime() - 15 * 24 * 60 * 60 * 1000;
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          timestamp: now,
          data: { accessRequestedAt: requestedAt },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_ACCESS_REQUEST_30D');
      expect(rule?.passed).toBe(true);
    });

    it('fails when request exceeds 30 days and not fulfilled', () => {
      const requestedAt = now.getTime() - 35 * 24 * 60 * 60 * 1000;
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          timestamp: now,
          data: { accessRequestedAt: requestedAt },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_ACCESS_REQUEST_30D');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('PIPEDA-P9');
      expect(rule?.violation?.message).toContain('35');
    });

    it('passes when no access request', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ timestamp: now, data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_ACCESS_REQUEST_30D');
      expect(rule?.passed).toBe(true);
    });

    it('passes at exactly 30 days', () => {
      const requestedAt = now.getTime() - 30 * 24 * 60 * 60 * 1000;
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          timestamp: now,
          data: { accessRequestedAt: requestedAt },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_ACCESS_REQUEST_30D');
      expect(rule?.passed).toBe(true);
    });

    it('fails at 31 days without fulfillment', () => {
      const requestedAt = now.getTime() - 31 * 24 * 60 * 60 * 1000;
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          timestamp: now,
          data: { accessRequestedAt: requestedAt },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_ACCESS_REQUEST_30D');
      expect(rule?.passed).toBe(false);
    });

    it('passes when accessRequestedAt is not a number', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          timestamp: now,
          data: { accessRequestedAt: 'invalid' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_ACCESS_REQUEST_30D');
      expect(rule?.passed).toBe(true);
    });

    it('includes elapsed days in violation message', () => {
      const requestedAt = now.getTime() - 45 * 24 * 60 * 60 * 1000;
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          timestamp: now,
          data: { accessRequestedAt: requestedAt },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_ACCESS_REQUEST_30D');
      expect(rule?.violation?.message).toContain('45');
    });

    it('has severity critical', () => {
      const pipedaRule = PIPEDA_RULES.find((r) => r.id === 'PIPEDA_ACCESS_REQUEST_30D');
      expect(pipedaRule?.severity).toBe('critical');
    });
  });

  // ── Accuracy (Principle 6) ────────────────────────────────────

  describe('PIPEDA_ACCURACY', () => {
    it('passes when accuracy verified', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { accuracyVerified: true } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_ACCURACY');
      expect(rule?.passed).toBe(true);
    });

    it('fails when accuracy not verified', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { accuracyVerified: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_ACCURACY');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('PIPEDA-P6');
    });

    it('passes when accuracy field not present', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_ACCURACY');
      expect(rule?.passed).toBe(true);
    });

    it('has severity medium', () => {
      const pipedaRule = PIPEDA_RULES.find((r) => r.id === 'PIPEDA_ACCURACY');
      expect(pipedaRule?.severity).toBe('medium');
    });

    it('returns remediation guidance on failure', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { accuracyVerified: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_ACCURACY');
      expect(rule?.violation?.remediation).toContain('verify');
    });
  });

  // ── Safeguards (Principle 7) ──────────────────────────────────

  describe('PIPEDA_SAFEGUARDS', () => {
    it('passes when encrypted and access controlled', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { encrypted: true, accessControlled: true } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_SAFEGUARDS');
      expect(rule?.passed).toBe(true);
    });

    it('fails when encryption missing', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { encrypted: false, accessControlled: true } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_SAFEGUARDS');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.message).toContain('encryption');
    });

    it('fails when access control missing', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { encrypted: true, accessControlled: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_SAFEGUARDS');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.message).toContain('access control');
    });

    it('fails when both safeguards missing', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { encrypted: false, accessControlled: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_SAFEGUARDS');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('PIPEDA-P7');
    });

    it('passes when neither field is present', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_SAFEGUARDS');
      expect(rule?.passed).toBe(true);
    });

    it('mentions both missing safeguards in message when both are false', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { encrypted: false, accessControlled: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_SAFEGUARDS');
      expect(rule?.violation?.message).toContain('encryption');
      expect(rule?.violation?.message).toContain('access control');
    });

    it('has severity critical', () => {
      const pipedaRule = PIPEDA_RULES.find((r) => r.id === 'PIPEDA_SAFEGUARDS');
      expect(pipedaRule?.severity).toBe('critical');
    });

    it('blocks the action as a critical violation', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { encrypted: false, accessControlled: false } }),
      );
      expect(result.allowed).toBe(false);
    });
  });

  // ── Transparency (Principle 8) ────────────────────────────────

  describe('PIPEDA_TRANSPARENCY', () => {
    it('passes when privacy policy published', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { privacyPolicyPublished: true } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_TRANSPARENCY');
      expect(rule?.passed).toBe(true);
    });

    it('fails when privacy policy not published', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { privacyPolicyPublished: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_TRANSPARENCY');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('PIPEDA-P8');
    });

    it('passes when field not present', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_TRANSPARENCY');
      expect(rule?.passed).toBe(true);
    });

    it('has severity high', () => {
      const pipedaRule = PIPEDA_RULES.find((r) => r.id === 'PIPEDA_TRANSPARENCY');
      expect(pipedaRule?.severity).toBe('high');
    });

    it('returns remediation guidance on failure', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { privacyPolicyPublished: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_TRANSPARENCY');
      expect(rule?.violation?.remediation).toContain('privacy policy');
    });
  });

  // ── Breach Notification (s. 10.1) ─────────────────────────────

  describe('PIPEDA_BREACH_NOTIFICATION', () => {
    it('passes when no breach detected', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_BREACH_NOTIFICATION');
      expect(rule?.passed).toBe(true);
    });

    it('passes when breach without risk of harm', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { breachDetected: true, riskOfSignificantHarm: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_BREACH_NOTIFICATION');
      expect(rule?.passed).toBe(true);
    });

    it('passes when breach with harm risk and notification sent', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: {
            breachDetected: true,
            riskOfSignificantHarm: true,
            breachNotificationSent: true,
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_BREACH_NOTIFICATION');
      expect(rule?.passed).toBe(true);
    });

    it('fails when breach with harm risk and no notification', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: {
            breachDetected: true,
            riskOfSignificantHarm: true,
            breachNotificationSent: false,
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_BREACH_NOTIFICATION');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('PIPEDA-S10-1');
    });

    it('has severity critical', () => {
      const pipedaRule = PIPEDA_RULES.find((r) => r.id === 'PIPEDA_BREACH_NOTIFICATION');
      expect(pipedaRule?.severity).toBe('critical');
    });

    it('returns remediation mentioning Privacy Commissioner', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: {
            breachDetected: true,
            riskOfSignificantHarm: true,
            breachNotificationSent: false,
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_BREACH_NOTIFICATION');
      expect(rule?.violation?.remediation).toContain('Privacy Commissioner');
    });

    it('passes when breachDetected is false', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: { breachDetected: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'PIPEDA_BREACH_NOTIFICATION');
      expect(rule?.passed).toBe(true);
    });
  });

  // ── Engine-level integration ──────────────────────────────────

  describe('engine integration', () => {
    it('blocks when a critical rule fails', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: {
            consentObtained: true,
            consentInformed: false,
            consentSpecific: false,
          },
        }),
      );
      expect(result.allowed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('blocks when a high-severity rule fails', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: { privacyPolicyPublished: false },
        }),
      );
      expect(result.allowed).toBe(false);
    });

    it('allows when only medium-severity rule fails', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: { accuracyVerified: false },
        }),
      );
      // Accuracy is medium severity — should not block
      expect(result.allowed).toBe(true);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('returns all rule results even when some pass', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: {} }),
      );
      expect(result.results).toHaveLength(8);
    });

    it('returns no violations when all rules pass', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: {} }),
      );
      expect(result.violations).toHaveLength(0);
      expect(result.allowed).toBe(true);
    });

    it('returns a timestamp on the gate result', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({ data: {} }),
      );
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('evaluates multiple failing rules simultaneously', () => {
      const result = engine.evaluateForRegulation(
        'pipeda',
        makeContext({
          data: {
            consentObtained: true,
            consentInformed: false,
            consentSpecific: false,
            encrypted: false,
            accessControlled: false,
            privacyPolicyPublished: false,
            retentionScheduleDefined: false,
          },
        }),
      );
      expect(result.allowed).toBe(false);
      // At least consent, safeguards, transparency, retention should fail
      expect(result.violations.length).toBeGreaterThanOrEqual(4);
    });
  });
});
