import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceEngine } from '../engine.js';
import { HIPAA_RULES } from '../rules/hipaa.js';
import type { ComplianceContext } from '../types.js';

function makeContext(overrides: Partial<ComplianceContext> = {}): ComplianceContext {
  return {
    tenantId: 'tenant-health',
    action: 'access_phi',
    data: {},
    timestamp: new Date('2026-03-24T12:00:00Z'),
    ...overrides,
  };
}

describe('HIPAA Rules', () => {
  let engine: ComplianceEngine;

  beforeEach(() => {
    engine = new ComplianceEngine();
    engine.registerRules([...HIPAA_RULES]);
  });

  it('exports 6 HIPAA rules', () => {
    expect(HIPAA_RULES).toHaveLength(6);
  });

  // ── PHI Access Logging ─────────────────────────────────────

  it('fails when PHI access has no audit trail', () => {
    const result = engine.evaluateForRegulation(
      'hipaa',
      makeContext({ data: { encrypted: true } }),
    );

    const logging = result.results.find(
      (r) => r.ruleId === 'HIPAA_PHI_ACCESS_LOGGING',
    );
    expect(logging?.passed).toBe(false);
    expect(logging?.violation?.code).toBe('HIPAA-164.312-B');
  });

  it('passes when PHI access has a valid audit trail', () => {
    const result = engine.evaluateForRegulation(
      'hipaa',
      makeContext({
        data: { auditTrailId: 'audit-abc-123', encrypted: true },
      }),
    );

    const logging = result.results.find(
      (r) => r.ruleId === 'HIPAA_PHI_ACCESS_LOGGING',
    );
    expect(logging?.passed).toBe(true);
  });

  // ── Encryption ─────────────────────────────────────────────

  it('fails when PHI is not encrypted', () => {
    const result = engine.evaluateForRegulation(
      'hipaa',
      makeContext({
        data: { auditTrailId: 'audit-123', encrypted: false },
      }),
    );

    const encryption = result.results.find(
      (r) => r.ruleId === 'HIPAA_ENCRYPTION_REQUIRED',
    );
    expect(encryption?.passed).toBe(false);
    expect(encryption?.violation?.code).toBe('HIPAA-164.312-A2IV');
  });

  it('passes when PHI is encrypted', () => {
    const result = engine.evaluateForRegulation(
      'hipaa',
      makeContext({
        data: { auditTrailId: 'audit-123', encrypted: true },
      }),
    );

    const encryption = result.results.find(
      (r) => r.ruleId === 'HIPAA_ENCRYPTION_REQUIRED',
    );
    expect(encryption?.passed).toBe(true);
  });

  // ── Session Timeout ────────────────────────────────────────

  it('detects session timeout violation', () => {
    const now = new Date('2026-03-24T12:00:00Z');
    const twentyMinutesAgo = now.getTime() - 20 * 60 * 1000;

    const result = engine.evaluateForRegulation(
      'hipaa',
      makeContext({
        timestamp: now,
        data: {
          auditTrailId: 'audit-123',
          encrypted: true,
          lastActivityAt: twentyMinutesAgo,
        },
      }),
    );

    const timeout = result.results.find(
      (r) => r.ruleId === 'HIPAA_SESSION_TIMEOUT',
    );
    expect(timeout?.passed).toBe(false);
    expect(timeout?.violation?.code).toBe('HIPAA-164.312-A2III');
  });

  it('passes when session is within 15-minute window', () => {
    const now = new Date('2026-03-24T12:00:00Z');
    const tenMinutesAgo = now.getTime() - 10 * 60 * 1000;

    const result = engine.evaluateForRegulation(
      'hipaa',
      makeContext({
        timestamp: now,
        data: {
          auditTrailId: 'audit-123',
          encrypted: true,
          lastActivityAt: tenMinutesAgo,
        },
      }),
    );

    const timeout = result.results.find(
      (r) => r.ruleId === 'HIPAA_SESSION_TIMEOUT',
    );
    expect(timeout?.passed).toBe(true);
  });

  // ── Minimum Necessary ──────────────────────────────────────

  it('fails when unauthorized PHI fields are requested', () => {
    const result = engine.evaluateForRegulation(
      'hipaa',
      makeContext({
        data: {
          auditTrailId: 'audit-123',
          encrypted: true,
          requestedFields: ['name', 'ssn', 'diagnosis'],
          authorizedFields: ['name'],
        },
      }),
    );

    const minNecessary = result.results.find(
      (r) => r.ruleId === 'HIPAA_MINIMUM_NECESSARY',
    );
    expect(minNecessary?.passed).toBe(false);
    expect(minNecessary?.violation?.message).toContain('ssn');
  });

  // ── Valid PHI Access (all rules pass) ──────────────────────

  it('allows valid PHI access with all requirements met', () => {
    const now = new Date('2026-03-24T12:00:00Z');

    const result = engine.evaluateForRegulation(
      'hipaa',
      makeContext({
        timestamp: now,
        data: {
          auditTrailId: 'audit-xyz-789',
          encrypted: true,
          lastActivityAt: now.getTime() - 5 * 60 * 1000,
          requestedFields: ['name'],
          authorizedFields: ['name', 'dob'],
        },
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.results.every((r) => r.passed)).toBe(true);
  });

  // ── BAA Required ───────────────────────────────────────────

  it('fails when subprocessor has no BAA on file', () => {
    const result = engine.evaluateForRegulation(
      'hipaa',
      makeContext({
        data: {
          auditTrailId: 'audit-123',
          encrypted: true,
          subprocessorId: 'vendor-abc',
          baaOnFile: false,
        },
      }),
    );

    const baa = result.results.find(
      (r) => r.ruleId === 'HIPAA_BAA_REQUIRED',
    );
    expect(baa?.passed).toBe(false);
    expect(baa?.violation?.code).toBe('HIPAA-164.502-E');
  });

  // ── Breach Notification ────────────────────────────────────

  it('fails when breach notification exceeds 60 days', () => {
    const now = new Date('2026-03-24T12:00:00Z');
    const seventyDaysAgo = now.getTime() - 70 * 24 * 60 * 60 * 1000;

    const result = engine.evaluateForRegulation(
      'hipaa',
      makeContext({
        timestamp: now,
        data: {
          auditTrailId: 'audit-123',
          encrypted: true,
          breachDiscoveredAt: seventyDaysAgo,
          breachNotificationSent: false,
        },
      }),
    );

    const breach = result.results.find(
      (r) => r.ruleId === 'HIPAA_BREACH_NOTIFICATION',
    );
    expect(breach?.passed).toBe(false);
    expect(breach?.violation?.code).toBe('HIPAA-164.404');
  });
});
