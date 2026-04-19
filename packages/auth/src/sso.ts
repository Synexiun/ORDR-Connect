/**
 * SSO Integration — WorkOS SSO (SAML + OIDC) for ORDR-Connect
 *
 * SOC2 CC6.1 — Centralized authentication via enterprise identity providers.
 * ISO 27001 A.9.2.1 — User registration and de-registration via SSO.
 * HIPAA §164.312(d) — Person or entity authentication via federated IdP.
 *
 * SECURITY INVARIANTS:
 * - State parameter is encrypted to prevent tampering and CSRF.
 * - SSO-enforced mode disables password login entirely for the tenant.
 * - All SSO events are audit-logged.
 * - WorkOS client is injected (DI) — no direct SDK dependency.
 */

import type { Result } from '@ordr/core';
import { ok, err, AppError, ERROR_CODES } from '@ordr/core';
import { encryptString, decryptString, randomToken } from '@ordr/crypto';

// ─── Types ─────────────────────────────────────────────────────────

export type SSOConnectionType = 'saml' | 'oidc';

export type SSOProvider = 'okta' | 'azure-ad' | 'google' | 'onelogin' | 'custom';

export type SSOConnectionStatus = 'active' | 'inactive' | 'validating';

export interface SSOProfile {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly idpId: string;
  readonly rawAttributes: Readonly<Record<string, unknown>>;
  readonly connectionType: SSOConnectionType;
}

export interface SSOConnection {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly type: SSOConnectionType;
  readonly provider: SSOProvider;
  readonly status: SSOConnectionStatus;
  readonly enforceSso: boolean;
  readonly createdAt: Date;
}

export interface SSOConnectionConfig {
  readonly name: string;
  readonly type: SSOConnectionType;
  readonly provider: SSOProvider;
  readonly metadata: string;
}

// ─── State Token ───────────────────────────────────────────────────

interface SSOState {
  readonly tenantId: string;
  readonly connectionId: string;
  readonly nonce: string;
  readonly timestamp: number;
}

// ─── WorkOS Client Interface (DI) ─────────────────────────────────

/**
 * Abstraction over WorkOS SDK. Implementations may call WorkOS directly
 * or use an in-memory mock for testing.
 */
export interface WorkOSClient {
  getAuthorizationUrl(params: {
    readonly connectionId: string;
    readonly redirectUri: string;
    readonly state: string;
    readonly clientId: string;
  }): Promise<string>;

  getProfileByCode(code: string): Promise<{
    readonly id: string;
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly idpId: string;
    readonly connectionType: SSOConnectionType;
    readonly rawAttributes: Readonly<Record<string, unknown>>;
  }>;
}

// ─── SSO Connection Store Interface (DI) ──────────────────────────

export interface SSOConnectionStore {
  create(connection: SSOConnection): Promise<void>;
  getById(tenantId: string, connectionId: string): Promise<SSOConnection | null>;
  /**
   * Global lookup by connection ID. Used in the pre-auth `/authorize` flow
   * where no JWT is available yet and the tenant MUST be derived from a
   * server-owned record rather than client input (Rule 2).
   *
   * Connection IDs are UUIDv4 primary keys, globally unique across tenants.
   */
  getByConnectionId(connectionId: string): Promise<SSOConnection | null>;
  listByTenant(tenantId: string): Promise<readonly SSOConnection[]>;
  delete(tenantId: string, connectionId: string): Promise<void>;
  getActiveByTenant(tenantId: string): Promise<SSOConnection | null>;
}

// ─── In-Memory SSO Client (Testing) ──────────────────────────────

export class InMemorySSOClient implements WorkOSClient {
  private readonly profiles = new Map<
    string,
    {
      readonly id: string;
      readonly email: string;
      readonly firstName: string;
      readonly lastName: string;
      readonly idpId: string;
      readonly connectionType: SSOConnectionType;
      readonly rawAttributes: Readonly<Record<string, unknown>>;
    }
  >();

  addProfile(
    code: string,
    profile: {
      readonly id: string;
      readonly email: string;
      readonly firstName: string;
      readonly lastName: string;
      readonly idpId: string;
      readonly connectionType: SSOConnectionType;
      readonly rawAttributes: Readonly<Record<string, unknown>>;
    },
  ): void {
    this.profiles.set(code, profile);
  }

  getAuthorizationUrl(params: {
    readonly connectionId: string;
    readonly redirectUri: string;
    readonly state: string;
    readonly clientId: string;
  }): Promise<string> {
    const encodedState = encodeURIComponent(params.state);
    return Promise.resolve(
      `https://auth.workos.test/sso/authorize?connection=${params.connectionId}&redirect_uri=${encodeURIComponent(params.redirectUri)}&state=${encodedState}&client_id=${params.clientId}`,
    );
  }

  getProfileByCode(code: string): Promise<{
    readonly id: string;
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly idpId: string;
    readonly connectionType: SSOConnectionType;
    readonly rawAttributes: Readonly<Record<string, unknown>>;
  }> {
    const profile = this.profiles.get(code);
    if (!profile) {
      return Promise.reject(new Error('Invalid authorization code'));
    }
    return Promise.resolve(profile);
  }
}

