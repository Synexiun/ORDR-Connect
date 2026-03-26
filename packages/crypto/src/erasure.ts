/**
 * Cryptographic Erasure — GDPR Art. 17 / HIPAA Right to Delete
 *
 * SOC2 CC6.5 — Secure disposal of data and encryption keys.
 * ISO 27001 A.8.10 — Information deletion.
 * GDPR Art. 17 — Right to erasure via cryptographic key destruction.
 * HIPAA §164.310(d)(2)(i) — Disposal of ePHI.
 *
 * Cryptographic erasure works by destroying the encryption key, making
 * all data encrypted with that key permanently irrecoverable. This is
 * the NIST SP 800-88 recommended approach for cloud-hosted data.
 *
 * ALL operations are WORM audit-logged (Rule 3 compliance).
 */

import { randomUUID } from 'node:crypto';
import type { Result } from '@ordr/core';
import { ok, err, AppError } from '@ordr/core';

// ─── Types ────────────────────────────────────────────────────────

/** Status lifecycle of an erasure record. */
export type ErasureStatus = 'scheduled' | 'executed' | 'verified' | 'failed';

/** Immutable record of a cryptographic erasure request and its lifecycle. */
export interface ErasureRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly keyId: string;
  readonly reason: string;
  readonly scheduledAt: Date;
  readonly executedAt: Date | null;
  readonly verifiedAt: Date | null;
  readonly status: ErasureStatus;
}

/** Audit entry generated for every erasure operation. */
export interface ErasureAuditEntry {
  readonly erasureId: string;
  readonly tenantId: string;
  readonly keyId: string;
  readonly operation: 'schedule' | 'execute' | 'verify';
  readonly status: ErasureStatus;
  readonly timestamp: Date;
  readonly reason: string;
}

/**
 * Callback for WORM audit logging of erasure operations.
 * Consumers MUST implement this to persist audit entries immutably.
 */
export type ErasureAuditLogger = (entry: ErasureAuditEntry) => void;

/**
 * Callback for actual key destruction.
 * Must return true if the key was successfully destroyed, false otherwise.
 * In production, this should integrate with HSM/KMS (Vault, AWS KMS, etc.).
 */
export type KeyDestructor = (keyId: string) => boolean;

/**
 * Callback for verifying a key no longer exists.
 * Must return true if the key is confirmed absent, false if it still exists.
 */
export type KeyExistenceChecker = (keyId: string) => boolean;

// ─── Implementation ───────────────────────────────────────────────

/**
 * Manages the lifecycle of cryptographic erasure operations.
 *
 * Ensures that:
 * 1. Every erasure request is recorded and audit-logged
 * 2. Key destruction is performed through a pluggable destructor
 * 3. Post-destruction verification confirms irrecoverability
 * 4. All operations produce WORM audit entries
 */
export class CryptographicErasure {
  private readonly auditLog: ErasureAuditLogger;
  private readonly destroyKey: KeyDestructor;
  private readonly keyExists: KeyExistenceChecker;

  constructor(
    auditLog: ErasureAuditLogger,
    destroyKey: KeyDestructor,
    keyExists: KeyExistenceChecker,
  ) {
    this.auditLog = auditLog;
    this.destroyKey = destroyKey;
    this.keyExists = keyExists;
  }

  /**
   * Schedule a key for destruction.
   * Creates a record and logs the request before any destructive action.
   */
  scheduleErasure(
    tenantId: string,
    keyId: string,
    reason: string,
  ): Result<ErasureRecord, AppError> {
    if (tenantId === '' || keyId === '' || reason === '') {
      return err(
        new AppError(
          'tenantId, keyId, and reason are required for erasure scheduling',
          'VALIDATION_FAILED',
          400,
        ),
      );
    }

    const record: ErasureRecord = {
      id: randomUUID(),
      tenantId,
      keyId,
      reason,
      scheduledAt: new Date(),
      executedAt: null,
      verifiedAt: null,
      status: 'scheduled',
    };

    // WORM audit log — schedule event
    this.auditLog({
      erasureId: record.id,
      tenantId: record.tenantId,
      keyId: record.keyId,
      operation: 'schedule',
      status: 'scheduled',
      timestamp: record.scheduledAt,
      reason: record.reason,
    });

    return ok(record);
  }

  /**
   * Execute the erasure by destroying the encryption key.
   * After this operation, all data encrypted with the key is irrecoverable.
   */
  executeErasure(record: ErasureRecord): Result<ErasureRecord, AppError> {
    if (record.status !== 'scheduled') {
      return err(
        new AppError(
          `Cannot execute erasure in status "${record.status}" — must be "scheduled"`,
          'VALIDATION_FAILED',
          400,
        ),
      );
    }

    const destroyed = this.destroyKey(record.keyId);
    const now = new Date();

    if (!destroyed) {
      const failedRecord: ErasureRecord = {
        ...record,
        executedAt: now,
        status: 'failed',
      };

      // WORM audit log — failed execution
      this.auditLog({
        erasureId: record.id,
        tenantId: record.tenantId,
        keyId: record.keyId,
        operation: 'execute',
        status: 'failed',
        timestamp: now,
        reason: record.reason,
      });

      return err(
        new AppError(
          `Key destruction failed for key "${record.keyId}"`,
          'INTERNAL_ERROR',
          500,
        ),
      );
    }

    const executedRecord: ErasureRecord = {
      ...record,
      executedAt: now,
      status: 'executed',
    };

    // WORM audit log — successful execution
    this.auditLog({
      erasureId: record.id,
      tenantId: record.tenantId,
      keyId: record.keyId,
      operation: 'execute',
      status: 'executed',
      timestamp: now,
      reason: record.reason,
    });

    return ok(executedRecord);
  }

  /**
   * Verify that the key has been destroyed and data is irrecoverable.
   * Confirms the key no longer exists in the key store.
   */
  verifyErasure(record: ErasureRecord): Result<ErasureRecord, AppError> {
    if (record.status !== 'executed') {
      return err(
        new AppError(
          `Cannot verify erasure in status "${record.status}" — must be "executed"`,
          'VALIDATION_FAILED',
          400,
        ),
      );
    }

    const keyStillExists = this.keyExists(record.keyId);
    const now = new Date();

    if (keyStillExists) {
      const failedRecord: ErasureRecord = {
        ...record,
        verifiedAt: now,
        status: 'failed',
      };

      // WORM audit log — verification failed
      this.auditLog({
        erasureId: record.id,
        tenantId: record.tenantId,
        keyId: record.keyId,
        operation: 'verify',
        status: 'failed',
        timestamp: now,
        reason: record.reason,
      });

      return err(
        new AppError(
          `Key "${record.keyId}" still exists after destruction — erasure verification failed`,
          'INTERNAL_ERROR',
          500,
        ),
      );
    }

    const verifiedRecord: ErasureRecord = {
      ...record,
      verifiedAt: now,
      status: 'verified',
    };

    // WORM audit log — successful verification
    this.auditLog({
      erasureId: record.id,
      tenantId: record.tenantId,
      keyId: record.keyId,
      operation: 'verify',
      status: 'verified',
      timestamp: now,
      reason: record.reason,
    });

    return ok(verifiedRecord);
  }
}
