import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceEngine } from '../engine.js';
import { ComplianceGate } from '../gate.js';
import { FDCPA_RULES } from '../rules/fdcpa.js';
import { TCPA_RULES } from '../rules/tcpa.js';
import { HIPAA_RULES } from '../rules/hipaa.js';
import { HIPAA_ENHANCED_RULES } from '../rules/hipaa-enhanced.js';
import { GDPR_RULES } from '../rules/gdpr.js';
import { PIPEDA_RULES } from '../rules/pipeda.js';
import { LGPD_RULES } from '../rules/lgpd.js';
import { ALL_RULES } from '../rules/index.js';
import type { ComplianceContext } from '../types.js';

function makeContext(overrides: Partial<ComplianceContext> = {}): ComplianceContext {
  return {
    tenantId: 'tenant-gate',
    action: 'send_message',
    data: {},
    timestamp: new Date('2026-03-24T14:00:00Z'),
    timezone: 'America/New_York',
    ...overrides,
  };
}

describe('ComplianceGate', () => {
  let engine: ComplianceEngine;
  let gate: ComplianceGate;

  beforeEach(() => {
    engine = new ComplianceEngine();
    engine.registerRules([...ALL_RULES]);
    gate = new ComplianceGate(engine);
  });

  // ── Basic Gate Checks ──────────────────────────────────────

  it('blocks non-compliant actions', () => {
    const result = gate.check('access_phi', {
      tenantId: 'tenant-gate',
      data: { encrypted: false },
      timestamp: new Date('2026-03-24T14:00:00Z'),
    });

    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('allows compliant actions', () => {
    const result = gate.check('access_phi', {
      tenantId: 'tenant-gate',
      data: {
        auditTrailId: 'audit-001',
        encrypted: true,
        accessControlled: true,
        localHour: 14,
        miniMirandaIncluded: true,
        legalBasis: 'contract',
      },
      timestamp: new Date('2026-03-24T14:00:00Z'),
    });

    expect(result.allowed).toBe(true);
  });

  it('gate result includes timestamp', () => {
    const result = gate.check('test', {
      tenantId: 'tenant-gate',
      data: {
        auditTrailId: 'a',
        encrypted: true,
        legalBasis: 'consent',
        localHour: 14,
        miniMirandaIncluded: true,
      },
      timestamp: new Date(),
    });

    expect(result.timestamp).toBeInstanceOf(Date);
  });

  // ── isContactAllowed ───────────────────────────────────────

  describe('isContactAllowed', () => {
    let fdcpaEngine: ComplianceEngine;
    let fdcpaGate: ComplianceGate;

    beforeEach(() => {
      fdcpaEngine = new ComplianceEngine();
      fdcpaEngine.registerRules([...FDCPA_RULES]);
      fdcpaGate = new ComplianceGate(fdcpaEngine);
    });

    it('blocks contact when FDCPA frequency limit exceeded', () => {
      const result = fdcpaGate.isContactAllowed(
        'customer-1',
        'tenant-gate',
        8,                 // 8 attempts in last 7 days
        new Date(),
        'America/New_York',
      );

      expect(result.allowed).toBe(false);
      const freqViolation = result.violations.find(
        (v) => v.ruleId === 'FDCPA_CONTACT_FREQUENCY',
      );
      expect(freqViolation).toBeDefined();
    });

    it('allows contact with low frequency within hours', () => {
      // Use a timezone where the current test execution is likely within 8AM-9PM
      // We pass America/New_York; the localHour is computed dynamically.
      // For determinism, test with a separate engine evaluation.
      const result = fdcpaEngine.evaluateForRegulation('fdcpa', {
        tenantId: 'tenant-gate',
        customerId: 'customer-2',
        action: 'outbound_contact',
        channel: 'phone',
        data: {
          contactAttemptsLast7Days: 2,
          localHour: 14,
          miniMirandaIncluded: true,
        },
        timestamp: new Date(),
        timezone: 'America/New_York',
      });

      expect(result.allowed).toBe(true);
    });

    it('handles null lastContactAt', () => {
      const result = fdcpaGate.isContactAllowed(
        'customer-3',
        'tenant-gate',
        0,
        null,
        'America/Chicago',
      );

      // With 0 attempts and valid timezone, frequency passes.
      // Timing depends on when the test runs, so we only check it returns a result.
      expect(result.results.length).toBeGreaterThan(0);
    });
  });

  // ── Channel-Specific Routing ───────────────────────────────

  describe('checkForChannel', () => {
    it('routes SMS to TCPA rules', () => {
      const tcpaEngine = new ComplianceEngine();
      tcpaEngine.registerRules([...TCPA_RULES]);
      const tcpaGate = new ComplianceGate(tcpaEngine);

      const result = tcpaGate.checkForChannel(
        'sms',
        makeContext({
          channel: 'sms',
          data: {
            isAutodialed: true,
            priorExpressConsent: false,
            localHour: 14,
          },
        }),
      );

      expect(result.allowed).toBe(false);
      const tcpaViolation = result.violations.find(
        (v) => v.regulation === 'tcpa',
      );
      expect(tcpaViolation).toBeDefined();
    });

    it('routes voice to TCPA + FDCPA rules', () => {
      const result = gate.checkForChannel(
        'voice',
        makeContext({
          channel: 'voice',
          data: {
            isAutodialed: true,
            priorExpressConsent: false,
            contactAttemptsLast7Days: 8,
            localHour: 14,
            miniMirandaIncluded: true,
          },
        }),
      );

      expect(result.allowed).toBe(false);
      const regulations = result.violations.map((v) => v.regulation);
      expect(regulations).toContain('tcpa');
      expect(regulations).toContain('fdcpa');
    });

    it('routes email to GDPR rules', () => {
      const result = gate.checkForChannel(
        'email',
        makeContext({
          channel: 'email',
          data: {},
        }),
      );

      // GDPR_CONSENT_REQUIRED should fire (no legalBasis provided)
      const gdprViolation = result.violations.find(
        (v) => v.regulation === 'gdpr',
      );
      expect(gdprViolation).toBeDefined();
    });

    it('falls back to all rules for unknown channels', () => {
      const result = gate.checkForChannel(
        'pigeon',
        makeContext({
          channel: 'pigeon',
          data: { encrypted: false },
        }),
      );

      // Should evaluate all rules since "pigeon" is unknown
      expect(result.results.length).toBeGreaterThan(5);
    });

    it('allows compliant SMS through the gate', () => {
      const tcpaEngine = new ComplianceEngine();
      tcpaEngine.registerRules([...TCPA_RULES]);
      const tcpaGate = new ComplianceGate(tcpaEngine);

      const result = tcpaGate.checkForChannel(
        'sms',
        makeContext({
          channel: 'sms',
          data: {
            isAutodialed: true,
            priorExpressConsent: true,
            isOnDncList: false,
            consumerOptedOut: false,
            localHour: 14,
          },
        }),
      );

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  // ── ALL_RULES integration ──────────────────────────────────

  it('ALL_RULES contains rules from all regulations', () => {
    const regulations = new Set(ALL_RULES.map((r) => r.regulation));
    expect(regulations.has('hipaa')).toBe(true);
    expect(regulations.has('fdcpa')).toBe(true);
    expect(regulations.has('tcpa')).toBe(true);
    expect(regulations.has('gdpr')).toBe(true);
    expect(regulations.has('pipeda')).toBe(true);
    expect(regulations.has('lgpd')).toBe(true);
  });

  it('ALL_RULES total count is correct', () => {
    const expected =
      HIPAA_RULES.length +
      HIPAA_ENHANCED_RULES.length +
      FDCPA_RULES.length +
      TCPA_RULES.length +
      GDPR_RULES.length +
      PIPEDA_RULES.length +
      LGPD_RULES.length;
    expect(ALL_RULES).toHaveLength(expected);
  });
});
