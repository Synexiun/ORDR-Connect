/**
 * Envelope Encryption — Two-tier AES-256-GCM key hierarchy
 *
 * Implements envelope encryption to limit blast radius on key compromise:
 *
 *   KEK (Key Encryption Key): Long-lived master key, stored in HSM/Vault.
 *   DEK (Data Encryption Key): Short-lived random key, generated per record.
 *
 *   Encryption:
 *     1. Generate a fresh random 256-bit DEK.
 *     2. Encrypt plaintext with DEK using AES-256-GCM.
 *     3. Encrypt DEK with KEK using AES-256-GCM.
 *     4. Store: { wrappedDek, dekIv, dekAuthTag, ciphertext, iv, authTag, keyVersion }.
 *
 *   Decryption (reverse):
 *     1. Decrypt wrappedDek with KEK → DEK.
 *     2. Decrypt ciphertext with DEK → plaintext.
 *
 * Key rotation:
 *   When the KEK rotates, re-encrypt all wrappedDeks with the new KEK.
 *   The plaintext data (ciphertext) does NOT need re-encryption.
 *   This makes rotation O(records) in re-wrap operations, not O(data).
 *
 * Tenant isolation:
 *   Each tenant should use a different KEK (derived via HKDF from a master
 *   key with the tenantId as the info parameter). This ensures a compromise
 *   of one tenant's data does not expose another tenant's DEKs.
 *
 * SOC2 CC6.7 — Encryption at rest: two-tier key hierarchy minimizes exposure.
 * ISO 27001 A.10.1.1 — Cryptographic controls: key management procedures.
 * HIPAA §164.312(a)(2)(iv) — PHI encryption with managed key lifecycle.
 * PCI DSS Req 3.5 — Protect keys used to secure cardholder data.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
// ─── Types ────────────────────────────────────────────────────────────────────

export interface EncryptedEnvelope {
  /** AES-256-GCM encrypted data encryption key (DEK), base64. */
  readonly wrappedDek: string;
  /** AES-256-GCM ciphertext of the plaintext, base64. */
  readonly ciphertext: string;
  /** 12-byte GCM IV for ciphertext, base64. */
  readonly iv: string;
  /** 16-byte GCM auth tag for ciphertext, base64. */
  readonly authTag: string;
  /** 12-byte GCM IV for wrapped DEK, base64. */
  readonly dekIv: string;
  /** 16-byte GCM auth tag for wrapped DEK, base64. */
  readonly dekAuthTag: string;
  /** Key version identifier for rotation tracking. */
  readonly keyVersion: string;
  readonly algorithm: 'AES-256-GCM-ENVELOPE';
}

const ALGORITHM = 'aes-256-gcm' as const;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits (GCM standard)

// ─── EnvelopeEncryption ───────────────────────────────────────────────────────

export class EnvelopeEncryption {
  private readonly kek: Buffer;
  private readonly keyVersion: string;

  /**
   * @param kek Key Encryption Key — exactly 32 bytes (256-bit AES key)
   * @param keyVersion Version identifier for key rotation tracking
   */
  constructor(kek: Buffer | string, keyVersion = 'v1') {
    const kekBuf = typeof kek === 'string' ? Buffer.from(kek, 'hex') : kek;
    if (kekBuf.length !== KEY_LENGTH) {
      throw new Error(
        `[ORDR:CRYPTO] EnvelopeEncryption: KEK must be exactly ${KEY_LENGTH.toString()} bytes, got ${kekBuf.length.toString()}`,
      );
    }
    this.kek = kekBuf;
    this.keyVersion = keyVersion;
  }

