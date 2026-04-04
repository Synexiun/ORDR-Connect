/**
 * Integration Credential Manager
 *
 * Wraps FieldEncryptor for OAuth token lifecycle management.
 * access_token, refresh_token, and webhook_secret are each encrypted with a
 * separately derived key (different field names → different HKDF-derived keys).
 *
 * SECURITY:
 * - Plaintext tokens never stored, never logged, never returned to clients
 * - ensureFreshCredentials proactively refreshes 5 minutes before expiry
 * - Token refresh failure transitions config to 'error' status
 *
 * SOC2 CC6.1 — RESTRICTED credentials encrypted at rest
 * HIPAA §164.312(e) — Transmission security: tokens only sent over TLS
 */

import type { FieldEncryptor } from '@ordr/crypto';
import type { OAuthCredentials } from './types.js';
import type { CRMAdapter, OAuthConfig } from './adapter.js';
import type { AuditLogger } from '@ordr/audit';

// ── Error Types ───────────────────────────────────────────────────

export class IntegrationNotConnectedError extends Error {
  readonly code = 'INTEGRATION_NOT_CONNECTED' as const;
  constructor(provider: string) {
    super(`Integration not connected: ${provider}`);
    this.name = 'IntegrationNotConnectedError';
  }
}

export class IntegrationTokenExpiredError extends Error {
  readonly code = 'INTEGRATION_TOKEN_EXPIRED' as const;
  constructor(provider: string) {
    super(`Token refresh failed for integration: ${provider}`);
    this.name = 'IntegrationTokenExpiredError';
  }
}

// ── Public Types ──────────────────────────────────────────────────

export interface OAuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  readonly expiresAt: Date;
  readonly scopes: string[];
  readonly instanceUrl?: string | undefined;
}

export interface IntegrationConfigRow {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly status: string;
  readonly accessTokenEnc: string | null;
  readonly refreshTokenEnc: string | null;
  readonly webhookSecretEnc: string | null;
  readonly tokenExpiresAt: Date | null;
  readonly scopes: string[] | null;
  readonly instanceUrl: string | null;
}

// ── Dependency Types ──────────────────────────────────────────────

export interface CredentialManagerDeps {
  readonly getIntegrationConfig: (params: {
    tenantId: string;
    provider: string;
  }) => Promise<IntegrationConfigRow | null>;

  readonly upsertIntegrationConfig: (params: {
    tenantId: string;
    provider: string;
    accessTokenEnc: string;
    refreshTokenEnc: string;
    tokenExpiresAt: Date;
    scopes: string[];
    instanceUrl: string | undefined;
    status: 'connected';
  }) => Promise<void>;

  readonly setIntegrationStatus: (params: {
    tenantId: string;
    provider: string;
    status: 'error' | 'rate_limited' | 'disconnected';
    lastError?: string | undefined;
  }) => Promise<void>;

  readonly nullifyCredentials: (params: { tenantId: string; provider: string }) => Promise<void>;

  readonly auditLogger: Pick<AuditLogger, 'log'>;
}

// ── Constants ─────────────────────────────────────────────────────

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

// ── saveCredentials ───────────────────────────────────────────────

export async function saveCredentials(
  deps: CredentialManagerDeps,
  tenantId: string,
  provider: string,
  tokens: OAuthTokens,
  fieldEncryptor: FieldEncryptor,
): Promise<void> {
  const accessTokenEnc = fieldEncryptor.encryptField('access_token', tokens.accessToken);
  const refreshTokenEnc = fieldEncryptor.encryptField('refresh_token', tokens.refreshToken);

  await deps.upsertIntegrationConfig({
    tenantId,
    provider,
    accessTokenEnc,
    refreshTokenEnc,
    tokenExpiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    instanceUrl: tokens.instanceUrl,
    status: 'connected',
  });

  await deps.auditLogger.log({
    tenantId,
    eventType: 'integration.connected',
    actorType: 'system',
    actorId: 'api',
    resource: 'integration_configs',
    resourceId: `${tenantId}:${provider}`,
    action: 'connected',
    details: { provider },
    timestamp: new Date(),
  });
}

// ── getCredentials ────────────────────────────────────────────────

export async function getCredentials(
  deps: CredentialManagerDeps,
  tenantId: string,
  provider: string,
  fieldEncryptor: FieldEncryptor,
): Promise<OAuthCredentials> {
  const row = await deps.getIntegrationConfig({ tenantId, provider });

  if (
    row === null ||
    row.status === 'disconnected' ||
    row.accessTokenEnc === null ||
    row.refreshTokenEnc === null
  ) {
    throw new IntegrationNotConnectedError(provider);
  }

  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = fieldEncryptor.decryptField('access_token', row.accessTokenEnc);
    refreshToken = fieldEncryptor.decryptField('refresh_token', row.refreshTokenEnc);
  } catch {
    throw new IntegrationNotConnectedError(provider);
  }

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresAt: row.tokenExpiresAt ?? new Date(0),
    scope: (row.scopes ?? []).join(' '),
    instanceUrl: row.instanceUrl ?? undefined,
  };
}

// ── ensureFreshCredentials ────────────────────────────────────────

export async function ensureFreshCredentials(
  deps: CredentialManagerDeps,
  tenantId: string,
  provider: string,
  adapter: Pick<CRMAdapter, 'refreshAccessToken'>,
  oauthConfig: OAuthConfig,
  fieldEncryptor: FieldEncryptor,
): Promise<OAuthCredentials> {
  const credentials = await getCredentials(deps, tenantId, provider, fieldEncryptor);

  const isStale = credentials.expiresAt.getTime() < Date.now() + REFRESH_BUFFER_MS;
  if (!isStale) {
    return credentials;
  }

  try {
    const result = await adapter.refreshAccessToken(oauthConfig, credentials.refreshToken);
    await saveCredentials(
      deps,
      tenantId,
      provider,
      {
        accessToken: result.credentials.accessToken,
        refreshToken: result.credentials.refreshToken,
        tokenType: result.credentials.tokenType,
        expiresAt: result.credentials.expiresAt,
        scopes: result.credentials.scope.split(' ').filter(Boolean),
        instanceUrl: result.instanceUrl ?? result.credentials.instanceUrl,
      },
      fieldEncryptor,
    );
    return result.credentials;
  } catch {
    await deps.setIntegrationStatus({
      tenantId,
      provider,
      status: 'error',
      lastError: 'Token refresh failed',
    });
    throw new IntegrationTokenExpiredError(provider);
  }
}
