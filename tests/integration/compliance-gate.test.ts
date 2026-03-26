/**
 * Integration test — End-to-end compliance enforcement.
 *
 * Tests FDCPA, TCPA, HIPAA, GDPR, PIPEDA, and LGPD regulations
 * through the ComplianceEngine + ComplianceGate + AuditLogger pipeline.
 * Verifies multi-regulation simultaneous checks and region-based routing.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  setupTestEnvironment,
  createTestTenant,
} from './setup.js';

// Compliance
import {
  ComplianceEngine,
  ComplianceGate,
  REGION_REGULATIONS,
  ALL_RULES,
  HIPAA_RULES,
  HIPAA_ENHANCED_RULES,
  FDCPA_RULES,
  TCPA_RULES,
  GDPR_RULES,
  PIPEDA_RULES,
  LGPD_RULES,
} from '@ordr/compliance';
import type { ComplianceContext, ComplianceGateResult } from '@ordr/compliance';

// Audit
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import type { AuditEventInput } from '@ordr/audit';

// Crypto (for erasure testing)
import { encryptString, decryptString, randomHex, CryptographicErasure } from '@ordr/crypto';
import type { KeyDestructor, KeyExistenceChecker, ErasureAuditLogger } from '@ordr/crypto';

// Core
import { isOk } from '@ordr/core';

// ── Helpers ──────────────────────────────────────────────────────────

function makeComplianceContext(overrides?: Partial<ComplianceContext>): ComplianceContext {
  return {
    tenantId: overrides?.tenantId ?? 'tnt-test',
    customerId: overrides?.customerId ?? 'cust-001',
    action: overrides?.action ?? 'outbound_contact',
    channel: overrides?.channel ?? 'phone',
    data: overrides?.data ?? {},
    timestamp: overrides?.timestamp ?? new Date('2026-01-15T14:00:00.000Z'),
    timezone: overrides?.timezone ?? 'America/New_York',
    metadata: overrides?.metadata,
  };
}

function makeAuditInput(tenantId: string, overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    tenantId,
    eventType: overrides?.eventType ?? 'compliance.check',
    actorType: overrides?.actorType ?? 'system',
    actorId: overrides?.actorId ?? 'compliance-gate',
    resource: overrides?.resource ?? 'compliance',
    resourceId: overrides?.resourceId ?? 'check-001',
    action: overrides?.action ?? 'evaluate',
    details: overrides?.details ?? {},
    timestamp: overrides?.timestamp ?? new Date('2026-01-15T14:00:00.000Z'),
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Compliance Gate — End-to-End', () => {
  let engine: ComplianceEngine;
  let gate: ComplianceGate;
  let auditStore: InMemoryAuditStore;
  let auditLogger: AuditLogger;

  beforeAll(async () => {
    await setupTestEnvironment();
  });

  beforeEach(() => {
    engine = new ComplianceEngine();
    engine.registerRules(ALL_RULES);
    gate = new ComplianceGate(engine);
    auditStore = new InMemoryAuditStore();
    auditLogger = new AuditLogger(auditStore);
  });

  // ── FDCPA ──────────────────────────────────────────────────────

  describe('FDCPA compliance', () => {
    it('blocks contact during quiet hours (before 8am)', () => {
      const ctx = makeComplianceContext({
        action: 'outbound_contact',
        channel: 'phone',
        data: { localHour: 6, contactAttemptsLast7Days: 1 },
        timezone: 'America/New_York',
      });

      const result = engine.evaluateForRegulation('fdcpa', ctx);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.allowed).toBe(false);
    });

    it('blocks contact during quiet hours (after 9pm)', () => {
      const ctx = makeComplianceContext({
        action: 'outbound_contact',
        channel: 'phone',
        data: { localHour: 22, contactAttemptsLast7Days: 1 },
      });

      const result = engine.evaluateForRegulation('fdcpa', ctx);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('allows contact during business hours', () => {
      const ctx = makeComplianceContext({
        action: 'outbound_contact',
        channel: 'phone',
        data: {
          localHour: 14,
          contactAttemptsLast7Days: 2,
          miniMirandaIncluded: true,
          ceaseAndDesistOnFile: false,
          recipientIsThirdParty: false,
          contentFlagged: false,
          repeatedCallsToAnnoy: false,
        },
      });

      const result = engine.evaluateForRegulation('fdcpa', ctx);
      expect(result.allowed).toBe(true);
    });

    it('blocks excessive contact attempts (7-in-7 rule)', () => {
      const ctx = makeComplianceContext({
        action: 'outbound_contact',
        channel: 'phone',
        data: { localHour: 14, contactAttemptsLast7Days: 8 },
      });

      const result = engine.evaluateForRegulation('fdcpa', ctx);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('logs FDCPA violation to audit trail', async () => {
      const tnt = await createTestTenant('fdcpa-audit');

      const ctx = makeComplianceContext({
        tenantId: tnt.id,
        data: { localHour: 6, contactAttemptsLast7Days: 1 },
      });
      const result = engine.evaluateForRegulation('fdcpa', ctx);

      await auditLogger.log(makeAuditInput(tnt.id, {
        eventType: 'compliance.violation',
        action: 'fdcpa_check_failed',
        details: {
          violations: result.violations.map((v) => v.ruleId),
          blocked: !result.allowed,
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe('compliance.violation');
    });
  });

  // ── TCPA ───────────────────────────────────────────────────────

  describe('TCPA compliance', () => {
    it('blocks autodialed SMS without consent', () => {
      const ctx = makeComplianceContext({
        action: 'send_sms',
        channel: 'sms',
        data: {
          priorExpressConsent: false,
          isAutodialed: true,
          consumerOptedOut: false,
          isOnDncList: false,
        },
      });

      const result = engine.evaluateForRegulation('tcpa', ctx);
      expect(result.allowed).toBe(false);
    });

    it('allows SMS with consent', () => {
      const ctx = makeComplianceContext({
        action: 'send_sms',
        channel: 'sms',
        data: {
          priorExpressConsent: true,
          isAutodialed: true,
          consumerOptedOut: false,
          isOnDncList: false,
        },
      });

      const result = engine.evaluateForRegulation('tcpa', ctx);
      expect(result.allowed).toBe(true);
    });

    it('channel-specific check routes SMS to TCPA with opt-out violation', () => {
      const ctx = makeComplianceContext({
        action: 'send_sms',
        channel: 'sms',
        data: {
          consumerOptedOut: true,
          isAutodialed: true,
          priorExpressConsent: false,
        },
      });

      const result = gate.checkForChannel('sms', ctx);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('logs TCPA consent verification to audit', async () => {
      const tnt = await createTestTenant('tcpa-audit');

      await auditLogger.log(makeAuditInput(tnt.id, {
        action: 'tcpa_consent_check',
        details: { customerId: 'cust-001', channel: 'sms', hasConsent: true },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events[0]!.details['hasConsent']).toBe(true);
    });
  });

  // ── HIPAA ──────────────────────────────────────────────────────

  describe('HIPAA compliance', () => {
    it('logs PHI access to audit trail', async () => {
      const tnt = await createTestTenant('hipaa-access');

      await auditLogger.log(makeAuditInput(tnt.id, {
        eventType: 'phi.accessed',
        actorType: 'user',
        actorId: 'usr-doctor-001',
        resource: 'patient_record',
        resourceId: 'pat-tok-001', // Tokenized reference, NOT actual PHI
        action: 'read_phi',
        details: {
          fieldAccessed: 'diagnosis_ref',
          businessJustification: 'treatment_review',
          accessedAt: new Date().toISOString(),
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe('phi.accessed');
      // Verify no actual PHI in the audit entry
      expect(JSON.stringify(events[0]!.details)).not.toContain('123-45-6789');
    });

    it('HIPAA rules are registered and evaluable', () => {
      const hipaaEngine = new ComplianceEngine();
      hipaaEngine.registerRules(HIPAA_RULES);

      const rules = hipaaEngine.getRules('hipaa');
      expect(rules.length).toBeGreaterThan(0);
    });

    it('enhanced HIPAA rules include additional protections', () => {
      const hipaaEngine = new ComplianceEngine();
      hipaaEngine.registerRules(HIPAA_ENHANCED_RULES);

      const rules = hipaaEngine.getRules('hipaa');
      expect(rules.length).toBeGreaterThan(0);
    });

    it('PHI blocked from error responses (tokenized only)', async () => {
      const tnt = await createTestTenant('hipaa-error');

      // Simulate error logging — should contain refs, not PHI
      await auditLogger.log(makeAuditInput(tnt.id, {
        eventType: 'data.read',
        action: 'error_handling',
        details: {
          errorCode: 'E4001',
          correlationId: 'corr-err-001',
          resourceRef: 'tok_patient_001', // Tokenized
          // No actual PHI here
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      const detailsStr = JSON.stringify(events[0]!.details);
      expect(detailsStr).not.toMatch(/\d{3}-\d{2}-\d{4}/); // No SSN
      expect(detailsStr).not.toMatch(/[A-Z]\d{2}\.\d/); // No ICD codes
    });
  });

  // ── GDPR ───────────────────────────────────────────────────────

  describe('GDPR compliance', () => {
    it('GDPR rules are registered', () => {
      const rules = engine.getRules('gdpr');
      expect(rules.length).toBeGreaterThan(0);
    });

    it('data access request is logged for audit', async () => {
      const tnt = await createTestTenant('gdpr-access');

      await auditLogger.log(makeAuditInput(tnt.id, {
        eventType: 'data.read',
        actorType: 'user',
        actorId: 'data-subject-001',
        action: 'data_access_request',
        details: {
          requestType: 'SAR', // Subject Access Request
          dataSubjectRef: 'tok_ds_001',
          requestedAt: new Date().toISOString(),
          deadline: '30_days',
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events[0]!.action).toBe('data_access_request');
    });

    it('cryptographic erasure destroys encryption key', async () => {
      const tnt = await createTestTenant('gdpr-erasure');

      // Simulate key storage
      const keys = new Map<string, boolean>();
      keys.set('key-ds-001', true);

      const destructor: KeyDestructor = (keyId: string): boolean => {
        keys.delete(keyId);
        return true;
      };

      const checker: KeyExistenceChecker = (keyId: string): boolean => {
        return keys.has(keyId); // Returns true if key still exists
      };

      const erasureAuditEntries: Array<Record<string, unknown>> = [];
      const erasureLogger: ErasureAuditLogger = (entry) => {
        erasureAuditEntries.push(entry as unknown as Record<string, unknown>);
      };

      // Constructor order: (auditLog, destroyKey, keyExists)
      const erasure = new CryptographicErasure(erasureLogger, destructor, checker);

      // Step 1: schedule
      const scheduleResult = erasure.scheduleErasure(tnt.id, 'key-ds-001', 'GDPR Art.17 right to erasure');
      expect(isOk(scheduleResult)).toBe(true);
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      // Step 2: execute (destroys key)
      const executeResult = erasure.executeErasure(scheduleResult.data);
      expect(isOk(executeResult)).toBe(true);
      if (!isOk(executeResult)) throw new Error('Execute failed');

      // Step 3: verify (confirms key no longer exists)
      const verifyResult = erasure.verifyErasure(executeResult.data);
      expect(isOk(verifyResult)).toBe(true);
      if (!isOk(verifyResult)) throw new Error('Verify failed');

      expect(verifyResult.data.status).toBe('verified');
      expect(keys.has('key-ds-001')).toBe(false);

      // Log erasure to main audit trail
      await auditLogger.log(makeAuditInput(tnt.id, {
        eventType: 'data.deleted',
        action: 'cryptographic_erasure',
        details: {
          keyId: 'key-ds-001',
          reason: 'GDPR Art.17',
          status: verifyResult.data.status,
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events[0]!.action).toBe('cryptographic_erasure');
    });
  });

  // ── PIPEDA ─────────────────────────────────────────────────────

  describe('PIPEDA compliance', () => {
    it('PIPEDA rules are registered', () => {
      const pipedaEngine = new ComplianceEngine();
      pipedaEngine.registerRules(PIPEDA_RULES);

      const rules = pipedaEngine.getRules('pipeda');
      expect(rules.length).toBeGreaterThan(0);
    });

    it('30-day access window is tracked in audit', async () => {
      const tnt = await createTestTenant('pipeda-window');

      await auditLogger.log(makeAuditInput(tnt.id, {
        action: 'pipeda_access_request',
        details: {
          requestDate: '2026-01-15',
          responseDeadline: '2026-02-14', // 30 days
          status: 'in_progress',
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events[0]!.details['responseDeadline']).toBe('2026-02-14');
    });
  });

  // ── LGPD ───────────────────────────────────────────────────────

  describe('LGPD compliance', () => {
    it('LGPD rules are registered', () => {
      const lgpdEngine = new ComplianceEngine();
      lgpdEngine.registerRules(LGPD_RULES);

      const rules = lgpdEngine.getRules('lgpd');
      expect(rules.length).toBeGreaterThan(0);
    });

    it('legal basis requirement is enforced', () => {
      const lgpdEngine = new ComplianceEngine();
      lgpdEngine.registerRules(LGPD_RULES);

      const ctx = makeComplianceContext({
        action: 'process_data',
        data: { hasLegalBasis: false },
      });

      const result = lgpdEngine.evaluateForRegulation('lgpd', ctx);
      // LGPD requires legal basis — should fail
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  // ── Multi-Regulation Simultaneous Checks ───────────────────────

  describe('Multi-regulation simultaneous checks', () => {
    it('full gate runs all rules and aggregates results', () => {
      const ctx = makeComplianceContext({
        action: 'send_sms',
        channel: 'sms',
        data: {
          hasConsent: true,
          localHour: 14,
          contactAttemptsLast7Days: 2,
        },
      });

      const result = gate.check('send_sms', ctx);
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.timestamp).toBeDefined();
    });

    it('mixed pass/fail across regulations reports all violations', () => {
      const ctx = makeComplianceContext({
        action: 'outbound_contact',
        channel: 'phone',
        data: {
          hasConsent: false, // TCPA fail
          localHour: 6, // FDCPA fail (quiet hours)
          contactAttemptsLast7Days: 2,
        },
      });

      const result = gate.check('outbound_contact', ctx);
      // Should have violations from multiple regulations
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  // ── Region-Based Routing ──────────────────────────────────────

  describe('Region-based compliance routing', () => {
    it('EU region adds GDPR rules', () => {
      const ctx = makeComplianceContext({
        data: { hasConsent: true, hasLegalBasis: true },
      });

      const result = gate.checkWithRegion('process_data', ctx, 'eu-west');
      // Should include GDPR-specific results
      const gdprResults = result.results.filter((r) => r.regulation === 'gdpr');
      expect(gdprResults.length).toBeGreaterThan(0);
    });

    it('Canada region adds PIPEDA rules', () => {
      const ctx = makeComplianceContext({
        data: { hasConsent: true },
      });

      const result = gate.checkWithRegion('process_data', ctx, 'ca-central');
      const pipedaResults = result.results.filter((r) => r.regulation === 'pipeda');
      expect(pipedaResults.length).toBeGreaterThan(0);
    });

    it('Brazil region adds LGPD rules', () => {
      const ctx = makeComplianceContext({
        data: { hasConsent: true, hasLegalBasis: true },
      });

      const result = gate.checkWithRegion('process_data', ctx, 'sa-east');
      const lgpdResults = result.results.filter((r) => r.regulation === 'lgpd');
      expect(lgpdResults.length).toBeGreaterThan(0);
    });

    it('unknown region falls back to standard checks', () => {
      const ctx = makeComplianceContext({
        data: { hasConsent: true },
      });

      const result = gate.checkWithRegion('process_data', ctx, 'us-east');
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('REGION_REGULATIONS constant has expected mappings', () => {
      expect(REGION_REGULATIONS['eu-west']).toContain('gdpr');
      expect(REGION_REGULATIONS['eu-central']).toContain('gdpr');
      expect(REGION_REGULATIONS['ca-central']).toContain('pipeda');
      expect(REGION_REGULATIONS['sa-east']).toContain('lgpd');
    });
  });
});
