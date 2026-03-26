/**
 * JWT Token Management — RS256 asymmetric signing with `jose`
 *
 * SOC2 CC6.1 — Token-based authentication with cryptographic verification.
 * ISO 27001 A.9.4.2 — Secure log-on procedures.
 * HIPAA §164.312(d) — Person or entity authentication.
 *
 * SECURITY INVARIANTS:
 * - NEVER uses HS256 (shared secret). Always RS256 with key pair.
 * - Every token includes a `jti` (JWT ID) for revocation tracking.
 * - Access tokens are short-lived (15 min default).
 * - Refresh tokens use family-based rotation for theft detection.
 */

import { SignJWT, jwtVerify, importPKCS8, importSPKI } from 'jose';
import type { KeyLike, JWTPayload } from 'jose';
import type { UserRole, Permission } from '@ordr/core';
import { randomUUID } from '@ordr/crypto';

// ─── Configuration ─────────────────────────────────────────────────

export interface JwtConfig {
  readonly privateKey: KeyLike;
  readonly publicKey: KeyLike;
  readonly accessTokenTtl: number;
  readonly refreshTokenTtl: number;
  readonly issuer: string;
  readonly audience: string;
}

// ─── Token Payloads ────────────────────────────────────────────────

export interface AccessTokenPayload {
  readonly sub: string;
  readonly tid: string;
  readonly role: UserRole;
  readonly permissions: readonly Permission[];
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
}

export interface RefreshTokenPayload {
  readonly sub: string;
  readonly tid: string;
  readonly jti: string;
  readonly family: string;
  readonly iat: number;
  readonly exp: number;
}

// ─── Internal claim shapes (what jose puts in the JWT) ─────────────

interface AccessTokenClaims extends JWTPayload {
  readonly tid: string;
  readonly role: UserRole;
  readonly permissions: readonly Permission[];
}

interface RefreshTokenClaims extends JWTPayload {
  readonly tid: string;
  readonly family: string;
}

// ─── Constants ─────────────────────────────────────────────────────

const ALGORITHM = 'RS256' as const;
const DEFAULT_ACCESS_TTL_SECONDS = 900; // 15 minutes
const DEFAULT_REFRESH_TTL_SECONDS = 604_800; // 7 days

// ─── Token Creation ────────────────────────────────────────────────

/**
 * Creates a signed RS256 access token.
 *
 * Access tokens are short-lived and carry the full authorization context
 * (role, permissions, tenant ID) so that downstream services can make
 * access-control decisions without a database lookup.
 */
export async function createAccessToken(
  config: JwtConfig,
  payload: {
    readonly sub: string;
    readonly tid: string;
    readonly role: UserRole;
    readonly permissions: readonly Permission[];
    readonly jti?: string;
  },
): Promise<string> {
  const jti = payload.jti ?? randomUUID();
  const ttl = config.accessTokenTtl || DEFAULT_ACCESS_TTL_SECONDS;

  return new SignJWT({
    tid: payload.tid,
    role: payload.role,
    permissions: payload.permissions as Permission[],
  } satisfies Omit<AccessTokenClaims, keyof JWTPayload>)
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setJti(jti)
    .sign(config.privateKey);
}

/**
 * Creates a signed RS256 refresh token.
 *
 * Refresh tokens are longer-lived and carry a `family` identifier used
 * to detect token reuse (theft). If a refresh token from an already-used
 * family is presented, the entire family is revoked.
 */
export async function createRefreshToken(
  config: JwtConfig,
  payload: {
    readonly sub: string;
    readonly tid: string;
    readonly family: string;
    readonly jti?: string;
  },
): Promise<string> {
  const jti = payload.jti ?? randomUUID();
  const ttl = config.refreshTokenTtl || DEFAULT_REFRESH_TTL_SECONDS;

  return new SignJWT({
    tid: payload.tid,
    family: payload.family,
  } satisfies Omit<RefreshTokenClaims, keyof JWTPayload>)
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setJti(jti)
    .sign(config.privateKey);
}

// ─── Token Verification ────────────────────────────────────────────

/**
 * Verifies an access token's signature, expiration, issuer, and audience.
 * Returns the decoded payload with all authorization claims.
 *
 * @throws Error if the token is invalid, expired, or signed with the wrong key.
 */
export async function verifyAccessToken(
  config: JwtConfig,
  token: string,
): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, config.publicKey, {
    algorithms: [ALGORITHM],
    issuer: config.issuer,
    audience: config.audience,
  });

  const claims = payload as unknown as AccessTokenClaims;

  if (!payload.sub || !claims.tid || !claims.role || !payload.jti) {
    throw new Error('Access token missing required claims');
  }

  return {
    sub: payload.sub,
    tid: claims.tid,
    role: claims.role,
    permissions: claims.permissions ?? [],
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
    jti: payload.jti,
  };
}

/**
 * Verifies a refresh token's signature, expiration, issuer, and audience.
 * Returns the decoded payload including the family identifier.
 *
 * @throws Error if the token is invalid, expired, or signed with the wrong key.
 */
export async function verifyRefreshToken(
  config: JwtConfig,
  token: string,
): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, config.publicKey, {
    algorithms: [ALGORITHM],
    issuer: config.issuer,
    audience: config.audience,
  });

  const claims = payload as unknown as RefreshTokenClaims;

  if (!payload.sub || !claims.tid || !claims.family || !payload.jti) {
    throw new Error('Refresh token missing required claims');
  }

  return {
    sub: payload.sub,
    tid: claims.tid,
    jti: payload.jti,
    family: claims.family,
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
  };
}

// ─── Key Loading ───────────────────────────────────────────────────

/**
 * Parses PEM-encoded RSA key pair and returns a partial JwtConfig.
 *
 * Call this once at startup with the keys from your secrets manager,
 * then spread the result into your full JwtConfig.
 *
 * @param privateKeyPem - PKCS#8 PEM private key
 * @param publicKeyPem - SPKI PEM public key
 * @param options - Optional overrides for TTLs, issuer, audience
 * @returns JwtConfig with loaded keys and defaults
 */
export async function loadKeyPair(
  privateKeyPem: string,
  publicKeyPem: string,
  options: {
    readonly accessTokenTtl?: number;
    readonly refreshTokenTtl?: number;
    readonly issuer?: string;
    readonly audience?: string;
  } = {},
): Promise<JwtConfig> {
  const privateKey = await importPKCS8(privateKeyPem, ALGORITHM);
  const publicKey = await importSPKI(publicKeyPem, ALGORITHM);

  return {
    privateKey,
    publicKey,
    accessTokenTtl: options.accessTokenTtl ?? DEFAULT_ACCESS_TTL_SECONDS,
    refreshTokenTtl: options.refreshTokenTtl ?? DEFAULT_REFRESH_TTL_SECONDS,
    issuer: options.issuer ?? 'ordr-connect',
    audience: options.audience ?? 'ordr-connect',
  };
}
