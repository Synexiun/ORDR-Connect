/**
 * ThreatScorer tests
 *
 * Verifies:
 * - Clean requests score none/low
 * - Attack indicators elevate score
 * - Honeypot triggers critical block
 * - Replay attack elevates to high/critical
 * - Fingerprint mismatch elevates to high
 * - IP block elevates to critical block
 * - TOR exit adds score
 * - Malicious user-agent adds score
 * - Scanner path adds score
 * - Multi-vector attack adds bonus score
 * - Score is capped at 1000
 * - ThreatAssessment has all required fields
 */

import { describe, it, expect } from 'vitest';
import { ThreatScorer } from '../threat-scorer.js';

const scorer = new ThreatScorer();

const cleanInput = {
  requestId: 'req-001',
  tenantId: 'tenant-test',
  ip: '203.0.113.10',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  path: '/api/v1/customers',
  method: 'GET',
  attackIndicators: [] as never[],
  anomalySignals: [] as never[],
  isHoneypotPath: false,
  isReplayAttack: false,
  isFingerprintMismatch: false,
  isIPBlocked: false,
  isTorExit: false,
};

describe('ThreatScorer', () => {
  // ─── Clean requests ────────────────────────────────────────────────────────

  it('clean request produces none threat level', () => {
    const result = scorer.score(cleanInput);
    expect(result.threatLevel).toBe('none');
    expect(result.action).toBe('allow');
    expect(result.totalScore).toBeLessThan(200);
  });

  it('result has all required fields', () => {
    const result = scorer.score(cleanInput);
    expect(result).toHaveProperty('requestId');
    expect(result).toHaveProperty('tenantId');
    expect(result).toHaveProperty('threatLevel');
    expect(result).toHaveProperty('totalScore');
    expect(result).toHaveProperty('signals');
    expect(result).toHaveProperty('action');
    expect(result).toHaveProperty('timestamp');
    expect(Array.isArray(result.signals)).toBe(true);
  });

  it('totalScore is between 0 and 1000', () => {
    const result = scorer.score(cleanInput);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(1000);
  });

  // ─── Honeypot ──────────────────────────────────────────────────────────────

  it('honeypot trigger produces critical block', () => {
    const result = scorer.score({ ...cleanInput, isHoneypotPath: true });
    expect(result.threatLevel).toBe('critical');
    expect(result.action).toBe('block');
    expect(result.totalScore).toBeGreaterThanOrEqual(800);
  });

  it('honeypot signal is named honeypot_triggered', () => {
    const result = scorer.score({ ...cleanInput, isHoneypotPath: true });
    expect(result.signals.some((s) => s.name === 'honeypot_triggered')).toBe(true);
  });

  // ─── Replay attack ─────────────────────────────────────────────────────────

  it('replay attack produces high/critical result', () => {
    const result = scorer.score({ ...cleanInput, isReplayAttack: true });
    expect(['high', 'critical']).toContain(result.threatLevel);
    expect(['challenge', 'block']).toContain(result.action);
  });

  it('replay attack signal is named jwt_replay', () => {
    const result = scorer.score({ ...cleanInput, isReplayAttack: true });
    expect(result.signals.some((s) => s.name === 'jwt_replay')).toBe(true);
  });

  // ─── Fingerprint mismatch ──────────────────────────────────────────────────

  it('fingerprint mismatch produces medium+ result', () => {
    const result = scorer.score({ ...cleanInput, isFingerprintMismatch: true });
    expect(result.totalScore).toBeGreaterThanOrEqual(400);
  });

  // ─── IP blocked ────────────────────────────────────────────────────────────

  it('blocked IP produces critical block', () => {
    const result = scorer.score({ ...cleanInput, isIPBlocked: true });
    expect(result.threatLevel).toBe('critical');
    expect(result.action).toBe('block');
  });

  // ─── TOR exit ──────────────────────────────────────────────────────────────

  it('TOR exit adds score but may not block alone', () => {
    const result = scorer.score({ ...cleanInput, isTorExit: true });
    expect(result.totalScore).toBeGreaterThan(0);
    const torSignal = result.signals.find((s) => s.name === 'tor_exit');
    expect(torSignal).toBeDefined();
    expect(torSignal?.score).toBe(400);
  });

  // ─── Attack indicators ─────────────────────────────────────────────────────

  it('critical attack indicator produces high/critical result', () => {
    const result = scorer.score({
      ...cleanInput,
      attackIndicators: [
        {
          type: 'sqli' as const,
          severity: 'critical' as const,
          location: 'url' as const,
          pattern: 'UNION SELECT',
          matched: 'UNION SELECT password',
        },
      ],
    });
    expect(['high', 'critical']).toContain(result.threatLevel);
  });

  it('low severity attack indicator adds partial score', () => {
    const result = scorer.score({
      ...cleanInput,
      attackIndicators: [
        {
          type: 'open_redirect' as const,
          severity: 'low' as const,
          location: 'query' as const,
          pattern: 'open redirect',
          matched: 'redirect=http://evil.com',
        },
      ],
    });
    expect(result.totalScore).toBeGreaterThan(0);
  });

  it('multi-vector attack adds bonus score', () => {
    const singleResult = scorer.score({
      ...cleanInput,
      attackIndicators: [
        {
          type: 'sqli' as const,
          severity: 'high' as const,
          location: 'url' as const,
          pattern: 'x',
          matched: 'x',
        },
      ],
    });
    const multiResult = scorer.score({
      ...cleanInput,
      attackIndicators: [
        {
          type: 'sqli' as const,
          severity: 'high' as const,
          location: 'url' as const,
          pattern: 'x',
          matched: 'x',
        },
        {
          type: 'xss' as const,
          severity: 'high' as const,
          location: 'body' as const,
          pattern: 'y',
          matched: 'y',
        },
        {
          type: 'ssrf' as const,
          severity: 'medium' as const,
          location: 'body' as const,
          pattern: 'z',
          matched: 'z',
        },
      ],
    });
    expect(multiResult.totalScore).toBeGreaterThan(singleResult.totalScore);
  });

  // ─── Suspicious user-agent ─────────────────────────────────────────────────

  it('sqlmap user-agent produces high score', () => {
    const result = scorer.score({ ...cleanInput, userAgent: 'sqlmap/1.7.2' });
    expect(result.totalScore).toBeGreaterThanOrEqual(600);
    expect(result.signals.some((s) => s.name === 'malicious_user_agent')).toBe(true);
  });

  it('empty user-agent adds score', () => {
    const result = scorer.score({ ...cleanInput, userAgent: '' });
    expect(result.totalScore).toBeGreaterThan(0);
    expect(result.signals.some((s) => s.name === 'empty_user_agent')).toBe(true);
  });

  // ─── Scanner path ──────────────────────────────────────────────────────────

  it('wp-admin path adds scanner_path signal', () => {
    const result = scorer.score({ ...cleanInput, path: '/wp-admin/login' });
    expect(result.signals.some((s) => s.name === 'scanner_path')).toBe(true);
  });

  it('.env path adds scanner_path signal', () => {
    const result = scorer.score({ ...cleanInput, path: '/.env' });
    expect(result.signals.some((s) => s.name === 'scanner_path')).toBe(true);
  });

  it('TRACE method adds dangerous_method signal', () => {
    const result = scorer.score({ ...cleanInput, method: 'TRACE' });
    expect(result.signals.some((s) => s.name === 'dangerous_method')).toBe(true);
  });

  // ─── Score capping ─────────────────────────────────────────────────────────

  it('score is capped at 1000 even with many signals', () => {
    const result = scorer.score({
      ...cleanInput,
      isHoneypotPath: true,
      isIPBlocked: true,
      isReplayAttack: true,
      isFingerprintMismatch: true,
      isTorExit: true,
      userAgent: 'sqlmap/1.7',
      attackIndicators: [
        {
          type: 'sqli' as const,
          severity: 'critical' as const,
          location: 'url' as const,
          pattern: 'x',
          matched: 'x',
        },
        {
          type: 'ssrf' as const,
          severity: 'critical' as const,
          location: 'body' as const,
          pattern: 'y',
          matched: 'y',
        },
      ],
    });
    expect(result.totalScore).toBeLessThanOrEqual(1000);
  });

  // ─── Anomaly signals ────────────────────────────────────────────────────────

  it('anomaly signal adds score when isAnomaly=true', () => {
    const result = scorer.score({
      ...cleanInput,
      anomalySignals: [
        {
          metric: 'request_rate' as const,
          observed: 1000,
          baseline: 10,
          zScore: 8.5,
          isAnomaly: true,
        },
      ],
    });
    expect(result.totalScore).toBeGreaterThan(0);
    expect(result.signals.some((s) => s.name === 'anomaly_request_rate')).toBe(true);
  });

  it('non-anomaly signal does not add score', () => {
    const resultWithout = scorer.score(cleanInput);
    const resultWith = scorer.score({
      ...cleanInput,
      anomalySignals: [
        {
          metric: 'request_rate' as const,
          observed: 10,
          baseline: 10,
          zScore: 0.1,
          isAnomaly: false,
        },
      ],
    });
    expect(resultWith.totalScore).toBe(resultWithout.totalScore);
  });
});
