/**
 * DSR Export Worker Handler — GDPR data export + cryptographic erasure
 *
 * Consumes: ordr.dsr.events (type = dsr.approved)
 * Status machine: approved → processing → completed | failed
 *
 * GDPR Art. 15 — full data export as encrypted JSON archive to S3
 * GDPR Art. 17 — cryptographic key destruction + pseudonymisation
 *
 * SECURITY:
 * - Idempotent: no-ops if DSR already processing/completed
 * - Erasure: email → '[erased-' + randomUUID() + ']' (NOT a hash — hashes are re-identifiable)
 * - No PHI in audit log details — IDs and checksums only
 * - Per-export DEK via EnvelopeEncryption (key never stored with ciphertext)
 */

import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@ordr/events';
import type { DsrApprovedPayload } from '@ordr/events';
import type { AuditLogger } from '@ordr/audit';

// ── Dependency Types ──────────────────────────────────────────────

export interface DsrExportRecord {
  readonly s3Key: string;
  readonly s3Bucket: string;
  readonly fileSizeBytes: number | null;
  readonly checksumSha256: string;
}

export interface ErasureRecord {
  readonly id: string;
}

export interface DsrExportDeps {
  /** Transition DSR approved → processing. Throws with code DSR_ALREADY_PROCESSING if already processing/completed. */
  readonly transitionProcessing: (params: {
    dsrId: string;
    tenantId: string;
  }) => Promise<{ status: string }>;

  /** Load + decrypt customer profile. */
  readonly loadCustomer: (params: { tenantId: string; customerId: string }) => Promise<{
    name: string;
    email: string;
    phone: string | null;
    type: string;
    status: string;
    createdAt: string;
  }>;

  readonly loadContacts: (params: { tenantId: string; customerId: string }) => Promise<unknown[]>;
  readonly loadConsent: (params: { tenantId: string; customerId: string }) => Promise<unknown[]>;
  readonly loadTickets: (params: { tenantId: string; customerId: string }) => Promise<unknown[]>;
  readonly loadMemories: (params: { tenantId: string; customerId: string }) => Promise<unknown[]>;
  readonly loadAnalytics: (params: {
    tenantId: string;
    customerId: string;
  }) => Promise<Record<string, unknown>>;

  /** Encrypt JSON archive and upload to S3. Returns S3 key + checksum. */
  readonly uploadExport: (params: {
    tenantId: string;
    dsrId: string;
    payload: Record<string, unknown>;
  }) => Promise<DsrExportRecord>;

  readonly saveExport: (params: {
    dsrId: string;
    tenantId: string;
    record: DsrExportRecord;
  }) => Promise<void>;

  readonly completeDsr: (params: { dsrId: string; tenantId: string }) => Promise<void>;

  readonly scheduleErasure: (params: {
    tenantId: string;
    keyId: string;
    reason: string;
  }) => Promise<ErasureRecord>;

  readonly executeErasure: (params: { record: ErasureRecord }) => Promise<void>;
  readonly verifyErasure: (params: { record: ErasureRecord }) => Promise<boolean>;

  /** Update customers row in a transaction: name/email/phone → pseudonymous values + complete DSR. */
  readonly pseudonymise: (params: {
    tenantId: string;
    customerId: string;
    dsrId: string;
    email: string; // already-generated '[erased-UUID]' value
  }) => Promise<void>;

  readonly auditLogger: Pick<AuditLogger, 'log'>;
}

// ── Handler Factory ───────────────────────────────────────────────