  /**
   * Encrypt plaintext using envelope encryption.
   *
   * Generates a fresh DEK per call. The DEK is used to encrypt the data
   * and is itself encrypted (wrapped) with the KEK.
   */
  encrypt(plaintext: string | Buffer): EncryptedEnvelope {
    const plaintextBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');

    // Generate fresh DEK and IVs
    const dek = randomBytes(KEY_LENGTH);
    const dataIv = randomBytes(IV_LENGTH);
    const dekIv = randomBytes(IV_LENGTH);

    // Encrypt data with DEK
    const dataCipher = createCipheriv(ALGORITHM, dek, dataIv);
    const ciphertextChunks = [dataCipher.update(plaintextBuf), dataCipher.final()];
    const ciphertext = Buffer.concat(ciphertextChunks);
    const dataAuthTag = dataCipher.getAuthTag();

    // Wrap DEK with KEK
    const dekCipher = createCipheriv(ALGORITHM, this.kek, dekIv);
    const wrappedDekChunks = [dekCipher.update(dek), dekCipher.final()];
    const wrappedDek = Buffer.concat(wrappedDekChunks);
    const dekAuthTag = dekCipher.getAuthTag();

    return {
      wrappedDek: wrappedDek.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      iv: dataIv.toString('base64'),
      authTag: dataAuthTag.toString('base64'),
      dekIv: dekIv.toString('base64'),
      dekAuthTag: dekAuthTag.toString('base64'),
      keyVersion: this.keyVersion,
      algorithm: 'AES-256-GCM-ENVELOPE',
    };
  }

  /**
   * Decrypt an envelope-encrypted record.
   * Throws if authentication tag verification fails (tampering detected).
   */
  decrypt(envelope: EncryptedEnvelope): Buffer {
    if ((envelope.algorithm as string) !== 'AES-256-GCM-ENVELOPE') {
      const algo = envelope.algorithm as string;
      throw new Error(`[ORDR:CRYPTO] EnvelopeEncryption: unknown algorithm ${algo}`);
    }

    // Unwrap DEK
    const wrappedDekBuf = Buffer.from(envelope.wrappedDek, 'base64');
    const dekIvBuf = Buffer.from(envelope.dekIv, 'base64');
    const dekAuthTagBuf = Buffer.from(envelope.dekAuthTag, 'base64');

    const dekDecipher = createDecipheriv(ALGORITHM, this.kek, dekIvBuf);
    dekDecipher.setAuthTag(dekAuthTagBuf);
    const dekChunks = [dekDecipher.update(wrappedDekBuf), dekDecipher.final()];
    const dek = Buffer.concat(dekChunks);

    // Decrypt data
    const ciphertextBuf = Buffer.from(envelope.ciphertext, 'base64');
    const dataIvBuf = Buffer.from(envelope.iv, 'base64');
    const dataAuthTagBuf = Buffer.from(envelope.authTag, 'base64');

    const dataDecipher = createDecipheriv(ALGORITHM, dek, dataIvBuf);
    dataDecipher.setAuthTag(dataAuthTagBuf);
    const plaintextChunks = [dataDecipher.update(ciphertextBuf), dataDecipher.final()];

    return Buffer.concat(plaintextChunks);
  }

  /** Decrypt and return as a UTF-8 string. */
  decryptString(envelope: EncryptedEnvelope): string {
    return this.decrypt(envelope).toString('utf8');
  }

  /**
   * Re-wrap a DEK with a new KEK. Used during key rotation.
   * The ciphertext (actual data) is NOT re-encrypted — only the wrapped DEK changes.
   * This is O(1) in data size regardless of how large the encrypted payload is.
   */
  rewrap(envelope: EncryptedEnvelope, newKek: Buffer, newKeyVersion: string): EncryptedEnvelope {
    // Unwrap DEK with old KEK
    const wrappedDekBuf = Buffer.from(envelope.wrappedDek, 'base64');
    const dekIvBuf = Buffer.from(envelope.dekIv, 'base64');
    const dekAuthTagBuf = Buffer.from(envelope.dekAuthTag, 'base64');

    const dekDecipher = createDecipheriv(ALGORITHM, this.kek, dekIvBuf);
    dekDecipher.setAuthTag(dekAuthTagBuf);
    const dek = Buffer.concat([dekDecipher.update(wrappedDekBuf), dekDecipher.final()]);

    // Re-wrap DEK with new KEK
    const newDekIv = randomBytes(IV_LENGTH);
    const reWrappedDekCipher = createCipheriv(ALGORITHM, newKek, newDekIv);
    const reWrapped = Buffer.concat([reWrappedDekCipher.update(dek), reWrappedDekCipher.final()]);
    const newDekAuthTag = reWrappedDekCipher.getAuthTag();

    return {
      ...envelope,
      wrappedDek: reWrapped.toString('base64'),
      dekIv: newDekIv.toString('base64'),
      dekAuthTag: newDekAuthTag.toString('base64'),
      keyVersion: newKeyVersion,
    };
  }
}
