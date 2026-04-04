/**
 * Credential Manager tests
 *
 * SOC2 CC6.1 — Credentials stored encrypted; never in plaintext.
 * Verifies:
 * - saveCredentials encrypts tokens and upserts the config row
 * - getCredentials decrypts tokens from the row
 * - getCredentials throws IntegrationNotConnectedError when row missing
 * - getCredentials throws IntegrationNotConnectedError when status=disconnected
 * - getCredentials throws IntegrationNotConnectedError when decryption fails
 * - ensureFreshCredentials returns existing credentials when not stale
 * - ensureFreshCredentials refreshes when token expires within 5 minutes
 * - ensureFreshCredentials throws IntegrationTokenExpiredError on refresh failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FieldEncryptor } from '@ordr/crypto';
import {
  saveCredentials,
  getCredentials,
  ensureFreshCredentials,
  IntegrationNotConnectedError,
  IntegrationTokenExpiredError,
} from '../credential-manager.js';
import type { CredentialManagerDeps, IntegrationConfigRow } from '../credential-manager.js';

const TENANT_ID = 'tenant-1';
const PROVIDER = 'salesforce';
const fieldEncryptor = new FieldEncryptor(Buffer.from('test-key-exactly-32-bytes!!!!!!!', 'utf8'));

const FUTURE = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
const STALE = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes from now (< 5 min buffer)
const PAST = new Date(Date.now() - 60 * 1000); // already expired

function makeRow(overrides: Partial<IntegrationConfigRow> = {}): IntegrationConfigRow {
  const enc = fieldEncryptor.encryptField('access_token', 'access-tok');
  const refEnc = fieldEncryptor.encryptField('refresh_token', 'refresh-tok');
  return {
    id: 'cfg-1',
    tenantId: TENANT_ID,
    provider: PROVIDER,
    status: 'connected',
    accessTokenEnc: enc,
    refreshTokenEnc: refEnc,
    webhookSecretEnc: null,
    tokenExpiresAt: FUTURE,
    scopes: ['read', 'write'],
    instanceUrl: 'https://ordr.salesforce.com',
    ...overrides,
  };
}

const mockUpsert = vi.fn().mockResolvedValue(undefined);
const mockSetStatus = vi.fn().mockResolvedValue(undefined);
const mockNullify = vi.fn().mockResolvedValue(undefined);
const mockAuditLog = vi.fn().mockResolvedValue(undefined);

function makeDeps(getRow: IntegrationConfigRow | null = makeRow()): CredentialManagerDeps {
  return {
    getIntegrationConfig: vi.fn().mockResolvedValue(getRow),
    upsertIntegrationConfig: mockUpsert,
    setIntegrationStatus: mockSetStatus,
    nullifyCredentials: mockNullify,
    auditLogger: { log: mockAuditLog },
  };
}

describe('saveCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encrypts tokens and calls upsert', async () => {
    const deps = makeDeps();
    await saveCredentials(
      deps,
      TENANT_ID,
      PROVIDER,
      {
        accessToken: 'at',
        refreshToken: 'rt',
        tokenType: 'Bearer',
        expiresAt: FUTURE,
        scopes: ['read'],
      },
      fieldEncryptor,
    );

    expect(mockUpsert).toHaveBeenCalledOnce();
    const call = mockUpsert.mock.calls[0][0] as Record<string, unknown>;
    // Tokens must be encrypted (not equal to plaintext)
    expect(call.accessTokenEnc).not.toBe('at');
    expect(call.refreshTokenEnc).not.toBe('rt');
    expect(call.status).toBe('connected');
  });

  it('emits integration.connected audit event', async () => {
    const deps = makeDeps();
    await saveCredentials(
      deps,
      TENANT_ID,
      PROVIDER,
      {
        accessToken: 'at',
        refreshToken: 'rt',
        tokenType: 'Bearer',
        expiresAt: FUTURE,
        scopes: [],
      },
      fieldEncryptor,
    );

    const calls = mockAuditLog.mock.calls as Array<[{ eventType: string }]>;
    expect(calls.some(([e]) => e.eventType === 'integration.connected')).toBe(true);
  });
});

describe('getCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('decrypts access_token and refresh_token from stored ciphertext', async () => {
    const deps = makeDeps();
    const creds = await getCredentials(deps, TENANT_ID, PROVIDER, fieldEncryptor);

    expect(creds.accessToken).toBe('access-tok');
    expect(creds.refreshToken).toBe('refresh-tok');
  });

  it('throws IntegrationNotConnectedError when row is null', async () => {
    const deps = makeDeps(null);
    await expect(getCredentials(deps, TENANT_ID, PROVIDER, fieldEncryptor)).rejects.toBeInstanceOf(
      IntegrationNotConnectedError,
    );
  });

  it('throws IntegrationNotConnectedError when status is disconnected', async () => {
    const deps = makeDeps(makeRow({ status: 'disconnected' }));
    await expect(getCredentials(deps, TENANT_ID, PROVIDER, fieldEncryptor)).rejects.toBeInstanceOf(
      IntegrationNotConnectedError,
    );
  });

  it('throws IntegrationNotConnectedError when accessTokenEnc is null', async () => {
    const deps = makeDeps(makeRow({ accessTokenEnc: null }));
    await expect(getCredentials(deps, TENANT_ID, PROVIDER, fieldEncryptor)).rejects.toBeInstanceOf(
      IntegrationNotConnectedError,
    );
  });
});

describe('ensureFreshCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const oauthConfig = {
    clientId: 'cid',
    clientSecret: 'cs',
    redirectUri: 'https://app.test/cb',
    scopes: ['read'],
  };

  it('returns credentials unchanged when not stale', async () => {
    const deps = makeDeps(makeRow({ tokenExpiresAt: FUTURE }));
    const mockAdapter = { refreshAccessToken: vi.fn() };

    const creds = await ensureFreshCredentials(
      deps,
      TENANT_ID,
      PROVIDER,
      mockAdapter,
      oauthConfig,
      fieldEncryptor,
    );

    expect(creds.accessToken).toBe('access-tok');
    expect(mockAdapter.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes token when expiry is within 5-minute buffer', async () => {
    const deps = makeDeps(makeRow({ tokenExpiresAt: STALE }));
    const newExpiry = new Date(Date.now() + 3600_000);
    const mockAdapter = {
      refreshAccessToken: vi.fn().mockResolvedValue({
        credentials: {
          accessToken: 'new-at',
          refreshToken: 'new-rt',
          tokenType: 'Bearer',
          expiresAt: newExpiry,
          scope: 'read',
        },
      }),
    };

    const creds = await ensureFreshCredentials(
      deps,
      TENANT_ID,
      PROVIDER,
      mockAdapter,
      oauthConfig,
      fieldEncryptor,
    );

    expect(creds.accessToken).toBe('new-at');
    expect(mockUpsert).toHaveBeenCalled();
  });

  it('throws IntegrationTokenExpiredError and sets error status on refresh failure', async () => {
    const deps = makeDeps(makeRow({ tokenExpiresAt: PAST }));
    const mockAdapter = {
      refreshAccessToken: vi.fn().mockRejectedValue(new Error('API error')),
    };

    await expect(
      ensureFreshCredentials(deps, TENANT_ID, PROVIDER, mockAdapter, oauthConfig, fieldEncryptor),
    ).rejects.toBeInstanceOf(IntegrationTokenExpiredError);

    expect(mockSetStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });
});
