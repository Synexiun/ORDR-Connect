/**
 * Encryption Key Management API Service
 *
 * Typed wrappers over /api/v1/encryption-keys endpoints.
 * Covers: key inventory, rotation status, manual rotation trigger,
 * rotation history, and Vault health.
 *
 * SECURITY:
 * - Key material NEVER returned by any endpoint — only metadata — Rule 1
 * - Rotation trigger requires MFA-elevated session (Rule 2)
 * - Every rotation is WORM-logged with rotator identity — Rule 3
 * - Vault path is informational only — never used for key derivation client-side
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.24 | HIPAA §164.312(a)(2)(iv)
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export type KeyType = 'DEK' | 'KEK' | 'HMAC' | 'JWT' | 'API_HASH';

export type KeyStatus =
  | 'active'
  | 'rotation_due' // within 14 days of 90-day deadline
  | 'rotation_overdue' // past 90-day deadline — P2 incident
  | 'rotating' // rotation in progress
  | 'retired'; // previous version, retained for legacy decryption

export type RotationMethod = 'automatic' | 'manual' | 'emergency';

export interface RotationEvent {
  readonly version: number;
  readonly rotatedAt: string;
  /** Internal service account or user UUID — never email/name */
  readonly rotatedBy: string;
  readonly method: RotationMethod;
  readonly previousVersionRetained: boolean;
  readonly durationMs: number;
}

export interface EncryptionKey {
  readonly id: string;
  readonly alias: string;
  readonly type: KeyType;
  readonly purpose: string;
  readonly algorithm: string;
  readonly keyLengthBits: number;
  readonly vaultPath: string;
  readonly currentVersion: number;
  readonly lastRotatedAt: string;
  readonly nextRotationDue: string;
  readonly status: KeyStatus;
  readonly encryptedFields: readonly string[];
  readonly rotationHistory: readonly RotationEvent[];
}

export interface VaultHealth {
  readonly status: 'connected' | 'degraded' | 'sealed' | 'unreachable';
  readonly address: string;
  readonly version: string;
  readonly lastCheckAt: string;
  readonly leaseRenewalAt: string;
}

export interface KeyStats {
  readonly totalKeys: number;
  readonly rotationDue: number;
  readonly rotationOverdue: number;
  readonly lastRotationAt: string;
  readonly vault: VaultHealth;
}

// ── API Client ─────────────────────────────────────────────────────────────

export const encryptionApi = {
  async listKeys(): Promise<EncryptionKey[]> {
    return apiClient.get<EncryptionKey[]>('/encryption-keys');
  },

  async getStats(): Promise<KeyStats> {
    return apiClient.get<KeyStats>('/encryption-keys/stats');
  },

  async rotateKey(id: string): Promise<void> {
    return apiClient.post(`/encryption-keys/${id}/rotate`, {});
  },
};
