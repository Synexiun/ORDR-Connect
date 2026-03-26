import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceEngine } from '../engine.js';
import { LGPD_RULES } from '../rules/lgpd.js';
import type { ComplianceContext } from '../types.js';

function makeContext(overrides: Partial<ComplianceContext> = {}): ComplianceContext {
  return {
    tenantId: 'tenant-br',
    action: 'process_data',
    data: {},
    timestamp: new Date('2026-03-24T12:00:00Z'),
    ...overrides,
  };
}

describe('LGPD Rules', () => {
  let engine: ComplianceEngine;

  beforeEach(() => {
    engine = new ComplianceEngine();
    engine.registerRules([...LGPD_RULES]);
  });

  it('exports 8 LGPD rules', () => {
    expect(LGPD_RULES).toHaveLength(8);
  });

  it('all rules have regulation set to lgpd', () => {
    for (const rule of LGPD_RULES) {
      expect(rule.regulation).toBe('lgpd');
    }
  });

  it('all rules have non-empty id, name, and description', () => {
    for (const rule of LGPD_RULES) {
      expect(rule.id.length).toBeGreaterThan(0);
      expect(rule.name.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });

  // ── Legal Basis (Art. 7) ──────────────────────────────────────

  describe('LGPD_LEGAL_BASIS', () => {
    it('passes with valid legal basis (consent)', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'consent' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.passed).toBe(true);
    });

    it('passes with legitimate_interest legal basis', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'legitimate_interest' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.passed).toBe(true);
    });

    it('passes with contract legal basis', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'contract' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.passed).toBe(true);
    });

    it('passes with legal_obligation basis', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'legal_obligation' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.passed).toBe(true);
    });

    it('passes with public_policy basis', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'public_policy' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.passed).toBe(true);
    });

    it('passes with research basis', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'research' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.passed).toBe(true);
    });

    it('passes with exercise_of_rights basis', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'exercise_of_rights' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.passed).toBe(true);
    });

    it('passes with health_protection basis', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'health_protection' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.passed).toBe(true);
    });

    it('passes with credit_protection basis', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'credit_protection' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.passed).toBe(true);
    });

    it('passes with vital_interests basis', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'vital_interests' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.passed).toBe(true);
    });

    it('fails with invalid legal basis', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'invalid_basis' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('LGPD-ART7');
    });

    it('fails when no legal basis provided', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('LGPD-ART7');
    });

    it('fails when legal basis is empty string', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: '' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.passed).toBe(false);
    });

    it('includes the invalid basis in violation message', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'made_up_basis' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_LEGAL_BASIS');
      expect(rule?.violation?.message).toContain('made_up_basis');
    });

    it('has severity critical', () => {
      const lgpdRule = LGPD_RULES.find((r) => r.id === 'LGPD_LEGAL_BASIS');
      expect(lgpdRule?.severity).toBe('critical');
    });
  });

  // ── Data Subject Rights (Art. 18) ─────────────────────────────

  describe('LGPD_DATA_SUBJECT_RIGHTS', () => {
    it('passes when all required rights supported', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { dataSubjectRightsSupported: ['access', 'correction', 'deletion', 'portability'] },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DATA_SUBJECT_RIGHTS');
      expect(rule?.passed).toBe(true);
    });

    it('fails when missing required rights', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { dataSubjectRightsSupported: ['access'] },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DATA_SUBJECT_RIGHTS');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('LGPD-ART18');
      expect(rule?.violation?.message).toContain('correction');
    });

    it('passes with additional rights beyond required', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: {
            dataSubjectRightsSupported: [
              'access', 'correction', 'deletion', 'portability', 'anonymization',
            ],
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DATA_SUBJECT_RIGHTS');
      expect(rule?.passed).toBe(true);
    });

    it('fails when rights configuration is not an array', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { dataSubjectRightsSupported: 'access' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DATA_SUBJECT_RIGHTS');
      expect(rule?.passed).toBe(false);
    });

    it('passes when rights field not present', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'consent' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DATA_SUBJECT_RIGHTS');
      expect(rule?.passed).toBe(true);
    });

    it('fails when only deletion and portability are present', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { dataSubjectRightsSupported: ['deletion', 'portability'] },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DATA_SUBJECT_RIGHTS');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.message).toContain('access');
      expect(rule?.violation?.message).toContain('correction');
    });

    it('fails with empty array', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { dataSubjectRightsSupported: [] },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DATA_SUBJECT_RIGHTS');
      expect(rule?.passed).toBe(false);
    });

    it('has severity high', () => {
      const lgpdRule = LGPD_RULES.find((r) => r.id === 'LGPD_DATA_SUBJECT_RIGHTS');
      expect(lgpdRule?.severity).toBe('high');
    });
  });

  // ── Purpose Limitation (Art. 6-I) ─────────────────────────────

  describe('LGPD_PURPOSE_LIMITATION', () => {
    it('passes when purposes match', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { declaredPurpose: 'billing', actualPurpose: 'billing', legalBasis: 'contract' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_PURPOSE_LIMITATION');
      expect(rule?.passed).toBe(true);
    });

    it('fails when purposes differ', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { declaredPurpose: 'billing', actualPurpose: 'marketing', legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_PURPOSE_LIMITATION');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('LGPD-ART6-I');
    });

    it('passes when neither purpose is provided', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'consent' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_PURPOSE_LIMITATION');
      expect(rule?.passed).toBe(true);
    });

    it('passes when only declared purpose provided', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { declaredPurpose: 'billing', legalBasis: 'consent' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_PURPOSE_LIMITATION');
      expect(rule?.passed).toBe(true);
    });

    it('passes when only actual purpose provided', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { actualPurpose: 'marketing', legalBasis: 'consent' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_PURPOSE_LIMITATION');
      expect(rule?.passed).toBe(true);
    });

    it('includes both purposes in violation message', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { declaredPurpose: 'support', actualPurpose: 'analytics', legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_PURPOSE_LIMITATION');
      expect(rule?.violation?.message).toContain('analytics');
      expect(rule?.violation?.message).toContain('support');
    });

    it('has severity high', () => {
      const lgpdRule = LGPD_RULES.find((r) => r.id === 'LGPD_PURPOSE_LIMITATION');
      expect(lgpdRule?.severity).toBe('high');
    });
  });

  // ── Data Minimization (Art. 6-III) ────────────────────────────

  describe('LGPD_DATA_MINIMIZATION', () => {
    it('passes when collecting only necessary fields', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: {
            collectedFields: ['name', 'cpf'],
            necessaryFields: ['name', 'cpf'],
            legalBasis: 'consent',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DATA_MINIMIZATION');
      expect(rule?.passed).toBe(true);
    });

    it('fails when collecting excessive fields', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: {
            collectedFields: ['name', 'cpf', 'mothers_maiden_name'],
            necessaryFields: ['name', 'cpf'],
            legalBasis: 'consent',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DATA_MINIMIZATION');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('LGPD-ART6-III');
    });

    it('passes when fields not provided', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'consent' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DATA_MINIMIZATION');
      expect(rule?.passed).toBe(true);
    });

    it('passes when collected is a subset of necessary', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: {
            collectedFields: ['name'],
            necessaryFields: ['name', 'cpf'],
            legalBasis: 'consent',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DATA_MINIMIZATION');
      expect(rule?.passed).toBe(true);
    });

    it('lists all excessive fields in violation message', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: {
            collectedFields: ['name', 'cpf', 'religion', 'ethnicity'],
            necessaryFields: ['name', 'cpf'],
            legalBasis: 'consent',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DATA_MINIMIZATION');
      expect(rule?.violation?.message).toContain('religion');
      expect(rule?.violation?.message).toContain('ethnicity');
    });

    it('passes with empty arrays', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: {
            collectedFields: [],
            necessaryFields: [],
            legalBasis: 'consent',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DATA_MINIMIZATION');
      expect(rule?.passed).toBe(true);
    });

    it('has severity medium', () => {
      const lgpdRule = LGPD_RULES.find((r) => r.id === 'LGPD_DATA_MINIMIZATION');
      expect(lgpdRule?.severity).toBe('medium');
    });
  });

  // ── International Transfer (Art. 33) ──────────────────────────

  describe('LGPD_INTERNATIONAL_TRANSFER', () => {
    it('passes when no international transfer', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { internationalTransfer: false, legalBasis: 'consent' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_INTERNATIONAL_TRANSFER');
      expect(rule?.passed).toBe(true);
    });

    it('passes when transfer with adequacy determination', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { internationalTransfer: true, adequacyDetermination: true, legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_INTERNATIONAL_TRANSFER');
      expect(rule?.passed).toBe(true);
    });

    it('passes when transfer with contractual clauses', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { internationalTransfer: true, contractualClauses: true, legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_INTERNATIONAL_TRANSFER');
      expect(rule?.passed).toBe(true);
    });

    it('passes when transfer with explicit consent', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { internationalTransfer: true, transferConsent: true, legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_INTERNATIONAL_TRANSFER');
      expect(rule?.passed).toBe(true);
    });

    it('fails when international transfer without safeguards', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { internationalTransfer: true, legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_INTERNATIONAL_TRANSFER');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('LGPD-ART33');
    });

    it('passes when internationalTransfer is not set', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'consent' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_INTERNATIONAL_TRANSFER');
      expect(rule?.passed).toBe(true);
    });

    it('has severity critical', () => {
      const lgpdRule = LGPD_RULES.find((r) => r.id === 'LGPD_INTERNATIONAL_TRANSFER');
      expect(lgpdRule?.severity).toBe('critical');
    });

    it('returns remediation mentioning adequate safeguards', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { internationalTransfer: true, legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_INTERNATIONAL_TRANSFER');
      expect(rule?.violation?.remediation).toContain('adequate safeguards');
    });
  });

  // ── Breach Notification (Art. 48) ─────────────────────────────

  describe('LGPD_BREACH_NOTIFICATION_REASONABLE', () => {
    const now = new Date('2026-03-24T12:00:00Z');

    it('passes when notification sent', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          timestamp: now,
          data: {
            breachDetectedAt: now.getTime() - 100 * 60 * 60 * 1000,
            breachNotificationSent: true,
            legalBasis: 'consent',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_BREACH_NOTIFICATION_REASONABLE');
      expect(rule?.passed).toBe(true);
    });

    it('passes when breach within reasonable timeframe (24h)', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          timestamp: now,
          data: {
            breachDetectedAt: now.getTime() - 24 * 60 * 60 * 1000,
            legalBasis: 'consent',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_BREACH_NOTIFICATION_REASONABLE');
      expect(rule?.passed).toBe(true);
    });

    it('passes at exactly 72 hours', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          timestamp: now,
          data: {
            breachDetectedAt: now.getTime() - 72 * 60 * 60 * 1000,
            legalBasis: 'consent',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_BREACH_NOTIFICATION_REASONABLE');
      expect(rule?.passed).toBe(true);
    });

    it('fails when breach exceeds reasonable timeframe without notification', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          timestamp: now,
          data: {
            breachDetectedAt: now.getTime() - 100 * 60 * 60 * 1000,
            legalBasis: 'consent',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_BREACH_NOTIFICATION_REASONABLE');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('LGPD-ART48');
    });

    it('passes when breachDetectedAt is not a number', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          timestamp: now,
          data: { breachDetectedAt: 'yesterday', legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_BREACH_NOTIFICATION_REASONABLE');
      expect(rule?.passed).toBe(true);
    });

    it('includes elapsed hours in violation message', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          timestamp: now,
          data: {
            breachDetectedAt: now.getTime() - 100 * 60 * 60 * 1000,
            legalBasis: 'consent',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_BREACH_NOTIFICATION_REASONABLE');
      expect(rule?.violation?.message).toContain('100');
    });

    it('has severity critical', () => {
      const lgpdRule = LGPD_RULES.find((r) => r.id === 'LGPD_BREACH_NOTIFICATION_REASONABLE');
      expect(lgpdRule?.severity).toBe('critical');
    });

    it('returns remediation mentioning ANPD', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          timestamp: now,
          data: {
            breachDetectedAt: now.getTime() - 100 * 60 * 60 * 1000,
            legalBasis: 'consent',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_BREACH_NOTIFICATION_REASONABLE');
      expect(rule?.violation?.remediation).toContain('ANPD');
    });
  });

  // ── DPO Required (Art. 41) ────────────────────────────────────

  describe('LGPD_DPO_REQUIRED', () => {
    it('passes when DPO not required', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { dpoRequired: false, legalBasis: 'consent' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DPO_REQUIRED');
      expect(rule?.passed).toBe(true);
    });

    it('passes when DPO required and appointed', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { dpoRequired: true, dpoAppointed: true, legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DPO_REQUIRED');
      expect(rule?.passed).toBe(true);
    });

    it('fails when DPO required but not appointed', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { dpoRequired: true, dpoAppointed: false, legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DPO_REQUIRED');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('LGPD-ART41');
    });

    it('passes when dpoRequired is not set', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'consent' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DPO_REQUIRED');
      expect(rule?.passed).toBe(true);
    });

    it('has severity high', () => {
      const lgpdRule = LGPD_RULES.find((r) => r.id === 'LGPD_DPO_REQUIRED');
      expect(lgpdRule?.severity).toBe('high');
    });

    it('returns remediation mentioning encarregado', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { dpoRequired: true, dpoAppointed: false, legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_DPO_REQUIRED');
      expect(rule?.violation?.remediation).toContain('encarregado');
    });
  });

  // ── Impact Report (Art. 38) ───────────────────────────────────

  describe('LGPD_IMPACT_REPORT', () => {
    it('passes when impact report not required', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { impactReportRequired: false, legalBasis: 'consent' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_IMPACT_REPORT');
      expect(rule?.passed).toBe(true);
    });

    it('passes when impact report required and completed', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { impactReportRequired: true, impactReportCompleted: true, legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_IMPACT_REPORT');
      expect(rule?.passed).toBe(true);
    });

    it('fails when impact report required but not completed', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { impactReportRequired: true, impactReportCompleted: false, legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_IMPACT_REPORT');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('LGPD-ART38');
    });

    it('passes when impactReportRequired is not set', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'consent' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_IMPACT_REPORT');
      expect(rule?.passed).toBe(true);
    });

    it('has severity high', () => {
      const lgpdRule = LGPD_RULES.find((r) => r.id === 'LGPD_IMPACT_REPORT');
      expect(lgpdRule?.severity).toBe('high');
    });

    it('returns remediation mentioning fundamental rights', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { impactReportRequired: true, impactReportCompleted: false, legalBasis: 'consent' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'LGPD_IMPACT_REPORT');
      expect(rule?.violation?.remediation).toContain('fundamental rights');
    });
  });

  // ── Engine-level integration ──────────────────────────────────

  describe('engine integration', () => {
    it('blocks when a critical rule fails (no legal basis)', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: {} }),
      );
      expect(result.allowed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('blocks when a high-severity rule fails', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: { legalBasis: 'consent', privacyPolicyPublished: false, dpoRequired: true, dpoAppointed: false },
        }),
      );
      expect(result.allowed).toBe(false);
    });

    it('allows when only medium-severity rule fails', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({
          data: {
            legalBasis: 'consent',
            collectedFields: ['name', 'ssn'],
            necessaryFields: ['name'],
          },
        }),
      );
      // Data minimization is medium — should still allow
      expect(result.allowed).toBe(true);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('returns all 8 rule results', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'consent' } }),
      );
      expect(result.results).toHaveLength(8);
    });

    it('returns a timestamp on the gate result', () => {
      const result = engine.evaluateForRegulation(
        'lgpd',
        makeContext({ data: { legalBasis: 'consent' } }),
      );
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });
});
