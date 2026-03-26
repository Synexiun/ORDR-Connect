import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceEngine } from '../engine.js';
import { FDCPA_RULES } from '../rules/fdcpa.js';
import type { ComplianceContext } from '../types.js';

function makeContext(overrides: Partial<ComplianceContext> = {}): ComplianceContext {
  return {
    tenantId: 'tenant-collections',
    action: 'outbound_contact',
    data: {},
    timestamp: new Date('2026-03-24T14:00:00Z'),
    timezone: 'America/New_York',
    ...overrides,
  };
}

describe('FDCPA Rules', () => {
  let engine: ComplianceEngine;

  beforeEach(() => {
    engine = new ComplianceEngine();
    engine.registerRules([...FDCPA_RULES]);
  });

  it('exports 6 FDCPA rules', () => {
    expect(FDCPA_RULES).toHaveLength(6);
  });

  // ── Contact Frequency ──────────────────────────────────────

  it('blocks 8th contact attempt in 7 days', () => {
    const result = engine.evaluateForRegulation(
      'fdcpa',
      makeContext({
        data: {
          contactAttemptsLast7Days: 8,
          localHour: 14,
          miniMirandaIncluded: true,
        },
      }),
    );

    const freq = result.results.find(
      (r) => r.ruleId === 'FDCPA_CONTACT_FREQUENCY',
    );
    expect(freq?.passed).toBe(false);
    expect(freq?.violation?.code).toBe('FDCPA-1006.14-B2');
    expect(result.allowed).toBe(false);
  });

  it('allows 6th contact attempt in 7 days', () => {
    const result = engine.evaluateForRegulation(
      'fdcpa',
      makeContext({
        data: {
          contactAttemptsLast7Days: 6,
          localHour: 14,
          miniMirandaIncluded: true,
        },
      }),
    );

    const freq = result.results.find(
      (r) => r.ruleId === 'FDCPA_CONTACT_FREQUENCY',
    );
    expect(freq?.passed).toBe(true);
  });

  // ── Contact Timing ─────────────────────────────────────────

  it('blocks contact before 8AM', () => {
    const result = engine.evaluateForRegulation(
      'fdcpa',
      makeContext({
        data: {
          contactAttemptsLast7Days: 1,
          localHour: 7,
          miniMirandaIncluded: true,
        },
      }),
    );

    const timing = result.results.find(
      (r) => r.ruleId === 'FDCPA_CONTACT_TIMING',
    );
    expect(timing?.passed).toBe(false);
    expect(timing?.violation?.code).toBe('FDCPA-1692C-A1');
  });

  it('blocks contact after 9PM', () => {
    const result = engine.evaluateForRegulation(
      'fdcpa',
      makeContext({
        data: {
          contactAttemptsLast7Days: 1,
          localHour: 22,
          miniMirandaIncluded: true,
        },
      }),
    );

    const timing = result.results.find(
      (r) => r.ruleId === 'FDCPA_CONTACT_TIMING',
    );
    expect(timing?.passed).toBe(false);
  });

  it('allows contact at 2PM with 3 prior attempts', () => {
    const result = engine.evaluateForRegulation(
      'fdcpa',
      makeContext({
        data: {
          contactAttemptsLast7Days: 3,
          localHour: 14,
          miniMirandaIncluded: true,
        },
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  // ── Mini-Miranda ───────────────────────────────────────────

  it('fails when Mini-Miranda disclosure is missing', () => {
    const result = engine.evaluateForRegulation(
      'fdcpa',
      makeContext({
        data: {
          contactAttemptsLast7Days: 1,
          localHour: 14,
          miniMirandaIncluded: false,
        },
      }),
    );

    const miranda = result.results.find(
      (r) => r.ruleId === 'FDCPA_MINI_MIRANDA',
    );
    expect(miranda?.passed).toBe(false);
    expect(miranda?.violation?.code).toBe('FDCPA-1692E-11');
  });

  it('passes when Mini-Miranda disclosure is included', () => {
    const result = engine.evaluateForRegulation(
      'fdcpa',
      makeContext({
        data: {
          contactAttemptsLast7Days: 1,
          localHour: 14,
          miniMirandaIncluded: true,
        },
      }),
    );

    const miranda = result.results.find(
      (r) => r.ruleId === 'FDCPA_MINI_MIRANDA',
    );
    expect(miranda?.passed).toBe(true);
  });

  // ── Cease Communication ────────────────────────────────────

  it('blocks contact when cease-and-desist is on file', () => {
    const result = engine.evaluateForRegulation(
      'fdcpa',
      makeContext({
        data: {
          localHour: 14,
          miniMirandaIncluded: true,
          ceaseAndDesistOnFile: true,
        },
      }),
    );

    const cease = result.results.find(
      (r) => r.ruleId === 'FDCPA_CEASE_COMMUNICATION',
    );
    expect(cease?.passed).toBe(false);
    expect(result.allowed).toBe(false);
  });

  // ── Third-Party Disclosure ─────────────────────────────────

  it('blocks disclosure of debt to third party', () => {
    const result = engine.evaluateForRegulation(
      'fdcpa',
      makeContext({
        data: {
          localHour: 14,
          miniMirandaIncluded: true,
          recipientIsThirdParty: true,
        },
      }),
    );

    const disclosure = result.results.find(
      (r) => r.ruleId === 'FDCPA_THIRD_PARTY_DISCLOSURE',
    );
    expect(disclosure?.passed).toBe(false);
    expect(disclosure?.violation?.code).toBe('FDCPA-1692C-B');
  });

  // ── Harassment Prevention ──────────────────────────────────

  it('blocks flagged harassing content', () => {
    const result = engine.evaluateForRegulation(
      'fdcpa',
      makeContext({
        data: {
          localHour: 14,
          miniMirandaIncluded: true,
          contentFlagged: true,
        },
      }),
    );

    const harassment = result.results.find(
      (r) => r.ruleId === 'FDCPA_HARASSMENT_PREVENTION',
    );
    expect(harassment?.passed).toBe(false);
    expect(result.allowed).toBe(false);
  });
});
