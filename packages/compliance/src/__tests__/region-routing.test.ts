import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceEngine } from '../engine.js';
import { ComplianceGate, REGION_REGULATIONS } from '../gate.js';
import { ALL_RULES } from '../rules/index.js';
import { GDPR_RULES } from '../rules/gdpr.js';
import { PIPEDA_RULES } from '../rules/pipeda.js';
import { LGPD_RULES } from '../rules/lgpd.js';
import type { ComplianceContext } from '../types.js';

function makeContext(overrides: Partial<ComplianceContext> = {}): Omit<ComplianceContext, 'action'> {
  return {
    tenantId: 'tenant-region',
    data: {},
    timestamp: new Date('2026-03-24T12:00:00Z'),
    ...overrides,
  };
}

describe('Region-Based Compliance Routing', () => {
  let engine: ComplianceEngine;
  let gate: ComplianceGate;

  beforeEach(() => {
    engine = new ComplianceEngine();
    engine.registerRules([...ALL_RULES]);
    gate = new ComplianceGate(engine);
  });

  // ── REGION_REGULATIONS mapping ──────────────────────────────────

  describe('REGION_REGULATIONS', () => {
    it('maps eu-west to GDPR', () => {
      expect(REGION_REGULATIONS['eu-west']).toEqual(['gdpr']);
    });

    it('maps eu-central to GDPR', () => {
      expect(REGION_REGULATIONS['eu-central']).toEqual(['gdpr']);
    });

    it('maps ca-central to PIPEDA', () => {
      expect(REGION_REGULATIONS['ca-central']).toEqual(['pipeda']);
    });

    it('maps sa-east to LGPD', () => {
      expect(REGION_REGULATIONS['sa-east']).toEqual(['lgpd']);
    });

    it('does not map us-east', () => {
      expect(REGION_REGULATIONS['us-east']).toBeUndefined();
    });

    it('does not map us-west', () => {
      expect(REGION_REGULATIONS['us-west']).toBeUndefined();
    });

    it('does not map ap-southeast', () => {
      expect(REGION_REGULATIONS['ap-southeast']).toBeUndefined();
    });
  });

  // ── checkWithRegion for EU ──────────────────────────────────────

  describe('EU region -> GDPR', () => {
    it('triggers GDPR rules for eu-west region', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({ data: { legalBasis: 'consent' } }),
        'eu-west',
      );
      const gdprResults = result.results.filter((r) => r.regulation === 'gdpr');
      expect(gdprResults.length).toBeGreaterThan(0);
    });

    it('triggers GDPR rules for eu-central region', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({ data: { legalBasis: 'consent' } }),
        'eu-central',
      );
      const gdprResults = result.results.filter((r) => r.regulation === 'gdpr');
      expect(gdprResults.length).toBeGreaterThan(0);
    });

    it('blocks when GDPR cookie consent is missing in EU region', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({
          data: {
            cookieConsentObtained: false,
          },
        }),
        'eu-west',
      );
      const gdprViolation = result.violations.find(
        (v) => v.ruleId === 'GDPR_COOKIE_CONSENT',
      );
      expect(gdprViolation).toBeDefined();
    });

    it('eu-west result includes GDPR_CONSENT_REQUIRED rule', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({ data: { legalBasis: 'consent' } }),
        'eu-west',
      );
      const consentRule = result.results.find(
        (r) => r.ruleId === 'GDPR_CONSENT_REQUIRED',
      );
      expect(consentRule).toBeDefined();
    });
  });

  // ── checkWithRegion for Canada ──────────────────────────────────

  describe('CA region -> PIPEDA', () => {
    it('triggers PIPEDA rules for ca-central region', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({ data: {} }),
        'ca-central',
      );
      const pipedaResults = result.results.filter((r) => r.regulation === 'pipeda');
      expect(pipedaResults.length).toBeGreaterThan(0);
    });

    it('blocks when PIPEDA consent is not meaningful', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({
          data: {
            consentObtained: true,
            consentInformed: false,
            consentSpecific: true,
          },
        }),
        'ca-central',
      );
      const pipedaViolation = result.violations.find(
        (v) => v.ruleId === 'PIPEDA_MEANINGFUL_CONSENT',
      );
      expect(pipedaViolation).toBeDefined();
    });

    it('captures PIPEDA safeguards violations', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({
          data: { encrypted: false, accessControlled: false },
        }),
        'ca-central',
      );
      const safeguardsViolation = result.results.find(
        (r) => r.ruleId === 'PIPEDA_SAFEGUARDS',
      );
      expect(safeguardsViolation?.passed).toBe(false);
    });
  });

  // ── checkWithRegion for Brazil ──────────────────────────────────

  describe('SA region -> LGPD', () => {
    it('triggers LGPD rules for sa-east region', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({ data: { legalBasis: 'consent' } }),
        'sa-east',
      );
      const lgpdResults = result.results.filter((r) => r.regulation === 'lgpd');
      expect(lgpdResults.length).toBeGreaterThan(0);
    });

    it('blocks when LGPD legal basis is missing', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({ data: {} }),
        'sa-east',
      );
      const lgpdViolation = result.violations.find(
        (v) => v.ruleId === 'LGPD_LEGAL_BASIS',
      );
      expect(lgpdViolation).toBeDefined();
      expect(result.allowed).toBe(false);
    });

    it('captures LGPD international transfer violations', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({
          data: { legalBasis: 'consent', internationalTransfer: true },
        }),
        'sa-east',
      );
      const transferRule = result.results.find(
        (r) => r.ruleId === 'LGPD_INTERNATIONAL_TRANSFER',
      );
      expect(transferRule?.passed).toBe(false);
    });
  });

  // ── checkWithRegion for US (no extra regulations) ───────────────

  describe('US region -> no extra regulations', () => {
    it('us-east returns same result count as standard check', () => {
      const standardResult = gate.check('process_data', makeContext({ data: {} }));
      const regionResult = gate.checkWithRegion(
        'process_data',
        makeContext({ data: {} }),
        'us-east',
      );
      expect(regionResult.results.length).toBe(standardResult.results.length);
    });

    it('us-west returns same result count as standard check', () => {
      const standardResult = gate.check('process_data', makeContext({ data: {} }));
      const regionResult = gate.checkWithRegion(
        'process_data',
        makeContext({ data: {} }),
        'us-west',
      );
      expect(regionResult.results.length).toBe(standardResult.results.length);
    });
  });

  // ── checkWithRegion for unknown region ──────────────────────────

  describe('unknown region', () => {
    it('falls through to standard checks only', () => {
      const standardResult = gate.check('process_data', makeContext({ data: {} }));
      const regionResult = gate.checkWithRegion(
        'process_data',
        makeContext({ data: {} }),
        'unknown-region',
      );
      expect(regionResult.results.length).toBe(standardResult.results.length);
    });

    it('empty string region falls through to standard checks', () => {
      const standardResult = gate.check('process_data', makeContext({ data: {} }));
      const regionResult = gate.checkWithRegion(
        'process_data',
        makeContext({ data: {} }),
        '',
      );
      expect(regionResult.results.length).toBe(standardResult.results.length);
    });
  });

  // ── Combined standard + region checks ───────────────────────────

  describe('combined checks', () => {
    it('runs both standard and region-specific rules for eu-west', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({
          data: {
            cookieConsentObtained: true,
            legalBasis: 'consent',
          },
        }),
        'eu-west',
      );
      const hipaaResults = result.results.filter((r) => r.regulation === 'hipaa');
      const gdprResults = result.results.filter((r) => r.regulation === 'gdpr');
      expect(hipaaResults.length).toBeGreaterThan(0);
      expect(gdprResults.length).toBeGreaterThan(0);
    });

    it('eu-west has at least as many results as standard-only', () => {
      const standardResult = gate.check('process_data', makeContext({ data: {} }));
      const regionResult = gate.checkWithRegion(
        'process_data',
        makeContext({ data: {} }),
        'eu-west',
      );
      expect(regionResult.results.length).toBeGreaterThanOrEqual(
        standardResult.results.length,
      );
    });

    it('region result always includes a timestamp', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({ data: {} }),
        'eu-west',
      );
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('existing check() method still works unchanged', () => {
      const result = gate.check('process_data', makeContext({ data: {} }));
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  // ── No duplicate rule evaluation ────────────────────────────────

  describe('no duplicate rule evaluation', () => {
    it('GDPR rules not duplicated in eu-west results', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({ data: {} }),
        'eu-west',
      );
      const ruleIds = result.results.map((r) => r.ruleId);
      const uniqueIds = new Set(ruleIds);
      expect(uniqueIds.size).toBe(ruleIds.length);
    });

    it('GDPR rules not duplicated in eu-central results', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({ data: {} }),
        'eu-central',
      );
      const ruleIds = result.results.map((r) => r.ruleId);
      const uniqueIds = new Set(ruleIds);
      expect(uniqueIds.size).toBe(ruleIds.length);
    });

    it('PIPEDA rules not duplicated in ca-central results', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({ data: {} }),
        'ca-central',
      );
      const ruleIds = result.results.map((r) => r.ruleId);
      const uniqueIds = new Set(ruleIds);
      expect(uniqueIds.size).toBe(ruleIds.length);
    });

    it('LGPD rules not duplicated in sa-east results', () => {
      const result = gate.checkWithRegion(
        'process_data',
        makeContext({ data: {} }),
        'sa-east',
      );
      const ruleIds = result.results.map((r) => r.ruleId);
      const uniqueIds = new Set(ruleIds);
      expect(uniqueIds.size).toBe(ruleIds.length);
    });
  });
});
