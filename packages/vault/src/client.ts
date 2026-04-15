/**
 * VaultClient — HashiCorp Vault KV v2 HTTP client
 *
 * Authenticates via Kubernetes auth method (pod service account JWT).
 * Renews the Vault token automatically at 80% of TTL.
 * All operations are no-ops when VAULT_ADDR is absent (dev/test mode).
 *
 * Rule 5 — Secrets from external secret manager; short-lived leases.
 * SOC2 CC6.1 — Access controls: K8s auth + least-privilege Vault policies.
 */

import { readFile } from 'node:fs/promises';

export interface VaultMetadata {
  readonly createdTime: Date;
  readonly version: number;
}

export class VaultClient {
  private readonly addr: string | undefined;
  private readonly role: string | undefined;
  private readonly mount: string;
  private token: string | null = null;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const addr = process.env['VAULT_ADDR']?.trim();
    this.addr = addr !== undefined && addr !== '' ? addr : undefined;
    const role = process.env['VAULT_ROLE']?.trim();
    this.role = role !== undefined && role !== '' ? role : undefined;
    const mount = process.env['VAULT_MOUNT']?.trim();
    this.mount = mount !== undefined && mount !== '' ? mount : 'secret';
  }

  get isEnabled(): boolean {
    return this.addr !== undefined;
  }

  /** Authenticate with Vault using the pod's K8s service account JWT. */
  async authenticate(): Promise<void> {
    if (!this.isEnabled || this.role === undefined) return;

    const jwt = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');

    const res = await fetch(`${this.addr}/v1/auth/kubernetes/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jwt: jwt.trim(), role: this.role }),
    });

    if (!res.ok) {
      throw new Error(`[ORDR:VAULT] Auth failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      auth: { client_token: string; lease_duration: number };
    };
    this.token = data.auth.client_token;
    const ttlMs = data.auth.lease_duration * 1000;

    // Schedule token renewal at 80% of TTL
    if (this.renewTimer !== null) clearTimeout(this.renewTimer);
    this.renewTimer = setTimeout(() => void this.renewToken(), ttlMs * 0.8);
  }

  private async renewToken(): Promise<void> {
    if (!this.isEnabled || this.token === null) return;
    try {
      const res = await fetch(`${this.addr}/v1/auth/token/renew-self`, {
        method: 'PUT',
        headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        console.warn(
          JSON.stringify({ level: 'warn', component: 'vault', event: 'token_renewal_failed' }),
        );
        await this.authenticate();
        return;
      }
      const data = (await res.json()) as { auth: { lease_duration: number } };
      const ttlMs = data.auth.lease_duration * 1000;
      if (this.renewTimer !== null) clearTimeout(this.renewTimer);
      this.renewTimer = setTimeout(() => void this.renewToken(), ttlMs * 0.8);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          component: 'vault',
          event: 'token_renewal_error',
          error: err instanceof Error ? err.message : 'unknown',
        }),
      );
      // Best-effort re-auth — if this also fails, token expires and callers will throw
      await this.authenticate().catch(() => undefined);
    }
  }

  private authHeaders(): Record<string, string> {
    if (this.token === null)
      throw new Error('[ORDR:VAULT] Not authenticated — call authenticate() first');
    return { 'X-Vault-Token': this.token };
  }

  /** Read the current value of a secret. Returns undefined if not found. */
  async get(path: string): Promise<string | undefined> {
    if (!this.isEnabled) return undefined;
    const res = await fetch(`${this.addr}/v1/${this.mount}/data/${path}`, {
      headers: this.authHeaders(),
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`[ORDR:VAULT] GET ${path} failed: ${res.status}`);
    const data = (await res.json()) as { data: { data: Record<string, string> } };
    return data.data.data['value'];
  }

  /** Write a new version of a secret. */
  async put(path: string, value: string): Promise<void> {
    if (!this.isEnabled) return;
    const res = await fetch(`${this.addr}/v1/${this.mount}/data/${path}`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { value } }),
    });
    if (!res.ok) throw new Error(`[ORDR:VAULT] PUT ${path} failed: ${res.status}`);
  }

  /** Read the metadata (current version, created_time) for a secret path. */
  async getMetadata(path: string): Promise<VaultMetadata> {
    if (!this.isEnabled) return { createdTime: new Date(0), version: 0 };
    const res = await fetch(`${this.addr}/v1/${this.mount}/metadata/${path}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`[ORDR:VAULT] getMetadata ${path} failed: ${res.status}`);
    const data = (await res.json()) as {
      data: {
        current_version: number;
        versions: Record<string, { created_time: string }>;
      };
    };
    const currentVersion = data.data.current_version;
    const versionInfo = data.data.versions[String(currentVersion)];
    return {
      version: currentVersion,
      createdTime: new Date(versionInfo?.created_time ?? 0),
    };
  }

  /** Read a specific historical version of a secret. */
  async getVersion(path: string, version: number): Promise<string> {
    if (!this.isEnabled) return '';
    const res = await fetch(`${this.addr}/v1/${this.mount}/data/${path}?version=${version}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`[ORDR:VAULT] getVersion ${path}@${version} failed: ${res.status}`);
    }
    const data = (await res.json()) as { data: { data: Record<string, string> } };
    const value = data.data.data['value'];
    if (value === undefined || value === '') {
      throw new Error(`[ORDR:VAULT] getVersion: 'value' key missing in ${path}@${version}`);
    }
    return value;
  }

  /**
   * Soft-delete a specific version of a secret in Vault KV v2.
   * "Soft delete" marks the version as deleted but retains data for audit
   * (per Rule 3: 7-year retention). Does NOT destroy/shred the key material.
   */
  async softDeleteVersion(path: string, version: number): Promise<void> {
    if (!this.isEnabled) return;
    const res = await fetch(`${this.addr}/v1/${this.mount}/delete/${path}`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ versions: [version] }),
    });
    if (!res.ok) {
      throw new Error(`[ORDR:VAULT] softDeleteVersion ${path}@${version} failed: ${res.status}`);
    }
    console.warn(
      JSON.stringify({
        level: 'warn',
        component: 'vault',
        event: 'version_soft_deleted',
        path,
        version,
      }),
    );
  }

  /** Stop the token renewal timer. Call on process shutdown. */
  destroy(): void {
    if (this.renewTimer !== null) {
      clearTimeout(this.renewTimer);
      this.renewTimer = null;
    }
  }
}