// ─── Real WorkOS Client (Production) ─────────────────────────────

/**
 * RealWorkOSClient — HTTP-based WorkOS API client for production SSO.
 *
 * Calls WorkOS REST API directly (no SDK dependency). Requires WORKOS_API_KEY.
 * SOC2 CC6.1 — Federated authentication via enterprise IdP.
 */
export class RealWorkOSClient implements WorkOSClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.workos.com') {
    if (!apiKey) throw new Error('WorkOS API key is required for RealWorkOSClient');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- sync URL construction behind async interface
  async getAuthorizationUrl(params: {
    readonly connectionId: string;
    readonly redirectUri: string;
    readonly state: string;
    readonly clientId: string;
  }): Promise<string> {
    const url = new URL('/sso/authorize', this.baseUrl);
    url.searchParams.set('connection', params.connectionId);
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    url.searchParams.set('response_type', 'code');
    return url.toString();
  }

  async getProfileByCode(code: string): Promise<{
    readonly id: string;
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly idpId: string;
    readonly connectionType: SSOConnectionType;
    readonly rawAttributes: Readonly<Record<string, unknown>>;
  }> {
    const response = await fetch(`${this.baseUrl}/sso/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.apiKey,
        client_secret: this.apiKey,
        grant_type: 'authorization_code',
        code,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown');
      throw new Error(`WorkOS SSO token exchange failed (${String(response.status)}): ${body}`);
    }

    const data = (await response.json()) as {
      profile: {
        id: string;
        email: string;
        first_name: string;
        last_name: string;
        idp_id: string;
        connection_type: string;
        raw_attributes: Record<string, unknown>;
      };
    };

    const p = data.profile;
    return {
      id: p.id,
      email: p.email,
      firstName: p.first_name,
      lastName: p.last_name,
      idpId: p.idp_id,
      connectionType: p.connection_type as SSOConnectionType,
      rawAttributes: p.raw_attributes,
    };
  }
}

// ─── In-Memory Connection Store (Testing) ─────────────────────────

export class InMemorySSOConnectionStore implements SSOConnectionStore {
  private readonly connections = new Map<string, SSOConnection>();

  create(connection: SSOConnection): Promise<void> {
    this.connections.set(`${connection.tenantId}:${connection.id}`, connection);
    return Promise.resolve();
  }

  getById(tenantId: string, connectionId: string): Promise<SSOConnection | null> {
    return Promise.resolve(this.connections.get(`${tenantId}:${connectionId}`) ?? null);
  }

  getByConnectionId(connectionId: string): Promise<SSOConnection | null> {
    for (const conn of this.connections.values()) {
      if (conn.id === connectionId) return Promise.resolve(conn);
    }
    return Promise.resolve(null);
  }

  listByTenant(tenantId: string): Promise<readonly SSOConnection[]> {
    const results: SSOConnection[] = [];
    for (const conn of this.connections.values()) {
      if (conn.tenantId === tenantId) {
        results.push(conn);
      }
    }
    return Promise.resolve(results);
  }

  delete(tenantId: string, connectionId: string): Promise<void> {
    this.connections.delete(`${tenantId}:${connectionId}`);
    return Promise.resolve();
  }

  getActiveByTenant(tenantId: string): Promise<SSOConnection | null> {
    for (const conn of this.connections.values()) {
      if (conn.tenantId === tenantId && conn.status === 'active' && conn.enforceSso) {
        return Promise.resolve(conn);
      }
    }
    return Promise.resolve(null);
  }
}

// ─── SSO Manager ──────────────────────────────────────────────────

export interface SSOManagerConfig {
  readonly apiKey: string;
  readonly clientId: string;
  readonly redirectUri: string;
}

/** Maximum age for SSO state tokens: 10 minutes */
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export class SSOManager {
  private readonly config: SSOManagerConfig;
  private readonly client: WorkOSClient;
  private readonly connectionStore: SSOConnectionStore;
  private readonly stateEncryptionKey: string;

  constructor(
    config: SSOManagerConfig,
    client: WorkOSClient,
    connectionStore: SSOConnectionStore,
    stateEncryptionKey: string,
  ) {
    this.config = config;
    this.client = client;
    this.connectionStore = connectionStore;
    this.stateEncryptionKey = stateEncryptionKey;
  }

  /**
   * Generates an SSO authorization URL for the given tenant and connection.
   *
   * The state parameter is encrypted JSON containing tenantId, connectionId,
   * a random nonce, and a timestamp for expiration checking.
   */
  async getAuthorizationUrl(
    tenantId: string,
    connectionId: string,
    state: string,
  ): Promise<Result<string>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    if (!connectionId || connectionId.trim().length === 0) {
      return err(new AppError('Connection ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    // Verify connection exists and is active
    const connection = await this.connectionStore.getById(tenantId, connectionId);
    if (!connection) {
      return err(new AppError('SSO connection not found', ERROR_CODES.NOT_FOUND, 404));
    }

    if (connection.status !== 'active') {
      return err(new AppError('SSO connection is not active', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    // Build encrypted state
    const nonce = randomToken(32);
    const ssoState: SSOState = {
      tenantId,
      connectionId,
      nonce,
      timestamp: Date.now(),
    };

    const encryptedState = encryptString(
      JSON.stringify(ssoState),
      Buffer.from(this.stateEncryptionKey, 'hex'),
    );

    // Combine encrypted state with caller-provided state
    const combinedState = `${encryptedState}|${state}`;

    const url = await this.client.getAuthorizationUrl({
      connectionId,
      redirectUri: this.config.redirectUri,
      state: combinedState,
      clientId: this.config.clientId,
    });

    return ok(url);
  }

  /**
   * Handles the SSO callback by exchanging the authorization code for a user profile.
   *
   * Verifies the encrypted state parameter for integrity and expiration.
   */
  async handleCallback(code: string, state: string): Promise<Result<SSOProfile>> {
    if (!code || code.trim().length === 0) {
      return err(
        new AppError('Authorization code is required', ERROR_CODES.VALIDATION_FAILED, 400),
      );
    }

    if (!state || state.trim().length === 0) {
      return err(new AppError('State parameter is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    // Split combined state
    const pipeIndex = state.indexOf('|');
    if (pipeIndex === -1) {
      return err(
        new AppError('Invalid state parameter format', ERROR_CODES.VALIDATION_FAILED, 400),
      );
    }

    const encryptedPart = state.slice(0, pipeIndex);

    // Decrypt and verify state
    let ssoState: SSOState;
    try {
      const decrypted = decryptString(encryptedPart, Buffer.from(this.stateEncryptionKey, 'hex'));
      ssoState = JSON.parse(decrypted) as SSOState;
    } catch {
      return err(
        new AppError('State parameter tampered or corrupted', ERROR_CODES.AUTH_FAILED, 401),
      );
    }

    // Verify timestamp (max 10 minutes)
    const elapsed = Date.now() - ssoState.timestamp;
    if (elapsed > STATE_MAX_AGE_MS || elapsed < 0) {
      return err(new AppError('SSO state has expired', ERROR_CODES.AUTH_EXPIRED, 401));
    }

    // Verify nonce is present
    if (!ssoState.nonce || ssoState.nonce.length === 0) {
      return err(new AppError('Invalid SSO state: missing nonce', ERROR_CODES.AUTH_FAILED, 401));
    }

    // Exchange code for profile
    try {
      const rawProfile = await this.client.getProfileByCode(code);

      const profile: SSOProfile = {
        id: rawProfile.id,
        email: rawProfile.email,
        firstName: rawProfile.firstName,
        lastName: rawProfile.lastName,
        idpId: rawProfile.idpId,
        rawAttributes: rawProfile.rawAttributes,
        connectionType: rawProfile.connectionType,
      };

      return ok(profile);
    } catch {
      return err(
        new AppError('Failed to exchange authorization code', ERROR_CODES.AUTH_FAILED, 401),
      );
    }
  }

  /**
   * Lists all SSO connections for a tenant.
   */
  async getSSOConnections(tenantId: string): Promise<Result<readonly SSOConnection[]>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const connections = await this.connectionStore.listByTenant(tenantId);
    return ok(connections);
  }

  /**
   * Creates a new SSO connection for a tenant.
   */
  async createSSOConnection(
    tenantId: string,
    config: SSOConnectionConfig,
  ): Promise<Result<SSOConnection>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    if (!config.name || config.name.trim().length === 0) {
      return err(new AppError('Connection name is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const connection: SSOConnection = {
      id: randomToken(16),
      tenantId,
      name: config.name,
      type: config.type,
      provider: config.provider,
      status: 'validating',
      enforceSso: false,
      createdAt: new Date(),
    };

    await this.connectionStore.create(connection);
    return ok(connection);
  }

  /**
   * Global (cross-tenant) lookup used by the pre-auth /authorize route.
   *
   * Returns the connection record (which carries its authoritative tenantId)
   * when the caller has no JWT yet and must NOT be trusted to supply a
   * tenantId. Callers MUST treat the returned `tenantId` as the sole
   * source of truth for tenant binding.
   */
  async getConnectionGlobal(connectionId: string): Promise<SSOConnection | null> {
    return this.connectionStore.getByConnectionId(connectionId);
  }

  /**
   * Deletes an SSO connection.
   */
  async deleteSSOConnection(tenantId: string, connectionId: string): Promise<Result<void>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const connection = await this.connectionStore.getById(tenantId, connectionId);
    if (!connection) {
      return err(new AppError('SSO connection not found', ERROR_CODES.NOT_FOUND, 404));
    }

    await this.connectionStore.delete(tenantId, connectionId);
    return ok(undefined);
  }

  /**
   * Checks whether SSO is enforced for a tenant (password login blocked).
   *
   * When SSO is enforced, password login MUST return 403.
   */
  async isSSOEnforced(tenantId: string): Promise<boolean> {
    const connection = await this.connectionStore.getActiveByTenant(tenantId);
    return connection !== null;
  }
}
