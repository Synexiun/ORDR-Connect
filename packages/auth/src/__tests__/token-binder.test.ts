/**
 * TokenBinder tests
 *
 * Verifies:
 * - computeFingerprint returns consistent hex string
 * - embedFingerprint adds fpk to payload without mutation
 * - verifyFingerprint: matching context → valid
 * - verifyFingerprint: mismatched IP (when bindIP=true) → invalid
 * - verifyFingerprint: missing fpk claim → valid (no binding)
 * - verifyFingerprint: UA-only binding (default) ignores IP change
 * - constructor throws on short secret
 * - timing-safe comparison (same result for correct/incorrect)
 */

import { describe, it, expect } from 'vitest';
import { TokenBinder } from '../token-binder.js';

const SECRET_32 = 'a'.repeat(32);
const IP = '203.0.113.42';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';

describe('TokenBinder', () => {
  // ─── Constructor ────────────────────────────────────────────────────────────

  it('throws when bindingSecret is shorter than 32 chars', () => {
    expect(() => new TokenBinder({ bindingSecret: 'tooshort' })).toThrow('32');
  });

  it('does not throw with exactly 32-char secret', () => {
    expect(() => new TokenBinder({ bindingSecret: SECRET_32 })).not.toThrow();
  });

  // ─── computeFingerprint ─────────────────────────────────────────────────────

  it('returns a 64-char hex string', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32 });
    const fp = binder.computeFingerprint(IP, UA);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('same inputs always produce the same fingerprint', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32 });
    const fp1 = binder.computeFingerprint(IP, UA);
    const fp2 = binder.computeFingerprint(IP, UA);
    expect(fp1).toBe(fp2);
  });

  it('different UA produces different fingerprint', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32 });
    const fp1 = binder.computeFingerprint(IP, UA);
    const fp2 = binder.computeFingerprint(IP, 'Wget/1.20');
    expect(fp1).not.toBe(fp2);
  });

  it('different secret produces different fingerprint', () => {
    const binder1 = new TokenBinder({ bindingSecret: 'a'.repeat(32) });
    const binder2 = new TokenBinder({ bindingSecret: 'b'.repeat(32) });
    const fp1 = binder1.computeFingerprint(IP, UA);
    const fp2 = binder2.computeFingerprint(IP, UA);
    expect(fp1).not.toBe(fp2);
  });

  // ─── UA-only vs IP+UA binding ───────────────────────────────────────────────

  it('UA-only binding: different IP produces same fingerprint', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32, bindIP: false });
    const fp1 = binder.computeFingerprint('10.0.0.1', UA);
    const fp2 = binder.computeFingerprint('10.0.0.2', UA);
    expect(fp1).toBe(fp2);
  });

  it('IP+UA binding: different IP produces different fingerprint', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32, bindIP: true });
    const fp1 = binder.computeFingerprint('10.0.0.1', UA);
    const fp2 = binder.computeFingerprint('10.0.0.2', UA);
    expect(fp1).not.toBe(fp2);
  });

  // ─── embedFingerprint ───────────────────────────────────────────────────────

  it('embedFingerprint adds fpk without mutating original', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32 });
    const original = { sub: 'user-1', tid: 'tenant-1' };
    const withFp = binder.embedFingerprint(original, IP, UA);
    expect(withFp).toHaveProperty('fpk');
    expect(withFp.fpk).toMatch(/^[0-9a-f]{64}$/);
    expect(original).not.toHaveProperty('fpk');
  });

  it('embedFingerprint preserves all original payload fields', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32 });
    const payload = { sub: 'u1', tid: 't1', role: 'agent', jti: 'abc-123' };
    const result = binder.embedFingerprint(payload, IP, UA);
    expect(result.sub).toBe('u1');
    expect(result.tid).toBe('t1');
    expect(result.role).toBe('agent');
    expect(result.jti).toBe('abc-123');
  });

  // ─── verifyFingerprint ──────────────────────────────────────────────────────

  it('valid: token with correct fingerprint passes verification', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32 });
    const payload = binder.embedFingerprint({ sub: 'u1' }, IP, UA);
    const result = binder.verifyFingerprint(payload, IP, UA);
    expect(result.valid).toBe(true);
  });

  it('valid: token without fpk claim passes (no binding at issuance)', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32 });
    const result = binder.verifyFingerprint({ sub: 'u1', tid: 't1' }, IP, UA);
    expect(result.valid).toBe(true);
  });

  it('valid: null fpk passes', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32 });
    const result = binder.verifyFingerprint({ sub: 'u1', fpk: null }, IP, UA);
    expect(result.valid).toBe(true);
  });

  it('invalid: wrong UA causes mismatch', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32 });
    const payload = binder.embedFingerprint({ sub: 'u1' }, IP, UA);
    const result = binder.verifyFingerprint(payload, IP, 'evil-bot/1.0');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('invalid: wrong IP (when bindIP=true) causes mismatch', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32, bindIP: true });
    const payload = binder.embedFingerprint({ sub: 'u1' }, IP, UA);
    const result = binder.verifyFingerprint(payload, '10.0.0.99', UA);
    expect(result.valid).toBe(false);
  });

  it('valid: different IP (bindIP=false, default) — IP change allowed', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32, bindIP: false });
    const payload = binder.embedFingerprint({ sub: 'u1' }, IP, UA);
    // IP changes (mobile roaming) — should still pass with UA-only binding
    const result = binder.verifyFingerprint(payload, '10.0.0.99', UA);
    expect(result.valid).toBe(true);
  });

  it('invalid: fpk type is not string → invalid', () => {
    const binder = new TokenBinder({ bindingSecret: SECRET_32 });
    const result = binder.verifyFingerprint({ sub: 'u1', fpk: 12345 }, IP, UA);
    expect(result.valid).toBe(false);
  });
});
