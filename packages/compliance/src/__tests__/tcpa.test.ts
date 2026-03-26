import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceEngine } from '../engine.js';
import { TCPA_RULES } from '../rules/tcpa.js';
import type { ComplianceContext } from '../types.js';

function makeContext(overrides: Partial<ComplianceContext> = {}): ComplianceContext {
  return {
    tenantId: 'tenant-telecom',
    action: 'send_sms',
    channel: 'sms',
    data: {},
    timestamp: new Date('2026-03-24T14:00:00Z'),
    timezone: 'America/Chicago',
    ...overrides,
  };
}

describe('TCPA Rules', () => {
  let engine: ComplianceEngine;

  beforeEach(() => {
    engine = new ComplianceEngine();
    engine.registerRules([...TCPA_RULES]);
  });

  it('exports 5 TCPA rules', () => {
    expect(TCPA_RULES).toHaveLength(5);
  });

  // ── Prior Express Consent ──────────────────────────────────

  it('blocks autodialed SMS without consent', () => {
    const result = engine.evaluateForRegulation(
      'tcpa',
      makeContext({
        data: {
          isAutodialed: true,
          priorExpressConsent: false,
          localHour: 14,
        },
      }),
    );

    const consent = result.results.find(
      (r) => r.ruleId === 'TCPA_PRIOR_EXPRESS_CONSENT',
    );
    expect(consent?.passed).toBe(false);
    expect(consent?.violation?.code).toBe('TCPA-227-B1');
    expect(result.allowed).toBe(false);
  });

  it('allows autodialed SMS with consent', () => {
    const result = engine.evaluateForRegulation(
      'tcpa',
      makeContext({
        data: {
          isAutodialed: true,
          priorExpressConsent: true,
          localHour: 14,
        },
      }),
    );

    const consent = result.results.find(
      (r) => r.ruleId === 'TCPA_PRIOR_EXPRESS_CONSENT',
    );
    expect(consent?.passed).toBe(true);
  });

  it('passes when contact is not autodialed regardless of consent', () => {
    const result = engine.evaluateForRegulation(
      'tcpa',
      makeContext({
        data: {
          isAutodialed: false,
          priorExpressConsent: false,
          localHour: 14,
        },
      }),
    );

    const consent = result.results.find(
      (r) => r.ruleId === 'TCPA_PRIOR_EXPRESS_CONSENT',
    );
    expect(consent?.passed).toBe(true);
  });

  // ── Do-Not-Call ────────────────────────────────────────────

  it('blocks contact to DNC number', () => {
    const result = engine.evaluateForRegulation(
      'tcpa',
      makeContext({
        data: { isOnDncList: true, localHour: 14 },
      }),
    );

    const dnc = result.results.find(
      (r) => r.ruleId === 'TCPA_DNC_CHECK',
    );
    expect(dnc?.passed).toBe(false);
    expect(dnc?.violation?.code).toBe('TCPA-64.1200-C2');
    expect(result.allowed).toBe(false);
  });

  it('allows contact to non-DNC number', () => {
    const result = engine.evaluateForRegulation(
      'tcpa',
      makeContext({
        data: { isOnDncList: false, localHour: 14 },
      }),
    );

    const dnc = result.results.find(
      (r) => r.ruleId === 'TCPA_DNC_CHECK',
    );
    expect(dnc?.passed).toBe(true);
  });

  // ── Opt-Out ────────────────────────────────────────────────

  it('blocks contact when consumer has opted out', () => {
    const result = engine.evaluateForRegulation(
      'tcpa',
      makeContext({
        data: { consumerOptedOut: true, localHour: 14 },
      }),
    );

    const optOut = result.results.find(
      (r) => r.ruleId === 'TCPA_OPT_OUT',
    );
    expect(optOut?.passed).toBe(false);
    expect(optOut?.violation?.code).toBe('TCPA-64.1200-D');
    expect(result.allowed).toBe(false);
  });

  it('allows contact when consumer has not opted out', () => {
    const result = engine.evaluateForRegulation(
      'tcpa',
      makeContext({
        data: { consumerOptedOut: false, localHour: 14 },
      }),
    );

    const optOut = result.results.find(
      (r) => r.ruleId === 'TCPA_OPT_OUT',
    );
    expect(optOut?.passed).toBe(true);
  });

  // ── Caller ID ──────────────────────────────────────────────

  it('fails when voice call lacks caller ID', () => {
    const result = engine.evaluateForRegulation(
      'tcpa',
      makeContext({
        channel: 'voice',
        data: { callerIdProvided: false, localHour: 14 },
      }),
    );

    const callerId = result.results.find(
      (r) => r.ruleId === 'TCPA_CALLER_ID',
    );
    expect(callerId?.passed).toBe(false);
    expect(callerId?.violation?.code).toBe('TCPA-64.1200-B');
  });

  it('skips caller ID check for non-voice channels', () => {
    const result = engine.evaluateForRegulation(
      'tcpa',
      makeContext({
        channel: 'sms',
        data: { callerIdProvided: false, localHour: 14 },
      }),
    );

    const callerId = result.results.find(
      (r) => r.ruleId === 'TCPA_CALLER_ID',
    );
    expect(callerId?.passed).toBe(true);
  });

  // ── Time Restrictions ──────────────────────────────────────

  it('blocks calls before 8AM local time', () => {
    const result = engine.evaluateForRegulation(
      'tcpa',
      makeContext({
        data: { localHour: 6 },
      }),
    );

    const time = result.results.find(
      (r) => r.ruleId === 'TCPA_TIME_RESTRICTIONS',
    );
    expect(time?.passed).toBe(false);
    expect(time?.violation?.code).toBe('TCPA-64.1200-C1');
  });

  it('blocks calls after 9PM local time', () => {
    const result = engine.evaluateForRegulation(
      'tcpa',
      makeContext({
        data: { localHour: 22 },
      }),
    );

    const time = result.results.find(
      (r) => r.ruleId === 'TCPA_TIME_RESTRICTIONS',
    );
    expect(time?.passed).toBe(false);
  });

  // ── Valid consented contact ────────────────────────────────

  it('allows valid consented contact with all checks passing', () => {
    const result = engine.evaluateForRegulation(
      'tcpa',
      makeContext({
        channel: 'voice',
        data: {
          isAutodialed: true,
          priorExpressConsent: true,
          isOnDncList: false,
          consumerOptedOut: false,
          callerIdProvided: true,
          localHour: 14,
        },
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.results.every((r) => r.passed)).toBe(true);
  });
});
