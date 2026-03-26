import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { importPKCS8, importSPKI } from 'jose';
import type { KeyLike } from 'jose';
import type { JwtConfig, AccessTokenPayload, RefreshTokenPayload } from '../jwt.js';
import {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  loadKeyPair,
} from '../jwt.js';
import type { UserRole, Permission } from '@ordr/core';

// ─── Test Key Pair (2048-bit for faster tests) ─────────────────────

let config: JwtConfig;
let altConfig: JwtConfig; // Different key pair for wrong-key tests

function generateTestKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey };
}

beforeAll(async () => {
  const keys = generateTestKeyPair();
  const privateKey = await importPKCS8(keys.privateKey, 'RS256');
  const publicKey = await importSPKI(keys.publicKey, 'RS256');

  config = {
    privateKey,
    publicKey,
    accessTokenTtl: 900, // 15 minutes
    refreshTokenTtl: 604_800, // 7 days
    issuer: 'ordr-connect-test',
    audience: 'ordr-connect-test',
  };

  // Generate a different key pair for wrong-key tests
  const altKeys = generateTestKeyPair();
  const altPrivateKey = await importPKCS8(altKeys.privateKey, 'RS256');
  const altPublicKey = await importSPKI(altKeys.publicKey, 'RS256');

  altConfig = {
    privateKey: altPrivateKey,
    publicKey: altPublicKey,
    accessTokenTtl: 900,
    refreshTokenTtl: 604_800,
    issuer: 'ordr-connect-test',
    audience: 'ordr-connect-test',
  };
});

// ─── Access Token Tests ────────────────────────────────────────────

