/**
 * Auth Bypass Security Tests
 *
 * Validates that authentication and authorization controls cannot be bypassed.
 * Tests against the actual @ordr/auth middleware and JWT/API key flows.
 *
 * SOC2 CC6.1, ISO 27001 A.9.4.1, HIPAA §164.312(d)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  authenticateRequest,
  requireRole,
  requireTenant,
} from '@ordr/auth';
import type { JwtConfig, ApiKeyVerifier } from '@ordr/auth';
import {
  createAccessToken,
  loadKeyPair,
} from '@ordr/auth';
import { generateKeyPair } from '@ordr/crypto';
import type { TenantContext, UserRole, Permission } from '@ordr/core';
import { createTenantId, AuthenticationError, AuthorizationError, AppError } from '@ordr/core';

// ── Test Fixtures ─────────────────────────────────────────────────────

let jwtConfig: JwtConfig;
let otherJwtConfig: JwtConfig; // Different key pair for tampered tokens

const testTenantId = 'tenant-auth-test-001';
const testUserId = 'user-auth-test-001';

const testPermissions: readonly Permission[] = [
  { resource: 'customers', action: 'read', scope: 'tenant' },
  { resource: 'customers', action: 'create', scope: 'tenant' },
];

function buildTenantContext(overrides?: Partial<TenantContext>): TenantContext {
  return {
    tenantId: createTenantId(testTenantId),
    userId: testUserId,
    roles: ['agent'],
    permissions: ['customers:read:tenant', 'customers:create:tenant'],
    ...overrides,
  };
}

beforeAll(async () => {
  const keys = generateKeyPair();
  jwtConfig = await loadKeyPair(keys.privateKey, keys.publicKey, {
    issuer: 'ordr-connect-test',
    audience: 'ordr-connect-test',
    accessTokenTtl: 900,
    refreshTokenTtl: 604800,
  });

  const otherKeys = generateKeyPair();
  otherJwtConfig = await loadKeyPair(otherKeys.privateKey, otherKeys.publicKey, {
    issuer: 'ordr-connect-test',
    audience: 'ordr-connect-test',
  });
});

// ── Missing Authorization ─────────────────────────────────────────────

describe('Missing credentials', () => {
  it('rejects request with no Authorization header and no API key', async () => {
    const result = await authenticateRequest({}, jwtConfig);
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.error).toBeInstanceOf(AuthenticationError);
    }
  });

  it('rejects request with empty Authorization header', async () => {
    const result = await authenticateRequest(
      { authorization: '' },
      jwtConfig,
    );
    expect(result.authenticated).toBe(false);
  });

  it('rejects request with Authorization header but no Bearer prefix', async () => {
    const result = await authenticateRequest(
      { authorization: 'Basic dGVzdDp0ZXN0' },
      jwtConfig,
    );
    expect(result.authenticated).toBe(false);
  });

  it('rejects request with Bearer prefix but empty token', async () => {
    const result = await authenticateRequest(
      { authorization: 'Bearer ' },
      jwtConfig,
    );
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.error.message).toContain('Empty bearer token');
    }
  });
});

// ── Expired JWT ───────────────────────────────────────────────────────

describe('Expired JWT', () => {
  it('rejects an expired access token', async () => {
    const expiredConfig: JwtConfig = {
      ...jwtConfig,
      accessTokenTtl: -1, // Expire immediately
    };

    const token = await createAccessToken(expiredConfig, {
      sub: testUserId,
      tid: testTenantId,
      role: 'agent' as UserRole,
      permissions: testPermissions,
    });

    // Wait a tick to ensure expiration
    await new Promise((r) => setTimeout(r, 50));

    const result = await authenticateRequest(
      { authorization: `Bearer ${token}` },
      jwtConfig,
    );
    expect(result.authenticated).toBe(false);
  });
});

// ── Tampered JWT ──────────────────────────────────────────────────────

describe('Tampered JWT', () => {
  it('rejects a JWT signed with a different key', async () => {
    // Sign with otherJwtConfig but verify with jwtConfig
    const token = await createAccessToken(otherJwtConfig, {
      sub: testUserId,
      tid: testTenantId,
      role: 'agent' as UserRole,
      permissions: testPermissions,
    });

    const result = await authenticateRequest(
      { authorization: `Bearer ${token}` },
      jwtConfig,
    );
    expect(result.authenticated).toBe(false);
  });

  it('rejects a JWT with modified payload (signature mismatch)', async () => {
    const validToken = await createAccessToken(jwtConfig, {
      sub: testUserId,
      tid: testTenantId,
      role: 'agent' as UserRole,
      permissions: testPermissions,
    });

    // Tamper with the payload section
    const parts = validToken.split('.');
    // Modify the payload (base64url decode, change, re-encode)
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    payload.role = 'super_admin'; // Attempt privilege escalation
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tamperedToken = parts.join('.');

    const result = await authenticateRequest(
      { authorization: `Bearer ${tamperedToken}` },
      jwtConfig,
    );
    expect(result.authenticated).toBe(false);
  });

  it('rejects a JWT with truncated signature', async () => {
    const validToken = await createAccessToken(jwtConfig, {
      sub: testUserId,
      tid: testTenantId,
      role: 'agent' as UserRole,
      permissions: testPermissions,
    });

    const truncated = validToken.slice(0, -10);
    const result = await authenticateRequest(
      { authorization: `Bearer ${truncated}` },
      jwtConfig,
    );
    expect(result.authenticated).toBe(false);
  });

  it('rejects a JWT with completely invalid format', async () => {
    const result = await authenticateRequest(
      { authorization: 'Bearer not.a.jwt.at.all' },
      jwtConfig,
    );
    expect(result.authenticated).toBe(false);
  });

  it('rejects a JWT with wrong issuer', async () => {
    const wrongIssuerConfig: JwtConfig = {
      ...jwtConfig,
      issuer: 'evil-issuer',
    };

    const token = await createAccessToken(wrongIssuerConfig, {
      sub: testUserId,
      tid: testTenantId,
      role: 'agent' as UserRole,
      permissions: testPermissions,
    });

    const result = await authenticateRequest(
      { authorization: `Bearer ${token}` },
      jwtConfig,
    );
    expect(result.authenticated).toBe(false);
  });

  it('rejects a JWT with wrong audience', async () => {
    const wrongAudienceConfig: JwtConfig = {
      ...jwtConfig,
      audience: 'evil-audience',
    };

    const token = await createAccessToken(wrongAudienceConfig, {
      sub: testUserId,
      tid: testTenantId,
      role: 'agent' as UserRole,
      permissions: testPermissions,
    });

    const result = await authenticateRequest(
      { authorization: `Bearer ${token}` },
      jwtConfig,
    );
    expect(result.authenticated).toBe(false);
  });
});

// ── Cross-Tenant Access ───────────────────────────────────────────────

describe('Cross-tenant access', () => {
  it('blocks non-admin user from accessing another tenant resources', () => {
    const ctx = buildTenantContext({
      roles: ['agent'],
    });

    expect(() => {
      requireTenant(ctx, 'tenant-other-999');
    }).toThrow(AppError);
  });

  it('allows super_admin to access any tenant', () => {
    const ctx = buildTenantContext({
      roles: ['super_admin'],
    });

    expect(() => {
      requireTenant(ctx, 'tenant-other-999');
    }).not.toThrow();
  });

  it('blocks viewer from accessing another tenant', () => {
    const ctx = buildTenantContext({
      roles: ['viewer'],
    });

    expect(() => {
      requireTenant(ctx, 'different-tenant');
    }).toThrow();
  });

  it('blocks manager from accessing another tenant', () => {
    const ctx = buildTenantContext({
      roles: ['manager'],
    });

    expect(() => {
      requireTenant(ctx, 'different-tenant');
    }).toThrow();
  });

  it('blocks tenant_admin from accessing another tenant', () => {
    const ctx = buildTenantContext({
      roles: ['tenant_admin'],
    });

    expect(() => {
      requireTenant(ctx, 'different-tenant');
    }).toThrow();
  });
});

// ── Role Hierarchy Enforcement ────────────────────────────────────────

describe('Role hierarchy enforcement', () => {
  it('blocks viewer from agent-level operations', () => {
    const ctx = buildTenantContext({ roles: ['viewer'] });
    expect(() => requireRole(ctx, 'agent')).toThrow(AuthorizationError);
  });

  it('blocks agent from manager-level operations', () => {
    const ctx = buildTenantContext({ roles: ['agent'] });
    expect(() => requireRole(ctx, 'manager')).toThrow(AuthorizationError);
  });

  it('blocks manager from tenant_admin-level operations', () => {
    const ctx = buildTenantContext({ roles: ['manager'] });
    expect(() => requireRole(ctx, 'tenant_admin')).toThrow(AuthorizationError);
  });

  it('blocks tenant_admin from super_admin-level operations', () => {
    const ctx = buildTenantContext({ roles: ['tenant_admin'] });
    expect(() => requireRole(ctx, 'super_admin')).toThrow(AuthorizationError);
  });

  it('allows super_admin for any role requirement', () => {
    const ctx = buildTenantContext({ roles: ['super_admin'] });
    expect(() => requireRole(ctx, 'viewer')).not.toThrow();
    expect(() => requireRole(ctx, 'agent')).not.toThrow();
    expect(() => requireRole(ctx, 'manager')).not.toThrow();
    expect(() => requireRole(ctx, 'tenant_admin')).not.toThrow();
    expect(() => requireRole(ctx, 'super_admin')).not.toThrow();
  });
});

// ── API Key Authentication ────────────────────────────────────────────

describe('API key authentication', () => {
  it('rejects API key when verifier is not configured', async () => {
    const result = await authenticateRequest(
      { 'x-api-key': 'ordr_testkey123' },
      jwtConfig,
      // No verifier
    );
    expect(result.authenticated).toBe(false);
  });

  it('rejects invalid API key via verifier', async () => {
    const verifier: ApiKeyVerifier = async () => null;

    const result = await authenticateRequest(
      { 'x-api-key': 'ordr_invalid_key' },
      jwtConfig,
      verifier,
    );
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.error.message).toContain('Invalid API key');
    }
  });

  it('accepts valid API key via verifier', async () => {
    const verifier: ApiKeyVerifier = async (key) => {
      if (key === 'ordr_valid_key') {
        return buildTenantContext();
      }
      return null;
    };

    const result = await authenticateRequest(
      { 'x-api-key': 'ordr_valid_key' },
      jwtConfig,
      verifier,
    );
    expect(result.authenticated).toBe(true);
    if (result.authenticated) {
      expect(result.context.tenantId).toBe(testTenantId);
    }
  });
});

// ── Malformed Token Formats ───────────────────────────────────────────

describe('Malformed token formats', () => {
  it('rejects Bearer with just garbage string', async () => {
    const result = await authenticateRequest(
      { authorization: 'Bearer AAAAgarbageAAAA' },
      jwtConfig,
    );
    expect(result.authenticated).toBe(false);
  });

  it('rejects a JWT with only header.payload (no signature)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'test', tid: 'test' })).toString('base64url');
    const result = await authenticateRequest(
      { authorization: `Bearer ${header}.${payload}` },
      jwtConfig,
    );
    expect(result.authenticated).toBe(false);
  });

  it('rejects token with HS256 algorithm (algorithm confusion attack)', async () => {
    // Construct a token claiming HS256 but we only accept RS256
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: testUserId,
      tid: testTenantId,
      role: 'super_admin',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');

    const fakeSignature = Buffer.from('fakesignature').toString('base64url');
    const token = `${header}.${payload}.${fakeSignature}`;

    const result = await authenticateRequest(
      { authorization: `Bearer ${token}` },
      jwtConfig,
    );
    expect(result.authenticated).toBe(false);
  });
});
