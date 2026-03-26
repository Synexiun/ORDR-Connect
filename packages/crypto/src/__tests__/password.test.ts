import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from '../password.js';

describe('Argon2id password hashing', () => {
  it('should hash and then verify a correct password', async () => {
    const password = 'Str0ng!P@ssw0rd#2024';
    const hash = await hashPassword(password);
    const valid = await verifyPassword(password, hash);

    expect(valid).toBe(true);
  });

  it('should reject a wrong password', async () => {
    const hash = await hashPassword('CorrectHorse!Battery1');
    const valid = await verifyPassword('WrongPassword!123', hash);

    expect(valid).toBe(false);
  });

  it('should produce an Argon2id hash (verify algorithm prefix)', async () => {
    const hash = await hashPassword('TestPassword!123');

    // Argon2id hashes start with $argon2id$
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('should produce different hashes for the same password (unique salts)', async () => {
    const password = 'SamePassword!123';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    // Argon2 uses random salts, so hashes should differ
    expect(hash1).not.toBe(hash2);

    // But both should verify
    expect(await verifyPassword(password, hash1)).toBe(true);
    expect(await verifyPassword(password, hash2)).toBe(true);
  });

  it('should return false for an invalid hash format instead of throwing', async () => {
    const valid = await verifyPassword('test', 'not-a-valid-hash');
    expect(valid).toBe(false);
  });

  it('should include memory cost, time cost, and parallelism in hash', async () => {
    const hash = await hashPassword('ParamCheck!123');

    // Argon2 hash format includes: $argon2id$v=19$m=65536,t=3,p=4$...
    expect(hash).toContain('m=65536');
    expect(hash).toContain('t=3');
    expect(hash).toContain('p=4');
  });
});

describe('validatePasswordStrength', () => {
  it('should accept a strong password', () => {
    const result = validatePasswordStrength('MyStr0ng!Pass99');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject a password shorter than 12 characters', () => {
    const result = validatePasswordStrength('Sh0rt!');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must be at least 12 characters long');
  });

  it('should reject a password without uppercase letters', () => {
    const result = validatePasswordStrength('nouppercase!123x');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('uppercase'))).toBe(true);
  });

  it('should reject a password without lowercase letters', () => {
    const result = validatePasswordStrength('NOLOWERCASE!123X');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('lowercase'))).toBe(true);
  });

  it('should reject a password without digits', () => {
    const result = validatePasswordStrength('NoDigitsHere!Xx');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('digit'))).toBe(true);
  });

  it('should reject a password without special characters', () => {
    const result = validatePasswordStrength('NoSpecial12345Xx');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('special'))).toBe(true);
  });

  it('should report all failures at once for a completely weak password', () => {
    const result = validatePasswordStrength('abc');
    expect(result.valid).toBe(false);
    // Should have at least: too short, no uppercase, no digit, no special
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it('should accept password with exactly 12 characters meeting all criteria', () => {
    const result = validatePasswordStrength('Abcdefgh1!23');
    expect(result.valid).toBe(true);
  });
});
