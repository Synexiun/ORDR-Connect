/**
 * Sync Engine — orchestrates bidirectional CRM sync.
 *
 * Ties together field-mapper and conflict-resolver into a single
 * coordinator that the integration route can call directly.
 *
 * Design principles:
 *   - No I/O. The engine produces records and metadata; callers handle DB writes.
 *   - PHI-safe. PHI fields are flagged on inbound so callers encrypt before insert.
 *   - Idempotent. Running the same batch twice produces the same result.
 *   - Auditable. All conflict decisions are returned as structured data for logging.
 *
 * Flow — inbound (CRM → ORDR):
 *   1. applyFieldMappings (inbound) on each external record
 *   2. Compare mapped record against existing ORDR record (if any)
 *   3. detectConflicts (three-way merge)
 *   4. resolveConflicts using configured strategy
 *   5. Return InboundRecordResult[] for the route to upsert
 *
 * Flow — outbound (ORDR → CRM):
 *   1. applyFieldMappings (outbound) on each ORDR record
 *   2. Return OutboundRecordResult[] for the route to push to the CRM adapter
 *
 * SOC2 CC6.1 — all operations are tenant-context-bound (enforced by caller).
 * HIPAA §164.312(a)(2)(iv) — PHI fields tagged; caller encrypts before DB insert.
 * ISO 27001 A.8.2.3 — sync results fully auditable via returned metadata.
 */

import type { FieldMapping, ConflictResolution } from './types.js';
import { applyFieldMappings } from './field-mapper.js';
import { detectConflicts, resolveConflicts } from './conflict-resolver.js';
import type { FieldConflict } from './conflict-resolver.js';

// ─── Inbound sync types ──────────────────────────────────────────

export interface ExternalRecord {
  /** External CRM identifier (Salesforce Id / HubSpot contactId / etc.) */
  readonly externalId: string;
  /** Raw record as returned by the CRM adapter. */
  readonly rawRecord: Readonly<Record<string, unknown>>;
  /** When the external record was last modified in the CRM. */
  readonly externalUpdatedAt: Date;
}

export interface ExistingOrdrRecord {
  /** The ORDR entity ID corresponding to this external record. */
  readonly ordrEntityId: string;
  /** Current ORDR record fields (mapped field names). */
  readonly record: Readonly<Record<string, unknown>>;
  /** When the ORDR record was last modified. */
  readonly updatedAt: Date;
  /** Timestamp of the last successful sync between ORDR and this external record. */
  readonly lastSyncedAt: Date;
}

export type InboundAction = 'create' | 'update' | 'skip' | 'conflict';

export interface InboundRecordResult {
  readonly externalId: string;
  readonly action: InboundAction;
  /**
   * Merged record ready for DB upsert.
   * Present for 'create' and 'update' actions.
   * For 'conflict', contains the partially-resolved record (manual fields excluded).
   */
  readonly record: Readonly<Record<string, unknown>> | null;
  /**
   * PHI field names in `record` that MUST be encrypted before DB insert.
   * Always a subset of the mapped fields where FieldMapping.isPhi === true.
   */
  readonly phiFields: readonly string[];
  /**
   * Fields requiring manual conflict resolution.
   * Non-empty only when action === 'conflict' and conflictResolution === 'manual'.
   */
  readonly manualFields: readonly string[];
  /** Structured conflict data for audit logging and SyncConflict DB records. */
  readonly conflicts: readonly FieldConflict[];
  readonly ordrEntityId: string | null;
}

export interface InboundSyncResult {
  readonly records: readonly InboundRecordResult[];
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly conflictsDetected: number;
  readonly conflictsResolved: number;
  readonly conflictsQueued: number;
}

// ─── Outbound sync types ─────────────────────────────────────────

export interface OrdrRecord {
  readonly ordrEntityId: string;
  readonly record: Readonly<Record<string, unknown>>;
  readonly externalId?: string | undefined;
}

export interface OutboundRecordResult {
  readonly ordrEntityId: string;
  readonly externalId: string | undefined;
  readonly action: 'create' | 'update';
  /** Outbound record formatted for the CRM API. */
  readonly crmRecord: Readonly<Record<string, unknown>>;
}

export interface OutboundSyncResult {
  readonly records: readonly OutboundRecordResult[];
  readonly toCreate: number;
  readonly toUpdate: number;
}

