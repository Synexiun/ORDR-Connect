/**
 * @ordr/crypto — Cryptography package for ORDR-Connect
 *
 * SOC2 / ISO 27001 / HIPAA compliant cryptographic primitives.
 *
 * - AES-256-GCM encryption/decryption
 * - Argon2id password hashing (OWASP recommended)
 * - SHA-256 and HMAC-SHA256 hashing
 * - Field-level encryption for PHI/PII database columns
 * - Secure random generation (tokens, API keys, UUIDs)
 * - HKDF key derivation and RSA key pair generation
 */

// AES-256-GCM encryption
export { encrypt, decrypt, encryptString, decryptString } from './aes.js';
export type { EncryptResult } from './aes.js';

// Hashing utilities
export {
  sha256,
  sha256Buffer,
  hmacSha256,
  hmacSha256Buffer,
  hashApiKey,
  timingSafeEqual,
} from './hash.js';

// Password hashing (Argon2id)
export { hashPassword, verifyPassword, validatePasswordStrength } from './password.js';
export type { PasswordStrengthResult } from './password.js';

// Field-level encryption
export { FieldEncryptor } from './field-encryption.js';

// Secure random generation
export { randomBytes, randomHex, randomUUID, randomToken, generateApiKey } from './random.js';

// Key management
export { deriveKey, generateKeyPair, validateKeyLength } from './keys.js';

// Cryptographic erasure (GDPR Art. 17 / HIPAA disposal)
export { CryptographicErasure } from './erasure.js';
export type {
  ErasureStatus,
  ErasureRecord,
  ErasureAuditEntry,
  ErasureAuditLogger,
  KeyDestructor,
  KeyExistenceChecker,
} from './erasure.js';

// Envelope encryption (two-tier AES-256-GCM: DEK wrapped by KEK)
export { EnvelopeEncryption } from './envelope.js';
export type { EncryptedEnvelope } from './envelope.js';
