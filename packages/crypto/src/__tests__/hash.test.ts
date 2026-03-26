import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  sha256,
  sha256Buffer,
  hmacSha256,
  hmacSha256Buffer,
  hashApiKey,
  timingSafeEqual,
} from '../hash.js';

describe('SHA-256', () => {
  it('should produce correct hash for known test vector (empty string)', () => {
    // NIST test vector: SHA-256 of empty string
    const expected = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(sha256('')).toBe(expected);
  });

  it('should produce correct hash for known test vector ("abc")', () => {
    // NIST test vector: SHA-256 of "abc"
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(sha256('abc')).toBe(expected);
  });

  it('should produce a 64-character hex string', () => {
    const hash = sha256('test data');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should accept Buffer input', () => {
    const buf = Buffer.from('hello', 'utf8');
    const fromString = sha256('hello');
    const fromBuffer = sha256(buf);
    expect(fromBuffer).toBe(fromString);
  });

  it('sha256Buffer should return a 32-byte Buffer', () => {
    const buf = sha256Buffer('test');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(32);
  });

  it('sha256Buffer hex should match sha256', () => {
    const data = 'consistent hashing';
    expect(sha256Buffer(data).toString('hex')).toBe(sha256(data));
  });
});

describe('HMAC-SHA256', () => {
  it('should produce correct HMAC for known input', () => {
    const key = Buffer.from('secret-key', 'utf8');
    const data = 'message';

    const hmac = hmacSha256(data, key);

    // HMAC output should be a 64-char hex string (32 bytes)
    expect(hmac).toHaveLength(64);
    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should produce different HMACs for different keys', () => {
    const key1 = Buffer.from('key-one', 'utf8');
    const key2 = Buffer.from('key-two', 'utf8');
    const data = 'same message';

    expect(hmacSha256(data, key1)).not.toBe(hmacSha256(data, key2));
  });

  it('should produce different HMACs for different messages', () => {
    const key = Buffer.from('shared-key', 'utf8');

    expect(hmacSha256('message-a', key)).not.toBe(hmacSha256('message-b', key));
  });

  it('should produce deterministic output', () => {
    const key = Buffer.from('deterministic-key', 'utf8');
    const data = 'deterministic data';

    expect(hmacSha256(data, key)).toBe(hmacSha256(data, key));
  });

  it('hmacSha256Buffer should return a 32-byte Buffer', () => {
    const key = randomBytes(32);
    const buf = hmacSha256Buffer('test', key);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(32);
  });

  it('hmacSha256Buffer hex should match hmacSha256', () => {
    const key = Buffer.from('consistency', 'utf8');
    const data = 'verify';
    expect(hmacSha256Buffer(data, key).toString('hex')).toBe(hmacSha256(data, key));
  });
});

describe('hashApiKey', () => {
  it('should return a SHA-256 hash of the API key', () => {
    const apiKey = 'ordr_abc123def456';
    const hashed = hashApiKey(apiKey);

    expect(hashed).toHaveLength(64);
    expect(hashed).toBe(sha256(apiKey));
  });

  it('should produce different hashes for different keys', () => {
    expect(hashApiKey('key-1')).not.toBe(hashApiKey('key-2'));
  });
});

describe('timingSafeEqual', () => {
  it('should return true for identical strings', () => {
    expect(timingSafeEqual('hello', 'hello')).toBe(true);
  });

  it('should return false for different strings of same length', () => {
    expect(timingSafeEqual('hello', 'world')).toBe(false);
  });

  it('should return false for different-length strings', () => {
    expect(timingSafeEqual('short', 'much longer string')).toBe(false);
  });

  it('should return true for empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('should handle special characters', () => {
    const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    expect(timingSafeEqual(special, special)).toBe(true);
  });

  it('should detect single character difference', () => {
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
  });
});
