import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceEngine } from '../engine.js';
import { HIPAA_ENHANCED_RULES } from '../rules/hipaa-enhanced.js';
import type { ComplianceContext } from '../types.js';

function makeContext(overrides: Partial<ComplianceContext> = {}): ComplianceContext {
  return {
    tenantId: 'tenant-health',
    action: 'access_phi',
    data: {},
    timestamp: new Date('2026-03-25T12:00:00Z'),
    ...overrides,
  };
}

describe('HIPAA Enhanced Rules', () => {
  let engine: ComplianceEngine;

  beforeEach(() => {
    engine = new ComplianceEngine();
    engine.registerRules([...HIPAA_ENHANCED_RULES]);
  });

  it('exports 6 enhanced HIPAA rules', () => {
    expect(HIPAA_ENHANCED_RULES).toHaveLength(6);
  });

  it('all rules are for the hipaa regulation', () => {
    for (const rule of HIPAA_ENHANCED_RULES) {
      expect(rule.regulation).toBe('hipaa');
    }
  });

  // ── Enhanced Minimum Necessary ────────────────────────────────

  describe('HIPAA_MINIMUM_NECESSARY_ENHANCED', () => {
    it('passes when no PHI access context is provided', () => {
      const result = engine.evaluateForRegulation('hipaa', makeContext());
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_MINIMUM_NECESSARY_ENHANCED');
      expect(rule?.passed).toBe(true);
    });

    it('fails when accessJustification is missing', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            requestedFields: ['name'],
            purposeCode: 'treatment',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_MINIMUM_NECESSARY_ENHANCED');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('HIPAA-164.502-B-ENH');
    });

    it('fails when purposeCode is missing', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            requestedFields: ['name'],
            accessJustification: 'Scheduled follow-up',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_MINIMUM_NECESSARY_ENHANCED');
      expect(rule?.passed).toBe(false);
    });

    it('fails when accessJustification is empty string', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            requestedFields: ['name'],
            purposeCode: 'treatment',
            accessJustification: '',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_MINIMUM_NECESSARY_ENHANCED');
      expect(rule?.passed).toBe(false);
    });

    it('passes when both justification and purpose code are provided', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            requestedFields: ['name', 'dob'],
            purposeCode: 'treatment',
            accessJustification: 'Verifying patient identity for appointment',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_MINIMUM_NECESSARY_ENHANCED');
      expect(rule?.passed).toBe(true);
    });

    it('includes remediation in violation', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            requestedFields: ['name'],
            purposeCode: 'treatment',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_MINIMUM_NECESSARY_ENHANCED');
      expect(rule?.violation?.remediation).toBeDefined();
      expect(rule?.violation?.remediation?.length).toBeGreaterThan(0);
    });
  });

  // ── Designated Record Set ─────────────────────────────────────

  describe('HIPAA_DESIGNATED_RECORD_SET', () => {
    it('passes when no record set context is provided', () => {
      const result = engine.evaluateForRegulation('hipaa', makeContext());
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_DESIGNATED_RECORD_SET');
      expect(rule?.passed).toBe(true);
    });

    it('passes for medical_record type', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { recordSetType: 'medical_record' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_DESIGNATED_RECORD_SET');
      expect(rule?.passed).toBe(true);
    });

    it('passes for billing_record type', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { recordSetType: 'billing_record' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_DESIGNATED_RECORD_SET');
      expect(rule?.passed).toBe(true);
    });

    it('passes for enrollment_record type', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { recordSetType: 'enrollment_record' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_DESIGNATED_RECORD_SET');
      expect(rule?.passed).toBe(true);
    });

    it('passes for case_management type', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { recordSetType: 'case_management' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_DESIGNATED_RECORD_SET');
      expect(rule?.passed).toBe(true);
    });

    it('passes for claims_adjudication type', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { recordSetType: 'claims_adjudication' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_DESIGNATED_RECORD_SET');
      expect(rule?.passed).toBe(true);
    });

    it('fails for invalid record set type', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { recordSetType: 'social_media_feed' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_DESIGNATED_RECORD_SET');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('HIPAA-164.524');
    });

    it('fails for empty string record set type', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { recordSetType: '' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_DESIGNATED_RECORD_SET');
      expect(rule?.passed).toBe(false);
    });
  });

  // ── Accounting of Disclosures ─────────────────────────────────

  describe('HIPAA_ACCOUNTING_OF_DISCLOSURES', () => {
    it('passes when action is not a disclosure', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { isDisclosure: false },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_ACCOUNTING_OF_DISCLOSURES');
      expect(rule?.passed).toBe(true);
    });

    it('passes when not flagged as disclosure at all', () => {
      const result = engine.evaluateForRegulation('hipaa', makeContext());
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_ACCOUNTING_OF_DISCLOSURES');
      expect(rule?.passed).toBe(true);
    });

    it('passes when all disclosure tracking fields are present', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            isDisclosure: true,
            disclosureDate: '2026-03-25',
            disclosureRecipient: 'Referring Provider Dr. Smith',
            disclosurePurpose: 'Treatment coordination',
            disclosureDescription: 'Shared patient care summary for referral',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_ACCOUNTING_OF_DISCLOSURES');
      expect(rule?.passed).toBe(true);
    });

    it('fails when disclosureDate is missing', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            isDisclosure: true,
            disclosureRecipient: 'Provider',
            disclosurePurpose: 'Treatment',
            disclosureDescription: 'Summary shared',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_ACCOUNTING_OF_DISCLOSURES');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.message).toContain('disclosureDate');
    });

    it('fails when disclosureRecipient is missing', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            isDisclosure: true,
            disclosureDate: '2026-03-25',
            disclosurePurpose: 'Treatment',
            disclosureDescription: 'Summary shared',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_ACCOUNTING_OF_DISCLOSURES');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.message).toContain('disclosureRecipient');
    });

    it('fails when disclosurePurpose is missing', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            isDisclosure: true,
            disclosureDate: '2026-03-25',
            disclosureRecipient: 'Provider',
            disclosureDescription: 'Summary shared',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_ACCOUNTING_OF_DISCLOSURES');
      expect(rule?.passed).toBe(false);
    });

    it('fails when disclosureDescription is missing', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            isDisclosure: true,
            disclosureDate: '2026-03-25',
            disclosureRecipient: 'Provider',
            disclosurePurpose: 'Treatment',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_ACCOUNTING_OF_DISCLOSURES');
      expect(rule?.passed).toBe(false);
    });

    it('reports all missing fields in violation message', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { isDisclosure: true },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_ACCOUNTING_OF_DISCLOSURES');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.message).toContain('disclosureDate');
      expect(rule?.violation?.message).toContain('disclosureRecipient');
    });

    it('has violation code HIPAA-164.528', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { isDisclosure: true },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_ACCOUNTING_OF_DISCLOSURES');
      expect(rule?.violation?.code).toBe('HIPAA-164.528');
    });

    it('accepts numeric disclosureDate', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            isDisclosure: true,
            disclosureDate: Date.now(),
            disclosureRecipient: 'Provider',
            disclosurePurpose: 'Treatment',
            disclosureDescription: 'Summary',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_ACCOUNTING_OF_DISCLOSURES');
      expect(rule?.passed).toBe(true);
    });
  });

  // ── Breach Risk Assessment ────────────────────────────────────

  describe('HIPAA_BREACH_RISK_ASSESSMENT', () => {
    it('passes when not a potential breach', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { isPotentialBreach: false },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_BREACH_RISK_ASSESSMENT');
      expect(rule?.passed).toBe(true);
    });

    it('passes when all 4 assessment factors are provided', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            isPotentialBreach: true,
            phiNatureAssessment: 'SSN and clinical data involved',
            unauthorizedRecipientAssessment: 'Unknown external party',
            acquisitionViewingAssessment: 'Data was downloaded but not confirmed viewed',
            mitigationAssessment: 'Access revoked, encryption key rotated',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_BREACH_RISK_ASSESSMENT');
      expect(rule?.passed).toBe(true);
    });

    it('fails when phiNatureAssessment is missing', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            isPotentialBreach: true,
            unauthorizedRecipientAssessment: 'Unknown',
            acquisitionViewingAssessment: 'Downloaded',
            mitigationAssessment: 'Access revoked',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_BREACH_RISK_ASSESSMENT');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.message).toContain('phiNatureAssessment');
    });

    it('fails when unauthorizedRecipientAssessment is missing', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            isPotentialBreach: true,
            phiNatureAssessment: 'Clinical data',
            acquisitionViewingAssessment: 'Downloaded',
            mitigationAssessment: 'Access revoked',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_BREACH_RISK_ASSESSMENT');
      expect(rule?.passed).toBe(false);
    });

    it('fails when acquisitionViewingAssessment is missing', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            isPotentialBreach: true,
            phiNatureAssessment: 'Clinical data',
            unauthorizedRecipientAssessment: 'Unknown',
            mitigationAssessment: 'Access revoked',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_BREACH_RISK_ASSESSMENT');
      expect(rule?.passed).toBe(false);
    });

    it('fails when mitigationAssessment is missing', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            isPotentialBreach: true,
            phiNatureAssessment: 'Clinical data',
            unauthorizedRecipientAssessment: 'Unknown',
            acquisitionViewingAssessment: 'Downloaded',
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_BREACH_RISK_ASSESSMENT');
      expect(rule?.passed).toBe(false);
    });

    it('has violation code HIPAA-164.402-2', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { isPotentialBreach: true },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_BREACH_RISK_ASSESSMENT');
      expect(rule?.violation?.code).toBe('HIPAA-164.402-2');
    });

    it('has critical severity', () => {
      const ruleObj = HIPAA_ENHANCED_RULES.find((r) => r.id === 'HIPAA_BREACH_RISK_ASSESSMENT');
      expect(ruleObj?.severity).toBe('critical');
    });
  });

  // ── BAA Required Enhanced ─────────────────────────────────────

  describe('HIPAA_BAA_REQUIRED_ENHANCED', () => {
    it('passes when no subprocessor is involved', () => {
      const result = engine.evaluateForRegulation('hipaa', makeContext());
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_BAA_REQUIRED_ENHANCED');
      expect(rule?.passed).toBe(true);
    });

    it('passes when BAA is on file and not expired', () => {
      const futureDate = Date.now() + 365 * 24 * 60 * 60 * 1000;
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            subprocessorId: 'vendor-001',
            baaOnFile: true,
            baaExpirationDate: futureDate,
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_BAA_REQUIRED_ENHANCED');
      expect(rule?.passed).toBe(true);
    });

    it('fails when BAA is not on file', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            subprocessorId: 'vendor-001',
            baaOnFile: false,
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_BAA_REQUIRED_ENHANCED');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('HIPAA-164.502-E-ENH');
    });

    it('fails when BAA has expired', () => {
      // Use a date before the context timestamp (2026-03-25T12:00:00Z)
      const pastDate = new Date('2026-03-20T00:00:00Z').getTime();
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            subprocessorId: 'vendor-001',
            baaOnFile: true,
            baaExpirationDate: pastDate,
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_BAA_REQUIRED_ENHANCED');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.message).toContain('expired');
    });

    it('passes when BAA is on file with no expiration date', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            subprocessorId: 'vendor-001',
            baaOnFile: true,
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_BAA_REQUIRED_ENHANCED');
      expect(rule?.passed).toBe(true);
    });

    it('includes subprocessor ID in violation message', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            subprocessorId: 'vendor-xyz',
            baaOnFile: false,
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_BAA_REQUIRED_ENHANCED');
      expect(rule?.violation?.message).toContain('vendor-xyz');
    });

    it('has critical severity', () => {
      const ruleObj = HIPAA_ENHANCED_RULES.find((r) => r.id === 'HIPAA_BAA_REQUIRED_ENHANCED');
      expect(ruleObj?.severity).toBe('critical');
    });
  });

  // ── Authorization Required ────────────────────────────────────

  describe('HIPAA_AUTHORIZATION_REQUIRED', () => {
    it('passes when no usage type is specified', () => {
      const result = engine.evaluateForRegulation('hipaa', makeContext());
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_AUTHORIZATION_REQUIRED');
      expect(rule?.passed).toBe(true);
    });

    it('passes for standard treatment usage without authorization', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { usageType: 'treatment' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_AUTHORIZATION_REQUIRED');
      expect(rule?.passed).toBe(true);
    });

    it('passes for payment usage without authorization', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { usageType: 'payment' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_AUTHORIZATION_REQUIRED');
      expect(rule?.passed).toBe(true);
    });

    it('passes for operations usage without authorization', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { usageType: 'operations' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_AUTHORIZATION_REQUIRED');
      expect(rule?.passed).toBe(true);
    });

    it('fails for marketing usage without patient authorization', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            usageType: 'marketing',
            patientAuthorizationOnFile: false,
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_AUTHORIZATION_REQUIRED');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('HIPAA-164.508');
    });

    it('passes for marketing usage with patient authorization', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            usageType: 'marketing',
            patientAuthorizationOnFile: true,
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_AUTHORIZATION_REQUIRED');
      expect(rule?.passed).toBe(true);
    });

    it('fails for sale_of_phi without authorization', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { usageType: 'sale_of_phi' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_AUTHORIZATION_REQUIRED');
      expect(rule?.passed).toBe(false);
    });

    it('fails for psychotherapy_notes without authorization', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { usageType: 'psychotherapy_notes' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_AUTHORIZATION_REQUIRED');
      expect(rule?.passed).toBe(false);
    });

    it('fails for research without authorization', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { usageType: 'research' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_AUTHORIZATION_REQUIRED');
      expect(rule?.passed).toBe(false);
    });

    it('fails for fundraising without authorization', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { usageType: 'fundraising' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_AUTHORIZATION_REQUIRED');
      expect(rule?.passed).toBe(false);
    });

    it('fails for underwriting without authorization', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { usageType: 'underwriting' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_AUTHORIZATION_REQUIRED');
      expect(rule?.passed).toBe(false);
    });

    it('includes usage type in violation message', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: { usageType: 'marketing' },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'HIPAA_AUTHORIZATION_REQUIRED');
      expect(rule?.violation?.message).toContain('marketing');
    });

    it('has critical severity', () => {
      const ruleObj = HIPAA_ENHANCED_RULES.find((r) => r.id === 'HIPAA_AUTHORIZATION_REQUIRED');
      expect(ruleObj?.severity).toBe('critical');
    });
  });

  // ── Integration ───────────────────────────────────────────────

  describe('Engine integration', () => {
    it('all rules pass when no relevant context data is provided', () => {
      const result = engine.evaluateForRegulation('hipaa', makeContext());
      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('blocks when critical violation is detected', () => {
      const result = engine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            isPotentialBreach: true,
            // Missing all 4 factors
          },
        }),
      );
      expect(result.allowed).toBe(false);
    });

    it('combined base and enhanced rules work together', () => {
      const combinedEngine = new ComplianceEngine();
      // Register only enhanced rules for this test
      combinedEngine.registerRules([...HIPAA_ENHANCED_RULES]);

      const result = combinedEngine.evaluateForRegulation(
        'hipaa',
        makeContext({
          data: {
            subprocessorId: 'vendor-001',
            baaOnFile: false,
            usageType: 'marketing',
          },
        }),
      );

      // Both BAA and Authorization should fail
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });
  });
});
