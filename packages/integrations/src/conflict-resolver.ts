/**
 * Conflict Resolver — three-way merge for bidirectional CRM sync.
 *
 * Pure functions only: no I/O, no DB, no HTTP.
 *
 * A "conflict" is defined as: BOTH the ORDR record AND the external record
 * changed since the last successful sync.  If only one side changed, it is
 * an unambiguous update — no conflict.  This three-way comparison requires
 * `lastSyncedAt` plus both `updatedAt` timestamps.
 *
 * Resolution strategies (ConflictResolution):
 *   source_wins — external CRM value always wins
 *   target_wins — ORDR value always wins
 *   most_recent — value from the more recently modified record wins
 *   manual      — field added to `manualFields`; caller queues a SyncConflict
 *                 record for human review and skips the field for this sync
 *
 * PHI note:
 *   Neither this module nor field-mapper.ts ever log or expose raw PHI values.
 *   All PHI tagging is done at the field-mapping layer (isPhi flag).
 *
 * SOC2 CC6.1 — conflict records are tenant-scoped (enforced by caller).
 * ISO 27001 A.8.3 — data handling: conflicts preserved until manually resolved.
 */

import type { ConflictResolution } from './types.js';

// ─── Public types ────────────────────────────────────────────────

/** A single field-level conflict between ORDR and an external CRM. */
export interface FieldConflict {
  readonly fieldName: string;
  readonly ordrValue: unknown;
  readonly externalValue: unknown;
  readonly ordrUpdatedAt: Date;
  readonly externalUpdatedAt: Date;
}

export interface ConflictDetectionResult {
  readonly hasConflicts: boolean;
  readonly conflicts: readonly FieldConflict[];
  /**
   * Merged record containing resolved (non-conflicting) fields.
   * Conflicting fields are absent — they must be resolved before use.
   */
  readonly partialRecord: Readonly<Record<string, unknown>>;
}

export interface ConflictResolutionResult {
  readonly resolvedRecord: Readonly<Record<string, unknown>>;
  /**
   * Field names that require manual human review.
   * These fields are NOT included in `resolvedRecord`.
   * Callers must create SyncConflict DB records for each and
   * re-sync these fields after manual resolution.
   */
  readonly manualFields: readonly string[];
}

// ─── Conflict detection ──────────────────────────────────────────

/**
 * Compare an ORDR record against an external record for a set of fields.
 *
 * Uses three-way merge logic:
 *   - Same value on both sides   → no conflict, include in partial record
 *   - Only ORDR changed          → no conflict, use ORDR value
 *   - Only external changed      → no conflict, use external value
 *   - Both changed, values differ → conflict, omit from partial record
 *
 * @param ordrRecord         Current ORDR record (mapped field names).
 * @param externalRecord     Incoming external record (mapped field names).
 * @param fieldNames         Fields to compare (intersection of both records).
 * @param ordrUpdatedAt      When the ORDR record was last modified.
 * @param externalUpdatedAt  When the external record was last modified.
 * @param lastSyncedAt       Timestamp of the last successful sync.
 */
export function detectConflicts(
  ordrRecord: Readonly<Record<string, unknown>>,
  externalRecord: Readonly<Record<string, unknown>>,
  fieldNames: readonly string[],
  ordrUpdatedAt: Date,
  externalUpdatedAt: Date,
  lastSyncedAt: Date,
): ConflictDetectionResult {
  const ordrChangedSinceSync = ordrUpdatedAt > lastSyncedAt;
  const externalChangedSinceSync = externalUpdatedAt > lastSyncedAt;

  const conflicts: FieldConflict[] = [];
  const partialRecord: Record<string, unknown> = {};

  for (const field of fieldNames) {
    const ordrValue = ordrRecord[field];
    const externalValue = externalRecord[field];

    // Identical values — no action needed
    if (deepEqual(ordrValue, externalValue)) {
      partialRecord[field] = ordrValue;
      continue;
    }

    // Only ORDR changed — use ORDR value (authoritative)
    if (ordrChangedSinceSync && !externalChangedSinceSync) {
      partialRecord[field] = ordrValue;
      continue;
    }

    // Only external changed — use external value
    if (!ordrChangedSinceSync && externalChangedSinceSync) {
      partialRecord[field] = externalValue;
      continue;
    }

    // Neither changed but values differ (stale divergence) — treat as external wins
    if (!ordrChangedSinceSync && !externalChangedSinceSync) {
      partialRecord[field] = externalValue;
      continue;
    }

    // Both changed with different values — genuine conflict
    conflicts.push({
      fieldName: field,
      ordrValue,
      externalValue,
      ordrUpdatedAt,
      externalUpdatedAt,
    });
    // Conflicting field is intentionally absent from partialRecord
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
    partialRecord,
  };
}

// ─── Conflict resolution ─────────────────────────────────────────

/**
 * Resolve detected conflicts by applying the configured strategy.
 *
 * @param baseRecord   The partial record from detectConflicts (non-conflicting fields).
 * @param conflicts    List of field conflicts to resolve.
 * @param resolution   The configured resolution strategy for this integration.
 */
export function resolveConflicts(
  baseRecord: Readonly<Record<string, unknown>>,
  conflicts: readonly FieldConflict[],
  resolution: ConflictResolution,
): ConflictResolutionResult {
  const resolvedRecord: Record<string, unknown> = { ...baseRecord };
  const manualFields: string[] = [];

  for (const conflict of conflicts) {
    switch (resolution) {
      case 'source_wins':
        // External (source) CRM value wins unconditionally
        resolvedRecord[conflict.fieldName] = conflict.externalValue;
        break;

      case 'target_wins':
        // ORDR (target) value wins unconditionally
        resolvedRecord[conflict.fieldName] = conflict.ordrValue;
        break;

      case 'most_recent':
        // Value from the more recently updated record wins
        resolvedRecord[conflict.fieldName] =
          conflict.externalUpdatedAt >= conflict.ordrUpdatedAt
            ? conflict.externalValue
            : conflict.ordrValue;
        break;

      case 'manual':
        // Do not include in resolved record — flag for human review
        manualFields.push(conflict.fieldName);
        break;
    }
  }

  return { resolvedRecord, manualFields };
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Shallow equality check for conflict comparison.
 * Handles primitives, null, and single-level array/object comparison.
 * For deeply nested structures, considers them unequal unless === holds.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  // Date comparison
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  // Primitive types already handled by ===
  if (typeof a !== 'object') return false;

  // Array comparison (shallow)
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => item === b[i]);
  }

  // Object comparison (shallow key/value)
  if (!Array.isArray(a) && !Array.isArray(b)) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => aObj[k] === bObj[k]);
  }

  return false;
}
