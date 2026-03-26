import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceEngine } from '../engine.js';
import type {
  ComplianceContext,
  ComplianceRule,
  Regulation,
} from '../types.js';

// ── Helpers ────────────────────────────────────────────────────

function makeContext(overrides: Partial<ComplianceContext> = {}): ComplianceContext {
  return {
    tenantId: 'tenant-1',
    action: 'test_action',
    data: {},
    timestamp: new Date('2026-03-24T12:00:00Z'),
    ...overrides,
  };
}

function makeRule(
  overrides: Partial<ComplianceRule> & { id: string },
): ComplianceRule {
  return {
    regulation: 'hipaa' as Regulation,
    name: 'Test Rule',
    description: 'A test rule.',
    severity: 'high',
    evaluate: () => ({
      ruleId: overrides.id,
      regulation: overrides.regulation ?? 'hipaa',
      passed: true,
    }),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('ComplianceEngine', () => {
  let engine: ComplianceEngine;

  beforeEach(() => {
    engine = new ComplianceEngine();
  });

  it('registers and evaluates rules', () => {
    const rule = makeRule({ id: 'TEST_RULE_1' });
    engine.registerRule(rule);

    const result = engine.evaluate(makeContext());

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.ruleId).toBe('TEST_RULE_1');
    expect(result.results[0]?.passed).toBe(true);
  });

  it('registers multiple rules via registerRules', () => {
    engine.registerRules([
      makeRule({ id: 'RULE_A' }),
      makeRule({ id: 'RULE_B' }),
      makeRule({ id: 'RULE_C' }),
    ]);

    expect(engine.getRules()).toHaveLength(3);
  });

  it('blocks action when a critical violation occurs', () => {
    engine.registerRule(
      makeRule({
        id: 'CRITICAL_FAIL',
        severity: 'critical',
        evaluate: (ctx) => ({
          ruleId: 'CRITICAL_FAIL',
          regulation: 'hipaa',
          passed: false,
          violation: {
            code: 'CRIT-001',
            message: 'Critical failure',
            severity: 'critical',
            remediation: 'Fix it.',
          },
        }),
      }),
    );

    const result = engine.evaluate(makeContext());

    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.violation?.severity).toBe('critical');
  });

  it('blocks action when a high-severity violation occurs', () => {
    engine.registerRule(
      makeRule({
        id: 'HIGH_FAIL',
        severity: 'high',
        evaluate: () => ({
          ruleId: 'HIGH_FAIL',
          regulation: 'fdcpa',
          passed: false,
          violation: {
            code: 'HIGH-001',
            message: 'High failure',
            severity: 'high',
            remediation: 'Fix it.',
          },
        }),
      }),
    );

    const result = engine.evaluate(makeContext());
    expect(result.allowed).toBe(false);
  });

  it('allows action when only medium/low violations exist', () => {
    engine.registerRule(
      makeRule({
        id: 'MEDIUM_FAIL',
        severity: 'medium',
        evaluate: () => ({
          ruleId: 'MEDIUM_FAIL',
          regulation: 'gdpr',
          passed: false,
          violation: {
            code: 'MED-001',
            message: 'Medium issue',
            severity: 'medium',
            remediation: 'Improve it.',
          },
        }),
      }),
    );

    const result = engine.evaluate(makeContext());
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(1);
  });

  it('evaluates multiple regulations simultaneously', () => {
    engine.registerRule(
      makeRule({ id: 'HIPAA_1', regulation: 'hipaa' }),
    );
    engine.registerRule(
      makeRule({ id: 'FDCPA_1', regulation: 'fdcpa' }),
    );
    engine.registerRule(
      makeRule({ id: 'TCPA_1', regulation: 'tcpa' }),
    );

    const result = engine.evaluate(makeContext());

    expect(result.results).toHaveLength(3);
    const regulations = result.results.map((r) => r.regulation);
    expect(regulations).toContain('hipaa');
    expect(regulations).toContain('fdcpa');
    expect(regulations).toContain('tcpa');
  });

  it('filters by regulation with evaluateForRegulation', () => {
    engine.registerRule(makeRule({ id: 'H1', regulation: 'hipaa' }));
    engine.registerRule(makeRule({ id: 'F1', regulation: 'fdcpa' }));
    engine.registerRule(makeRule({ id: 'T1', regulation: 'tcpa' }));

    const hipaaResult = engine.evaluateForRegulation('hipaa', makeContext());
    expect(hipaaResult.results).toHaveLength(1);
    expect(hipaaResult.results[0]?.regulation).toBe('hipaa');
  });

  it('getRules filters by regulation', () => {
    engine.registerRules([
      makeRule({ id: 'H1', regulation: 'hipaa' }),
      makeRule({ id: 'H2', regulation: 'hipaa' }),
      makeRule({ id: 'F1', regulation: 'fdcpa' }),
    ]);

    expect(engine.getRules('hipaa')).toHaveLength(2);
    expect(engine.getRules('fdcpa')).toHaveLength(1);
    expect(engine.getRules('tcpa')).toHaveLength(0);
    expect(engine.getRules()).toHaveLength(3);
  });

  it('returns allowed=true with no violations', () => {
    engine.registerRules([
      makeRule({ id: 'PASS_1' }),
      makeRule({ id: 'PASS_2' }),
    ]);

    const result = engine.evaluate(makeContext());

    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.results).toHaveLength(2);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it('executes critical rules before low rules', () => {
    const executionOrder: string[] = [];

    engine.registerRule(
      makeRule({
        id: 'LOW_RULE',
        severity: 'low',
        evaluate: () => {
          executionOrder.push('LOW_RULE');
          return { ruleId: 'LOW_RULE', regulation: 'hipaa', passed: true };
        },
      }),
    );
    engine.registerRule(
      makeRule({
        id: 'CRITICAL_RULE',
        severity: 'critical',
        evaluate: () => {
          executionOrder.push('CRITICAL_RULE');
          return { ruleId: 'CRITICAL_RULE', regulation: 'hipaa', passed: true };
        },
      }),
    );

    engine.evaluate(makeContext());

    expect(executionOrder[0]).toBe('CRITICAL_RULE');
    expect(executionOrder[1]).toBe('LOW_RULE');
  });

  it('deduplicates rules by ID', () => {
    engine.registerRule(makeRule({ id: 'DUPE', name: 'Version 1' }));
    engine.registerRule(makeRule({ id: 'DUPE', name: 'Version 2' }));

    expect(engine.getRules()).toHaveLength(1);
    expect(engine.getRules()[0]?.name).toBe('Version 2');
  });

  it('evaluates in sub-100ms for 100 rules', () => {
    const rules = Array.from({ length: 100 }, (_, i) =>
      makeRule({ id: `PERF_RULE_${i}` }),
    );
    engine.registerRules(rules);

    const start = performance.now();
    engine.evaluate(makeContext());
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});