describe('Access Token', () => {
  const testPermissions: Permission[] = [
    { resource: 'customers', action: 'read', scope: 'tenant' },
    { resource: 'customers', action: 'update', scope: 'own' },
  ];

  it('should create and verify an access token roundtrip', async () => {
    const token = await createAccessToken(config, {
      sub: 'user-123',
      tid: 'tenant-456',
      role: 'agent' as UserRole,
      permissions: testPermissions,
    });

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts

    const payload = await verifyAccessToken(config, token);

    expect(payload.sub).toBe('user-123');
    expect(payload.tid).toBe('tenant-456');
    expect(payload.role).toBe('agent');
    expect(payload.permissions).toHaveLength(2);
    expect(payload.jti).toBeDefined();
    expect(typeof payload.jti).toBe('string');
    expect(payload.iat).toBeGreaterThan(0);
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('should contain correct claims (sub, tid, role, permissions)', async () => {
    const token = await createAccessToken(config, {
      sub: 'admin-001',
      tid: 'tenant-enterprise',
      role: 'tenant_admin' as UserRole,
      permissions: [
        { resource: 'users', action: 'create', scope: 'tenant' },
        { resource: 'users', action: 'delete', scope: 'tenant' },
        { resource: 'billing', action: 'read', scope: 'tenant' },
      ],
    });

    const payload = await verifyAccessToken(config, token);

    expect(payload.sub).toBe('admin-001');
    expect(payload.tid).toBe('tenant-enterprise');
    expect(payload.role).toBe('tenant_admin');
    expect(payload.permissions).toEqual([
      { resource: 'users', action: 'create', scope: 'tenant' },
      { resource: 'users', action: 'delete', scope: 'tenant' },
      { resource: 'billing', action: 'read', scope: 'tenant' },
    ]);
  });

  it('should include a unique jti for revocation tracking', async () => {
    const token1 = await createAccessToken(config, {
      sub: 'user-1',
      tid: 'tenant-1',
      role: 'viewer' as UserRole,
      permissions: [],
    });

    const token2 = await createAccessToken(config, {
      sub: 'user-1',
      tid: 'tenant-1',
      role: 'viewer' as UserRole,
      permissions: [],
    });

    const payload1 = await verifyAccessToken(config, token1);
    const payload2 = await verifyAccessToken(config, token2);

    expect(payload1.jti).toBeDefined();
    expect(payload2.jti).toBeDefined();
    expect(payload1.jti).not.toBe(payload2.jti);
  });

  it('should allow specifying a custom jti', async () => {
    const customJti = 'custom-jti-abc-123';
    const token = await createAccessToken(config, {
      sub: 'user-1',
      tid: 'tenant-1',
      role: 'agent' as UserRole,
      permissions: [],
      jti: customJti,
    });

    const payload = await verifyAccessToken(config, token);
    expect(payload.jti).toBe(customJti);
  });

  it('should reject an expired access token', async () => {
    // Create a config with 1-second TTL
    const shortConfig: JwtConfig = { ...config, accessTokenTtl: 1 };

    const token = await createAccessToken(shortConfig, {
      sub: 'user-1',
      tid: 'tenant-1',
      role: 'viewer' as UserRole,
      permissions: [],
    });

    // Wait for the token to expire
    await new Promise((resolve) => setTimeout(resolve, 1500));

    await expect(verifyAccessToken(config, token)).rejects.toThrow();
  });

  it('should reject a token signed with the wrong key', async () => {
    // Sign with altConfig's private key
    const token = await createAccessToken(altConfig, {
      sub: 'user-1',
      tid: 'tenant-1',
      role: 'agent' as UserRole,
      permissions: [],
    });

    // Verify with the original config's public key — should fail
    await expect(verifyAccessToken(config, token)).rejects.toThrow();
  });

  it('should reject a token with wrong issuer', async () => {
    const wrongIssuerConfig: JwtConfig = {
      ...config,
      issuer: 'wrong-issuer',
    };

    const token = await createAccessToken(wrongIssuerConfig, {
      sub: 'user-1',
      tid: 'tenant-1',
      role: 'viewer' as UserRole,
      permissions: [],
    });

    await expect(verifyAccessToken(config, token)).rejects.toThrow();
  });

  it('should reject a token with wrong audience', async () => {
    const wrongAudienceConfig: JwtConfig = {
      ...config,
      audience: 'wrong-audience',
    };

    const token = await createAccessToken(wrongAudienceConfig, {
      sub: 'user-1',
      tid: 'tenant-1',
      role: 'viewer' as UserRole,
      permissions: [],
    });

    await expect(verifyAccessToken(config, token)).rejects.toThrow();
  });
});

// ─── Refresh Token Tests ───────────────────────────────────────────

describe('Refresh Token', () => {
  it('should create and verify a refresh token roundtrip', async () => {
    const token = await createRefreshToken(config, {
      sub: 'user-123',
      tid: 'tenant-456',
      family: 'family-001',
    });

    expect(typeof token).toBe('string');

    const payload = await verifyRefreshToken(config, token);

    expect(payload.sub).toBe('user-123');
    expect(payload.tid).toBe('tenant-456');
    expect(payload.family).toBe('family-001');
    expect(payload.jti).toBeDefined();
    expect(payload.iat).toBeGreaterThan(0);
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('should contain a family ID for rotation detection', async () => {
    const familyId = 'rotation-family-xyz';
    const token = await createRefreshToken(config, {
      sub: 'user-1',
      tid: 'tenant-1',
      family: familyId,
    });

    const payload = await verifyRefreshToken(config, token);
    expect(payload.family).toBe(familyId);
  });

  it('should have a unique jti per refresh token', async () => {
    const token1 = await createRefreshToken(config, {
      sub: 'user-1',
      tid: 'tenant-1',
      family: 'family-1',
    });

    const token2 = await createRefreshToken(config, {
      sub: 'user-1',
      tid: 'tenant-1',
      family: 'family-1',
    });

    const payload1 = await verifyRefreshToken(config, token1);
    const payload2 = await verifyRefreshToken(config, token2);

    expect(payload1.jti).not.toBe(payload2.jti);
  });

  it('should reject an expired refresh token', async () => {
    const shortConfig: JwtConfig = { ...config, refreshTokenTtl: 1 };

    const token = await createRefreshToken(shortConfig, {
      sub: 'user-1',
      tid: 'tenant-1',
      family: 'family-1',
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    await expect(verifyRefreshToken(config, token)).rejects.toThrow();
  });

  it('should reject a refresh token signed with the wrong key', async () => {
    const token = await createRefreshToken(altConfig, {
      sub: 'user-1',
      tid: 'tenant-1',
      family: 'family-1',
    });

    await expect(verifyRefreshToken(config, token)).rejects.toThrow();
  });
});

// ─── loadKeyPair Tests ─────────────────────────────────────────────

describe('loadKeyPair', () => {
  it('should parse PEM keys and return a JwtConfig', async () => {
    const keys = generateTestKeyPair();

    const loaded = await loadKeyPair(keys.privateKey, keys.publicKey, {
      issuer: 'test-issuer',
      audience: 'test-audience',
    });

    expect(loaded.issuer).toBe('test-issuer');
    expect(loaded.audience).toBe('test-audience');
    expect(loaded.accessTokenTtl).toBe(900);
    expect(loaded.refreshTokenTtl).toBe(604_800);

    // Verify the loaded keys work for signing and verification
    const token = await createAccessToken(loaded, {
      sub: 'user-1',
      tid: 'tenant-1',
      role: 'viewer' as UserRole,
      permissions: [],
    });

    const payload = await verifyAccessToken(loaded, token);
    expect(payload.sub).toBe('user-1');
  });

  it('should use default issuer and audience when not specified', async () => {
    const keys = generateTestKeyPair();
    const loaded = await loadKeyPair(keys.privateKey, keys.publicKey);

    expect(loaded.issuer).toBe('ordr-connect');
    expect(loaded.audience).toBe('ordr-connect');
  });

  it('should reject invalid PEM key material', async () => {
    await expect(
      loadKeyPair('not-a-valid-pem', 'also-not-valid'),
    ).rejects.toThrow();
  });
});
