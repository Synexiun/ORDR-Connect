/**
 * LimbIdentity — Ed25519 identity management for Synexiun limbs.
 *
 * Each limb holds an Ed25519 keypair. Every request to Core is signed
 * with the limb's private key. Core verifies using the registered public key.
 *
 * Wire format (from synex_core/middleware/identity.py):
 *   message = `${limbId}:${timestamp}` (UTF-8 encoded)
 *   signature = Ed25519(message, privateKey) → 64 bytes → hex string
 *
 * HTTP headers added to every authenticated request:
 *   X-Synex-Limb-Id:   limb_id string
 *   X-Synex-Timestamp: ISO 8601 UTC timestamp
 *   X-Synex-Signature: hex-encoded 64-byte Ed25519 signature
 *
 * RULE 2 (Auth): mTLS equivalent — every inter-service request authenticated.
 * RULE 5 (Secrets): Private key loaded from env var, never committed.
 */

import * as ed from '@noble/ed25519';
import { MAX_CLOCK_SKEW_MS } from './constants.js';

export interface SignedHeaders {
  'X-Synex-Limb-Id': string;
  'X-Synex-Timestamp': string;
  'X-Synex-Signature': string;
}

export class LimbIdentity {
  private readonly _privateKey: Uint8Array;
  private readonly _publicKey: Uint8Array;
  private readonly _publicKeyHex: string;

  private constructor(
    private readonly _limbId: string,
    privateKey: Uint8Array,
    publicKey: Uint8Array,
  ) {
    this._privateKey = privateKey;
    this._publicKey = publicKey;
    this._publicKeyHex = Buffer.from(publicKey).toString('hex');
  }

  /**
   * Generate a new Ed25519 keypair for this limb.
   * The private key hex should be stored in SYNEX_LIMB_PRIVATE_KEY env var.
   */
  static async generate(
    limbId: string,
  ): Promise<{ identity: LimbIdentity; privateKeyHex: string }> {
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    const identity = new LimbIdentity(limbId, privateKey, publicKey);
    return { identity, privateKeyHex: Buffer.from(privateKey).toString('hex') };
  }

  /**
   * Load identity from a hex-encoded private key.
   * Expected source: SYNEX_LIMB_PRIVATE_KEY environment variable.
   *
   * @throws Error if the hex string is not a valid 32-byte Ed25519 private key
   */
  static async fromHex(limbId: string, privateKeyHex: string): Promise<LimbIdentity> {
    const privateKey = Buffer.from(privateKeyHex, 'hex');
    if (privateKey.length !== 32) {
      throw new Error(
        `Invalid Ed25519 private key: expected 32 bytes, got ${privateKey.length.toString()}`,
      );
    }
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    return new LimbIdentity(limbId, privateKey, publicKey);
  }

  get limbId(): string {
    return this._limbId;
  }

  /** Hex-encoded Ed25519 public key — send to Core during registration. */
  get publicKeyHex(): string {
    return this._publicKeyHex;
  }

  /**
   * Sign a request and return the three identity headers.
   *
   * Message signed: `${limbId}:${timestamp}` (matches Core verification).
   */
  async signRequest(): Promise<SignedHeaders> {
    const timestamp = new Date().toISOString();
    const message = new TextEncoder().encode(`${this._limbId}:${timestamp}`);
    const signature = await ed.signAsync(message, this._privateKey);
    return {
      'X-Synex-Limb-Id': this._limbId,
      'X-Synex-Timestamp': timestamp,
      'X-Synex-Signature': Buffer.from(signature).toString('hex'),
    };
  }

  /**
   * Verify a signature received from Core (for downward messages).
   * Used to authenticate CorePolicy and kill-switch commands.
   *
   * @param corePublicKeyHex - Core's public key in hex (bootstrapped at startup)
   * @param message - The raw message bytes
   * @param signatureHex - The hex-encoded 64-byte Ed25519 signature
   */
  static async verifyCoreSignature(
    corePublicKeyHex: string,
    message: Uint8Array,
    signatureHex: string,
  ): Promise<boolean> {
    const publicKey = Buffer.from(corePublicKeyHex, 'hex');
    const signature = Buffer.from(signatureHex, 'hex');
    if (publicKey.length !== 32 || signature.length !== 64) return false;
    return ed.verifyAsync(signature, message, publicKey);
  }

  /**
   * Verify a timestamp from a received message is within clock-skew tolerance.
   * Prevents replay attacks on downward messages.
   */
  static isTimestampFresh(timestampIso: string): boolean {
    const ts = new Date(timestampIso).getTime();
    const now = Date.now();
    return Math.abs(now - ts) <= MAX_CLOCK_SKEW_MS;
  }
}
