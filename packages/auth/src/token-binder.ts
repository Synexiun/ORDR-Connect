/**
 * Token Binder — JWT fingerprint binding to client context
 *
 * Binds a JWT to the client's IP address and User-Agent by embedding a
 * fingerprint hash in the token payload. On subsequent requests, the
 * fingerprint is re-computed and compared. Mismatches indicate:
 *   - Token theft (attacker using a stolen JWT from a different machine)
 *   - Proxy/CDN changes (legitimate — configurable tolerance)
 *
 * Fingerprint computation:
 *   fpk = HMAC-SHA256(bindingSecret, SHA256(ip + ":" + userAgent))
 *
 * The SHA256 pre-hash ensures the HMAC input is always 64 bytes regardless
 * of IP/UA length, preventing length-extension attacks on the binding key.
 *
 * Partial binding mode (RECOMMENDED for production):
 *   Only the User-Agent is bound by default. IP is excluded because:
 *   - Mobile clients roam between cell/WiFi frequently
 *   - Corporate proxies rotate IPs across requests
 *   - IPv6 SLAAC changes the suffix periodically
 *   Set bindIP: true to include IP in the fingerprint when high assurance
 *   is required (e.g., admin tokens, PHI access tokens).
 *
 * SOC2 CC6.1 — Access control: prevent stolen token reuse.
 * ISO 27001 A.9.4.2 — Secure log-on procedures: contextual token binding.
 * HIPAA §164.312(d) — Person authentication: validate token origin.
 */

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Claim name embedded in the JWT for the fingerprint hash. */
export const FINGERPRINT_CLAIM = 'fpk';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenBinderConfig {
  /** Secret used for HMAC fingerprint computation. Min 32 bytes. */
  readonly bindingSecret: string;
  /** Include IP in fingerprint (higher assurance but breaks NAT/mobile). Default: false. */
  readonly bindIP?: boolean;
}

export interface FingerprintVerification {
  readonly valid: boolean;
  readonly reason?: string;
}

// ─── TokenBinder ─────────────────────────────────────────────────────────────

export class TokenBinder {
  private readonly bindingSecret: string;
  private readonly bindIP: boolean;

  constructor(config: TokenBinderConfig) {
    if (config.bindingSecret.length < 32) {
      throw new Error('[ORDR:SECURITY] TokenBinder: bindingSecret must be at least 32 characters');
    }
    this.bindingSecret = config.bindingSecret;
    this.bindIP = config.bindIP ?? false;
  }

  /**
   * Compute the fingerprint hash for the given client context.
   * Returns a hex string suitable for embedding as the `fpk` JWT claim.
   */
  computeFingerprint(ip: string, userAgent: string): string {
    const input = this.buildInput(ip, userAgent);
    const inputHash = createHash('sha256').update(input).digest('hex');
    return createHmac('sha256', this.bindingSecret).update(inputHash).digest('hex');
  }

  /**
   * Embed a fingerprint claim into a token payload object.
   * Returns a new payload object — does NOT mutate the original.
   */
  embedFingerprint<T extends Record<string, unknown>>(
    payload: T,
    ip: string,
    userAgent: string,
  ): T & { readonly fpk: string } {
    const fpk = this.computeFingerprint(ip, userAgent);
    return { ...payload, fpk };
  }

  /**
   * Verify that a token's fingerprint matches the current client context.
   *
   * Returns { valid: true } if:
   * - The token has no `fpk` claim (binding was not used at issuance)
   * - The `fpk` matches the recomputed fingerprint
   *
   * Returns { valid: false, reason } if:
   * - The `fpk` is present but does not match (possible token theft)
   */
  verifyFingerprint(
    tokenPayload: Record<string, unknown>,
    ip: string,
    userAgent: string,
  ): FingerprintVerification {
    const storedFpk = tokenPayload[FINGERPRINT_CLAIM];

    // No fingerprint in token → binding was not applied at issuance → allow
    if (storedFpk === undefined || storedFpk === null) {
      return { valid: true };
    }

    if (typeof storedFpk !== 'string') {
      return { valid: false, reason: 'Invalid fpk claim type' };
    }

    const expected = this.computeFingerprint(ip, userAgent);

    // Timing-safe comparison
    const storedBuf = Buffer.from(storedFpk, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');

    if (storedBuf.length !== expectedBuf.length || !timingSafeEqual(storedBuf, expectedBuf)) {
      return {
        valid: false,
        reason: 'Token fingerprint mismatch — possible token theft or IP/UA change',
      };
    }

    return { valid: true };
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private buildInput(ip: string, userAgent: string): string {
    if (this.bindIP) {
      return `${ip}:${userAgent}`;
    }
    // UA-only binding (recommended — see module docstring)
    return userAgent;
  }
}
