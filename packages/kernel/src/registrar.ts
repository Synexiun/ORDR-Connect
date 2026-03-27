/**
 * LimbRegistrar — One-time registration with Synexiun Core.
 *
 * Called once at startup. Sends the limb's Ed25519 public key to Core
 * in exchange for a signed LimbCertificate. The certificate is stored
 * in memory and used to authenticate the limb's identity.
 *
 * Registration endpoint: POST {SYNEX_CORE_URL}/limbs/{limb_id}/register
 * Auth: Bearer {SYNEX_CORE_ADMIN_TOKEN}
 *
 * RULE 2 (Auth): Limbs must be registered before sending diode messages.
 * RULE 5 (Secrets): Admin token must come from env var, never hardcoded.
 */

import type { LimbIdentity } from './identity.js';
import type { RegisterResponse } from './types.js';

export class RegistrationError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'RegistrationError';
  }
}

export interface RegistrarOptions {
  /** Base URL of the Synex Core server. */
  coreUrl: string;
  /** Admin bearer token for Core. Must come from SYNEX_CORE_ADMIN_TOKEN env var. */
  adminToken: string;
  /** Human-readable display name for this limb (shown in Core dashboard). */
  displayName?: string;
  /** Certificate validity in days. Default: 365. */
  validityDays?: number;
  /** Request timeout in milliseconds. Default: 15_000. */
  timeoutMs?: number;
}

export class LimbRegistrar {
  private readonly _timeoutMs: number;

  constructor(
    private readonly _identity: LimbIdentity,
    private readonly _opts: RegistrarOptions,
  ) {
    this._timeoutMs = _opts.timeoutMs ?? 15_000;
  }

  /**
   * Register this limb with Core and obtain a signed certificate.
   *
   * Safe to call on every startup — Core will return the existing
   * registration if the limb_id is already registered.
   *
   * @throws RegistrationError if Core rejects the registration
   */
  async register(): Promise<RegisterResponse> {
    const url = `${this._opts.coreUrl}/limbs/${this._identity.limbId}/register`;

    const body = {
      display_name: this._opts.displayName ?? this._identity.limbId,
      validity_days: this._opts.validityDays ?? 365,
      public_key: this._identity.publicKeyHex,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this._timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._opts.adminToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new RegistrationError(
        `Registration request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const responseBody = await response.text();

    if (!response.ok) {
      throw new RegistrationError(
        `Core rejected registration: HTTP ${response.status.toString()}`,
        response.status,
        responseBody,
      );
    }

    return JSON.parse(responseBody) as RegisterResponse;
  }
}