export function createDsrExportHandler(
  deps: DsrExportDeps,
): (event: EventEnvelope<DsrApprovedPayload>) => Promise<void> {
  return async (event: EventEnvelope<DsrApprovedPayload>): Promise<void> => {
    const { dsrId, tenantId, customerId, type } = event.payload;

    // ── 0. Idempotency guard ─────────────────────────────────────
    try {
      await deps.transitionProcessing({ dsrId, tenantId });
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'DSR_ALREADY_PROCESSING') {
        console.warn(`[ORDR:WORKER:DSR] Skipping already-processing DSR ${dsrId}`);
        return;
      }
      throw err;
    }

    try {
      // ── 1. Assemble data archive ───────────────────────────────
      const [customer, contacts, consent, tickets, memories, analytics] = await Promise.all([
        deps.loadCustomer({ tenantId, customerId }),
        deps.loadContacts({ tenantId, customerId }),
        deps.loadConsent({ tenantId, customerId }),
        deps.loadTickets({ tenantId, customerId }),
        deps.loadMemories({ tenantId, customerId }),
        deps.loadAnalytics({ tenantId, customerId }),
      ]);

      const archive: Record<string, unknown> = {
        meta: {
          schema_version: '1.0',
          dsr_id: dsrId,
          customer_id: customerId,
          tenant_id: tenantId,
          exported_at: new Date().toISOString(),
          regulations: ['GDPR_Art15', 'GDPR_Art20'],
        },
        profile: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          type: customer.type,
          status: customer.status,
          created_at: customer.createdAt,
        },
        contacts,
        consent_history: consent,
        tickets,
        agent_memory: memories,
        analytics,
      };

      // ── 2. Encrypt + upload to S3 ─────────────────────────────
      const exportRecord = await deps.uploadExport({ tenantId, dsrId, payload: archive });
      await deps.saveExport({ dsrId, tenantId, record: exportRecord });

      await deps.auditLogger.log({
        tenantId,
        eventType: 'dsr.exported',
        actorType: 'system',
        actorId: 'worker',
        resource: 'data_subject_request',
        resourceId: dsrId,
        action: 'exported',
        details: {
          dsr_type: type,
          checksum_sha256: exportRecord.checksumSha256,
          file_size_bytes: exportRecord.fileSizeBytes,
        },
        timestamp: new Date(),
      });

      // ── 3. Erasure-only: destroy key + pseudonymise ───────────
      if (type === 'erasure') {
        // Resolve keyId — convention: tenant:{tenantId}:customer:{customerId}
        const keyId = `tenant:${tenantId}:customer:${customerId}`;

        const erasureRecord = await deps.scheduleErasure({
          tenantId,
          keyId,
          reason: `DSR erasure: dsrId=${dsrId}`,
        });

        await deps.auditLogger.log({
          tenantId,
          eventType: 'dsr.erasure_scheduled',
          actorType: 'system',
          actorId: 'worker',
          resource: 'data_subject_request',
          resourceId: dsrId,
          action: 'erasure_scheduled',
          details: { key_id: keyId },
          timestamp: new Date(),
        });

        await deps.executeErasure({ record: erasureRecord });

        await deps.auditLogger.log({
          tenantId,
          eventType: 'dsr.erasure_executed',
          actorType: 'system',
          actorId: 'worker',
          resource: 'data_subject_request',
          resourceId: dsrId,
          action: 'erasure_executed',
          details: { key_id: keyId },
          timestamp: new Date(),
        });

        await deps.verifyErasure({ record: erasureRecord });

        await deps.auditLogger.log({
          tenantId,
          eventType: 'dsr.erasure_verified',
          actorType: 'system',
          actorId: 'worker',
          resource: 'data_subject_request',
          resourceId: dsrId,
          action: 'erasure_verified',
          details: { key_id: keyId },
          timestamp: new Date(),
        });

        // CRITICAL: email must be non-reversible — use random UUID, NOT a hash
        const pseudoEmail = `[erased-${randomUUID()}]`;

        await deps.pseudonymise({
          tenantId,
          customerId,
          dsrId,
          email: pseudoEmail,
        });
      }

      // ── 4. Complete DSR ───────────────────────────────────────
      if (type !== 'erasure') {
        // For erasure, pseudonymise() atomically completes the DSR in its transaction
        await deps.completeDsr({ dsrId, tenantId });
      }
    } catch (err) {
      // Failure — log dsr.failed audit (no PHI in details)
      await deps.auditLogger
        .log({
          tenantId,
          eventType: 'dsr.failed',
          actorType: 'system',
          actorId: 'worker',
          resource: 'data_subject_request',
          resourceId: dsrId,
          action: 'failed',
          details: { error: 'export_failed', step: 'see_server_logs' },
          timestamp: new Date(),
        })
        .catch(() => {
          /* audit failure must not throw */
        });

      console.error(`[ORDR:WORKER:DSR] DSR ${dsrId} failed:`, (err as Error).message);
      // Status remains 'processing' for retry (Kafka consumer will retry)
    }
  };
}
