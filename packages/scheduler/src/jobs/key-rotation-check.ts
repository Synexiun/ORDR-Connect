/**
 * Key Rotation Check — daily cron to trigger DEK re-wrap when KEK approaches expiry
 *
 * Checks whether ENCRYPTION_MASTER_KEY has been in Vault for ≥ 80 days.
 * If so, delegates to the worker's re-wrap pipeline (via deps.runKeyRotation).
 * A guard check prevents duplicate concurrent jobs.
 *
 * Schedule: 0 2 * * * (daily at 02:00 UTC)
 * SOC2 CC6.7 — Cryptographic key lifecycle management.
 * Rule 1 — Automated 90-day key rotation; triggered at 80-day threshold.
 * Rule 3 — WORM audit events emitted by the pipeline for each batch.
 */

import type { JobDefinition, JobHandler, JobResult } from '../types.js';
import { createCronExpression } from '../cron-parser.js';

// ── Job Constants ─────────────────────────────────────────────────

export const KEY_ROTATION_CHECK_JOB_ID = 'key-rotation-check';
export const KEY_ROTATION_CHECK_CRON = '0 2 * * *';

// ── Job Definition ────────────────────────────────────────────────

export function createKeyRotationCheckDefinition(): Omit<JobDefinition, 'createdAt' | 'updatedAt'> {
  return {
    id: KEY_ROTATION_CHECK_JOB_ID,
    name: 'Key Rotation Check',
    description: 'Daily check: trigger DEK re-wrap if ENCRYPTION_MASTER_KEY age >= 80 days.',
    cronExpression: createCronExpression(
      process.env['KEY_ROTATION_CHECK_CRON'] ?? KEY_ROTATION_CHECK_CRON,
    ),
    jobType: 'key-rotation-check',
    payloadTemplate: {},
    isActive: true,
    priority: 'high',
    retryPolicy: {
      maxRetries: 3,
      baseDelayMs: 30_000,
      maxDelayMs: 600_000, // 10 min max
    },
  };
}

// ── Dependency Types ──────────────────────────────────────────────

export interface KeyRotationCheckDeps {
  /**
   * Returns true if ENCRYPTION_MASTER_KEY age >= thresholdDays.
   * Provided by the worker using KeyRotationTracker.
   */
  readonly isKeyApproachingExpiry: (thresholdDays: number) => Promise<boolean>;

  /**
   * Executes the full DEK re-wrap pipeline (from apps/api/src/jobs/key-rotation.ts).
   * Wired as a closure in server.ts that fetches old/new KEK from Vault and
   * passes fully-constructed KeyRotationDeps to runKeyRotation().
   */
  readonly runKeyRotation: () => Promise<{ rowsProcessed: number }>;

  readonly auditLogger: {
    log: (event: {
      tenantId: string;
      eventType: string;
      actorType: string;
      actorId: string;
      resource: string;
      resourceId: string;
      action: string;
      details: Record<string, unknown>;
      timestamp: Date;
    }) => Promise<void>;
  };
}

// ── Handler Factory ───────────────────────────────────────────────

export function createKeyRotationCheckHandler(deps: KeyRotationCheckDeps): JobHandler {
  return async (): Promise<JobResult> => {
    const startMs = Date.now();

    const approaching = await deps.isKeyApproachingExpiry(80);
    if (!approaching) {
      return {
        success: true,
        data: { skipped: true, reason: 'Key age below 80-day threshold' },
        durationMs: Date.now() - startMs,
      };
    }

    let result: { rowsProcessed: number };
    try {
      result = await deps.runKeyRotation();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'unknown error';
      await deps.auditLogger.log({
        tenantId: 'system',
        eventType: 'security.key_rotation',
        actorType: 'system',
        actorId: 'scheduler:key-rotation-check',
        resource: 'encryption_key',
        resourceId: 'ENCRYPTION_MASTER_KEY',
        action: 'rotation_check_failed',
        details: { error: errorMessage },
        timestamp: new Date(),
      });
      return {
        success: false,
        error: errorMessage,
        data: {},
        durationMs: Date.now() - startMs,
      };
    }

    await deps.auditLogger.log({
      tenantId: 'system',
      eventType: 'security.key_rotation',
      actorType: 'system',
      actorId: 'scheduler:key-rotation-check',
      resource: 'encryption_key',
      resourceId: 'ENCRYPTION_MASTER_KEY',
      action: 'rotation_check_complete',
      details: { rows_processed: result.rowsProcessed },
      timestamp: new Date(),
    });

    return {
      success: true,
      data: { rowsProcessed: result.rowsProcessed },
      durationMs: Date.now() - startMs,
    };
  };
}