// ─── Sync Engine ────────────────────────────────────────────────

export class SyncEngine {
  /**
   * Process a batch of inbound records from an external CRM.
   *
   * @param externalRecords   Records fetched from the CRM adapter.
   * @param existingByExtId   Map of existing ORDR records keyed by external ID.
   * @param fieldMappings     Field mapping configuration for this integration.
   * @param conflictResolution Resolution strategy configured for this integration.
   */
  processInbound(
    externalRecords: readonly ExternalRecord[],
    existingByExtId: ReadonlyMap<string, ExistingOrdrRecord>,
    fieldMappings: readonly FieldMapping[],
    conflictResolution: ConflictResolution,
  ): InboundSyncResult {
    const records: InboundRecordResult[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let conflictsDetected = 0;
    let conflictsResolved = 0;
    let conflictsQueued = 0;

    for (const external of externalRecords) {
      const { record: mappedExternal, phiFields } = applyFieldMappings(
        external.rawRecord,
        fieldMappings,
        'inbound',
      );

      const existing = existingByExtId.get(external.externalId);

      // New record — no conflict possible
      if (existing === undefined) {
        records.push({
          externalId: external.externalId,
          action: 'create',
          record: mappedExternal,
          phiFields,
          manualFields: [],
          conflicts: [],
          ordrEntityId: null,
        });
        created++;
        continue;
      }

      // Determine which fields to compare (intersection)
      const fieldNames = Object.keys(mappedExternal).filter(
        (k) => k in existing.record || k in mappedExternal,
      );

      const detection = detectConflicts(
        existing.record,
        mappedExternal,
        fieldNames,
        existing.updatedAt,
        external.externalUpdatedAt,
        existing.lastSyncedAt,
      );

      if (!detection.hasConflicts) {
        // No conflicts — only update if something actually changed
        const hasChanges = fieldNames.some((f) => existing.record[f] !== mappedExternal[f]);

        if (!hasChanges) {
          records.push({
            externalId: external.externalId,
            action: 'skip',
            record: null,
            phiFields: [],
            manualFields: [],
            conflicts: [],
            ordrEntityId: existing.ordrEntityId,
          });
          skipped++;
          continue;
        }

        records.push({
          externalId: external.externalId,
          action: 'update',
          record: detection.partialRecord,
          phiFields,
          manualFields: [],
          conflicts: [],
          ordrEntityId: existing.ordrEntityId,
        });
        updated++;
        continue;
      }

      // Conflicts exist — apply resolution strategy
      conflictsDetected += detection.conflicts.length;
      const resolution = resolveConflicts(
        detection.partialRecord,
        detection.conflicts,
        conflictResolution,
      );

      if (resolution.manualFields.length > 0) {
        conflictsQueued += resolution.manualFields.length;
      }
      conflictsResolved += detection.conflicts.length - resolution.manualFields.length;

      records.push({
        externalId: external.externalId,
        action: 'conflict',
        record: resolution.resolvedRecord,
        phiFields,
        manualFields: resolution.manualFields,
        conflicts: detection.conflicts,
        ordrEntityId: existing.ordrEntityId,
      });
      updated++;
    }

    return {
      records,
      created,
      updated,
      skipped,
      conflictsDetected,
      conflictsResolved,
      conflictsQueued,
    };
  }

  /**
   * Prepare a batch of ORDR records for outbound push to an external CRM.
   *
   * @param ordrRecords    ORDR records to push.
   * @param fieldMappings  Field mapping configuration.
   */
  processOutbound(
    ordrRecords: readonly OrdrRecord[],
    fieldMappings: readonly FieldMapping[],
  ): OutboundSyncResult {
    const records: OutboundRecordResult[] = [];
    let toCreate = 0;
    let toUpdate = 0;

    for (const ordr of ordrRecords) {
      const { record: crmRecord } = applyFieldMappings(ordr.record, fieldMappings, 'outbound');

      const action = ordr.externalId !== undefined ? 'update' : 'create';
      records.push({
        ordrEntityId: ordr.ordrEntityId,
        externalId: ordr.externalId,
        action,
        crmRecord,
      });

      if (action === 'create') toCreate++;
      else toUpdate++;
    }

    return { records, toCreate, toUpdate };
  }
}
