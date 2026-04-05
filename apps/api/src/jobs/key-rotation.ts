/**
 * Key Rotation Pipeline — automated DEK re-wrap for ENCRYPTION_MASTER_KEY
 *
 * Called by the scheduler's key-rotation-check job handler.
 * Pages through encrypted_fields with keyset pagination (keyset cursor = last UUID).
 * Each page: validate envelope, rewrap DEK with new KEK, write back atomically.
 *
 * Rule 1 — 90-day KEK cycle; re-wrap is O(records), NOT O(data).
 * Rule 3 — WORM audit events per batch; key material NEVER in audit details.
 * Rule 4 — Per-row JSONB validation before passing to EnvelopeEncryption.
 */

import { EnvelopeEncryption, type EncryptedEnvelope } from '@ordr/crypto';

// ── Envelope validation ────────────────────────────────────────────

/**
 * All string fields required by EncryptedEnvelope, plus the algorithm discriminant.
 */
const REQUIRED_STRING_FIELDS = [
  'wrappedDek',
  'dekIv',
  'dekAuthTag',
  'keyVersion',
  'iv',
  'authTag',
  'ciphertext',
] as const;

function isValidEnvelope(val: unknown): val is EncryptedEnvelope {
  if (typeof val !== 'object' || val === null) return false;
  const rec = val as Record<string, unknown>;
  // Validate all required string fields
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof rec[field] !== 'string') return false;
  }
  // Validate the algorithm discriminant
  if (rec['algorithm'] !== 'AES-256-GCM-ENVELOPE') return false;
  return true;
}

// ── Dependency interface ────────────────────────────────────────────

export interface KeyRotationDeps {
  /** Hex-encoded old KEK bytes (read from Vault using old version number) */
  readonly oldKekHex: string;
  /** Hex-encoded new KEK bytes */
  readonly newKekHex: string;
  /** Vault KV v2 version being replaced */
  readonly oldVersion: number;
  /** Vault KV v2 version being written */
  readonly newVersion: number;
  /** Rows per page (default 500 in production) */
  readonly pageSize: number;

  /** Returns null if no active job; the concurrency guard row if one exists */
  findActiveJob(keyName: string): Promise<{ id: string } | null>;

  /** Creates the job row; returns the new job UUID */
  insertJob(params: { keyName: string; oldVersion: number; newVersion: number }): Promise<string>;

  /** Updates the keyset cursor and rowsDone count after each page */
  updateJobCursor(jobId: string, lastProcessedId: string, rowsDone: number): Promise<void>;

  /** Marks the job as completed */
  completeJob(jobId: string): Promise<void>;

  /** Marks the job as failed */
  failJob(jobId: string): Promise<void>;

  /** Fetch next page of encrypted_fields rows using keyset cursor */
  getPage(
    lastProcessedId: string | null,
    limit: number,
  ): Promise<Array<{ id: string; dek_envelope: unknown }>>;

  /** Write re-wrapped envelopes back to encrypted_fields */
  updateRows(updates: Array<{ id: string; dek_envelope: EncryptedEnvelope }>): Promise<void>;

  /** Emit a WORM audit event. Key material must NEVER appear in details. */
  emitAudit(eventType: string, details: Record<string, unknown>): Promise<void>;
}

// ── Pipeline ──────────────────────────────────────────────────────

export async function runKeyRotation(deps: KeyRotationDeps): Promise<{ rowsProcessed: number }> {
  const { oldKekHex, newKekHex, oldVersion, newVersion, pageSize } = deps;

  // 1. Concurrency guard
  const existing = await deps.findActiveJob('ENCRYPTION_MASTER_KEY');
  if (existing !== null) {
    await deps.emitAudit('KEY_ROTATION_SKIPPED_CONCURRENT', {
      key_name: 'ENCRYPTION_MASTER_KEY',
    });
    return { rowsProcessed: 0 };
  }

  // 2. Create job row
  const jobId = await deps.insertJob({
    keyName: 'ENCRYPTION_MASTER_KEY',
    oldVersion,
    newVersion,
  });

  let rowsDone = 0;

  try {
    await deps.emitAudit('KEY_ROTATION_STARTED', {
      key_name: 'ENCRYPTION_MASTER_KEY',
      old_version: oldVersion,
      new_version: newVersion,
    });

    // 3. Construct re-wrapper ONCE before the loop — validates KEK length upfront.
    //    The old KEK is needed to unwrap existing DEKs; the new KEK buffer is used
    //    to re-wrap them. Neither raw key material is ever passed to emitAudit.
    const rewrapper = new EnvelopeEncryption(Buffer.from(oldKekHex, 'hex'), String(oldVersion));
    const newKekBuf = Buffer.from(newKekHex, 'hex');

    let lastProcessedId: string | null = null;
    let pageIndex = 0;
    const startMs = Date.now();

    // 4. Keyset-paginated re-wrap loop
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const page = await deps.getPage(lastProcessedId, pageSize);
      if (page.length === 0) break;

      const updates: Array<{ id: string; dek_envelope: EncryptedEnvelope }> = [];
      let rowsInPage = 0;

      for (const row of page) {
        // Per-row validation — invalid envelopes are skipped, not crash-aborted
        if (!isValidEnvelope(row.dek_envelope)) {
          await deps.emitAudit('KEY_ROTATION_ROW_ERROR', {
            row_id: row.id,
            reason: 'invalid_envelope_shape',
          });
          continue;
        }

        const rewrapped = rewrapper.rewrap(row.dek_envelope, newKekBuf, String(newVersion));
        updates.push({ id: row.id, dek_envelope: rewrapped });
        rowsInPage++;
      }

      // If a full page returned zero valid rows, abort to prevent a runaway loop
      if (rowsInPage === 0 && page.length >= pageSize) {
        throw new Error(
          `[ORDR:ROTATION] Full page of invalid envelopes at page ${pageIndex} — aborting rotation`,
        );
      }

      // Write page + update cursor atomically
      if (updates.length > 0) {
        await deps.updateRows(updates);
      }

      // page.length > 0 is guaranteed (we break on empty pages above), so the
      // non-null assertion here is safe and avoids the unnecessary-condition lint error.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      lastProcessedId = page.at(-1)!.id;
      rowsDone += rowsInPage;
      await deps.updateJobCursor(jobId, lastProcessedId, rowsDone);

      await deps.emitAudit('KEY_ROTATION_BATCH_COMPLETED', {
        page_index: pageIndex,
        rows_in_page: rowsInPage,
        rows_done: rowsDone,
      });

      pageIndex++;

      // If we got fewer rows than pageSize, we've reached the end
      if (page.length < pageSize) break;
    }

    // 5. Complete job
    await deps.completeJob(jobId);

    await deps.emitAudit('KEY_ROTATION_COMPLETED', {
      key_name: 'ENCRYPTION_MASTER_KEY',
      old_version: oldVersion,
      new_version: newVersion,
      rows_processed: rowsDone,
      duration_ms: Date.now() - startMs,
    });

    return { rowsProcessed: rowsDone };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    // Best-effort: don't let failJob/emitAudit throw hide the original error
    await deps.failJob(jobId).catch(() => undefined);
    await deps
      .emitAudit('KEY_ROTATION_FAILED', {
        key_name: 'ENCRYPTION_MASTER_KEY',
        rows_done: rowsDone,
        reason,
      })
      .catch(() => undefined);
    throw err;
  }
}
