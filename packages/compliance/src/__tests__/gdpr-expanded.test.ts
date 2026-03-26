import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceEngine } from '../engine.js';
import { GDPR_RULES } from '../rules/gdpr.js';
import type { ComplianceContext } from '../types.js';

function makeContext(overrides: Partial<ComplianceContext> = {}): ComplianceContext {
  return {
    tenantId: 'tenant-eu',
    action: 'process_data',
    data: {},
    timestamp: new Date('2026-03-24T12:00:00Z'),
    ...overrides,
  };
}

describe('GDPR Expanded Rules', () => {
  let engine: ComplianceEngine;

  beforeEach(() => {
    engine = new ComplianceEngine();
    engine.registerRules([...GDPR_RULES]);
  });

  it('exports 15 GDPR rules', () => {
    expect(GDPR_RULES).toHaveLength(15);
  });

  // ── Cross-Border Transfer (Art. 44–49) ────────────────────────

  describe('GDPR_CROSS_BORDER_TRANSFER', () => {
    it('passes when destination has adequacy decision', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { destinationCountry: 'jp' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_CROSS_BORDER_TRANSFER');
      expect(rule?.passed).toBe(true);
    });

    it('passes when SCCs are in place', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { destinationCountry: 'cn', sccsInPlace: true } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_CROSS_BORDER_TRANSFER');
      expect(rule?.passed).toBe(true);
    });

    it('fails when destination has no adequacy and no SCCs', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { destinationCountry: 'cn' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_CROSS_BORDER_TRANSFER');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('GDPR-ART44');
    });

    it('passes when no destination country is provided', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_CROSS_BORDER_TRANSFER');
      expect(rule?.passed).toBe(true);
    });

    it('is case-insensitive for country codes', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { destinationCountry: 'JP' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_CROSS_BORDER_TRANSFER');
      expect(rule?.passed).toBe(true);
    });
  });

  // ── Cookie Consent ────────────────────────────────────────────

  describe('GDPR_COOKIE_CONSENT', () => {
    it('passes when cookie consent obtained', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { cookieConsentObtained: true } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_COOKIE_CONSENT');
      expect(rule?.passed).toBe(true);
    });

    it('fails when cookie consent not obtained', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { cookieConsentObtained: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_COOKIE_CONSENT');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('GDPR-EPRIVACY-5-3');
    });

    it('passes when cookie consent field not present', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_COOKIE_CONSENT');
      expect(rule?.passed).toBe(true);
    });
  });

  // ── DPO Appointed (Art. 37) ───────────────────────────────────

  describe('GDPR_DPO_APPOINTED', () => {
    it('passes when DPO is appointed', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { dpoAppointed: true } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_DPO_APPOINTED');
      expect(rule?.passed).toBe(true);
    });

    it('fails when DPO is not appointed', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { dpoAppointed: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_DPO_APPOINTED');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('GDPR-ART37');
    });

    it('passes when dpoAppointed is not provided', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_DPO_APPOINTED');
      expect(rule?.passed).toBe(true);
    });
  });

  // ── Breach Notification 72h (Art. 33) ─────────────────────────

  describe('GDPR_BREACH_NOTIFICATION_72H', () => {
    const now = new Date('2026-03-24T12:00:00Z');

    it('passes when breach reported within 72 hours', () => {
      const detectedAt = now.getTime() - 48 * 60 * 60 * 1000;
      const reportedAt = now.getTime() - 24 * 60 * 60 * 1000;
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({
          timestamp: now,
          data: { breachDetectedAt: detectedAt, breachReportedAt: reportedAt },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_BREACH_NOTIFICATION_72H');
      expect(rule?.passed).toBe(true);
    });

    it('fails when breach reported after 72 hours', () => {
      const detectedAt = now.getTime() - 100 * 60 * 60 * 1000;
      const reportedAt = now.getTime();
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({
          timestamp: now,
          data: { breachDetectedAt: detectedAt, breachReportedAt: reportedAt },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_BREACH_NOTIFICATION_72H');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('GDPR-ART33');
    });

    it('fails when breach detected >72h ago and not reported', () => {
      const detectedAt = now.getTime() - 80 * 60 * 60 * 1000;
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({
          timestamp: now,
          data: { breachDetectedAt: detectedAt },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_BREACH_NOTIFICATION_72H');
      expect(rule?.passed).toBe(false);
    });

    it('passes when breach detected <72h ago and not yet reported', () => {
      const detectedAt = now.getTime() - 48 * 60 * 60 * 1000;
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({
          timestamp: now,
          data: { breachDetectedAt: detectedAt },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_BREACH_NOTIFICATION_72H');
      expect(rule?.passed).toBe(true);
    });

    it('passes when no breach detected', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ timestamp: now, data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_BREACH_NOTIFICATION_72H');
      expect(rule?.passed).toBe(true);
    });
  });

  // ── DPIA Required (Art. 35) ───────────────────────────────────

  describe('GDPR_DPIA_REQUIRED', () => {
    it('passes for standard processing', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { processingType: 'standard' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_DPIA_REQUIRED');
      expect(rule?.passed).toBe(true);
    });

    it('fails for profiling without DPIA', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { processingType: 'profiling' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_DPIA_REQUIRED');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('GDPR-ART35');
    });

    it('passes for profiling with completed DPIA', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { processingType: 'profiling', dpiaCompleted: true } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_DPIA_REQUIRED');
      expect(rule?.passed).toBe(true);
    });

    it('fails for large_scale_monitoring without DPIA', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { processingType: 'large_scale_monitoring' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_DPIA_REQUIRED');
      expect(rule?.passed).toBe(false);
    });

    it('fails for sensitive_data processing without DPIA', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { processingType: 'sensitive_data' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_DPIA_REQUIRED');
      expect(rule?.passed).toBe(false);
    });
  });

  // ── Automated Decision Transparency (Art. 22) ────────────────

  describe('GDPR_AUTOMATED_DECISION_TRANSPARENCY', () => {
    it('passes when no automated decision', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { automatedDecision: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_AUTOMATED_DECISION_TRANSPARENCY');
      expect(rule?.passed).toBe(true);
    });

    it('passes when automated decision with human review', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { automatedDecision: true, humanReviewAvailable: true } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_AUTOMATED_DECISION_TRANSPARENCY');
      expect(rule?.passed).toBe(true);
    });

    it('fails when automated decision without human review', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { automatedDecision: true, humanReviewAvailable: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_AUTOMATED_DECISION_TRANSPARENCY');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('GDPR-ART22');
    });
  });

  // ── Child Consent (Art. 8) ────────────────────────────────────

  describe('GDPR_CHILD_CONSENT', () => {
    it('passes for adults (age >= 16)', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { dataSubjectAge: 18 } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_CHILD_CONSENT');
      expect(rule?.passed).toBe(true);
    });

    it('passes for child with parental consent', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { dataSubjectAge: 12, parentalConsentObtained: true } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_CHILD_CONSENT');
      expect(rule?.passed).toBe(true);
    });

    it('fails for child without parental consent', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { dataSubjectAge: 14 } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_CHILD_CONSENT');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('GDPR-ART8');
      expect(rule?.violation?.message).toContain('14');
    });

    it('passes when age not provided', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_CHILD_CONSENT');
      expect(rule?.passed).toBe(true);
    });
  });

  // ── Purpose Limitation Strict ─────────────────────────────────

  describe('GDPR_PURPOSE_LIMITATION_STRICT', () => {
    it('passes when collection and processing purposes match', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { collectionPurpose: 'marketing', processingPurpose: 'marketing' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_PURPOSE_LIMITATION_STRICT');
      expect(rule?.passed).toBe(true);
    });

    it('fails when purposes mismatch without fresh consent', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { collectionPurpose: 'marketing', processingPurpose: 'analytics' } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_PURPOSE_LIMITATION_STRICT');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('GDPR-ART5-1B-STRICT');
    });

    it('passes when purposes differ but fresh consent obtained', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({
          data: {
            collectionPurpose: 'marketing',
            processingPurpose: 'analytics',
            freshConsentForNewPurpose: true,
          },
        }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_PURPOSE_LIMITATION_STRICT');
      expect(rule?.passed).toBe(true);
    });
  });

  // ── Storage Limitation (Art. 5(1)(e)) ─────────────────────────

  describe('GDPR_STORAGE_LIMITATION', () => {
    it('passes when retention period is defined', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { retentionPeriodDefined: true } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_STORAGE_LIMITATION');
      expect(rule?.passed).toBe(true);
    });

    it('fails when retention period is not defined', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { retentionPeriodDefined: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_STORAGE_LIMITATION');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('GDPR-ART5-1E');
    });

    it('passes when field not present', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: {} }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_STORAGE_LIMITATION');
      expect(rule?.passed).toBe(true);
    });
  });

  // ── Data Portability Available (Art. 20) ──────────────────────

  describe('GDPR_DATA_PORTABILITY_AVAILABLE', () => {
    it('passes when export available on request', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { portabilityRequested: true, machineReadableExportAvailable: true } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_DATA_PORTABILITY_AVAILABLE');
      expect(rule?.passed).toBe(true);
    });

    it('fails when export not available on request', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { portabilityRequested: true, machineReadableExportAvailable: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_DATA_PORTABILITY_AVAILABLE');
      expect(rule?.passed).toBe(false);
      expect(rule?.violation?.code).toBe('GDPR-ART20-EXPORT');
    });

    it('passes when portability not requested', () => {
      const result = engine.evaluateForRegulation(
        'gdpr',
        makeContext({ data: { portabilityRequested: false } }),
      );
      const rule = result.results.find((r) => r.ruleId === 'GDPR_DATA_PORTABILITY_AVAILABLE');
      expect(rule?.passed).toBe(true);
    });
  });
});
