import { describe, it, expect } from 'vitest';
import {
  randomBytes,
  randomHex,
  randomUUID,
  randomToken,
  generateApiKey,
} from '../random.js';

describe('randomBytes', () => {
  it('should return a Buffer of the requested length', () => {
    const buf = randomBytes(16);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(16);
  });

  it('should return different values on successive calls', () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    expect(a).not.toEqual(b);
  });

  it('should handle large sizes', () => {
    const buf = randomBytes(1024);
    expect(buf.length).toBe(1024);
  });

  it('should throw for zero length', () => {
    expect(() => randomBytes(0)).toThrow('positive');
  });

  it('should throw for negative length', () => {
    expect(() => randomBytes(-1)).toThrow('positive');
  });
});

describe('randomHex', () => {
  it('should return a hex string of 2x the byte length', () => {
    const hex = randomHex(16);
    expect(hex).toHaveLength(32);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  it('should produce unique values', () => {
    const a = randomHex(32);
    const b = randomHex(32);
    expect(a).not.toBe(b);
  });
});

describe('randomUUID', () => {
  // UUID v4 format: 8-4-4-4-12 hex digits with version=4 and variant=8/9/a/b
  const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('should return a valid UUID v4 string', () => {
    const uuid = randomUUID();
    expect(uuid).toMatch(UUID_V4_REGEX);
  });

  it('should produce unique UUIDs', () => {
    const uuids = new Set(Array.from({ length: 100 }, () => randomUUID()));
    expect(uuids.size).toBe(100);
  });

  it('should have version 4 in the correct position', () => {
    const uuid = randomUUID();
    // The 13th character (index 14 with dashes) should be '4'
    expect(uuid[14]).toBe('4');
  });
});

describe('randomToken', () => {
  it('should return a base64url-encoded string by default (32 bytes)', () => {
    const token = randomToken();
    // 32 bytes in base64url = 43 characters (no padding in base64url)
    expect(token.length).toBeGreaterThan(0);
    // base64url uses A-Z, a-z, 0-9, -, _
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should accept a custom length parameter', () => {
    const short = randomToken(8);
    const long = randomToken(64);

    // Shorter input produces shorter output
    expect(short.length).toBeLessThan(long.length);
  });

  it('should produce unique tokens', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
  });

  it('should not contain base64 padding characters', () => {
    // base64url does not use = padding
    for (let i = 0; i < 20; i++) {
      const token = randomToken();
      expect(token).not.toContain('=');
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
    }
  });
});

describe('generateApiKey', () => {
  it('should start with the "ordr_" prefix', () => {
    const key = generateApiKey();
    expect(key.startsWith('ordr_')).toBe(true);
  });

  it('should have the prefix followed by a base64url token', () => {
    const key = generateApiKey();
    const token = key.slice(5); // Remove 'ordr_'
    expect(token.length).toBeGreaterThan(0);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should produce unique API keys', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()));
    expect(keys.size).toBe(50);
  });

  it('should have sufficient entropy (32-byte token after prefix)', () => {
    const key = generateApiKey();
    const token = key.slice(5);
    // 32 bytes base64url encoded = 43 characters
    expect(token.length).toBe(43);
  });
});
