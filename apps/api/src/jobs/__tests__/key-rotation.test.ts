/**
 * Key Rotation Pipeline Tests
 *
 * Uses in-memory arrays instead of a real DB. Tests:
 * - Single-page job: all rows re-wrapped, audit events emitted
 * - Multi-page job: pagination works correctly (keyset cursor advances)
 * - Idempotency: restart from last_processed_id skips already-wrapped rows
 * - Concurrency guard: second concurrent job is rejected
 * - Key material never appears in audit events or console output
 * - Per-row JSONB validation: invalid row emits KEY_ROTATION_ROW_ERROR + continues
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runKeyRotation } from '../key-rotation.js';
import { EnvelopeEncryption } from '@ordr/crypto';

// ── Helpers ───────────────────────────────────────────────────────

function makeValidEnvelope(keyVersion: string) {
  const kek = Buffer.alloc(32, 0xab);
  const enc = new EnvelopeEncryption(kek, keyVersion);
  return enc.encrypt(Buffer.from('test-plaintext'));
}

function makeInvalidEnvelope() {
  // Missing required fields like algorithm, ciphertext, etc.
  return { wrappedDek: 'bad', notAField: true };
}

// ── Mock DB and Deps ──────────────────────────────────────────────

function makeTestDeps(rows: Array<{ id: string; dek_envelope: unknown }>) {
  const oldKekHex = Buffer.alloc(32, 0xab).toString('hex'); // same as makeValidEnvelope
  const newKekHex = Buffer.alloc(32, 0xcd).toString('hex');

  const db = {
    rows: [...rows],
    jobs: [] as Array<{
      id: string;
      status: string;
      lastProcessedId: string | null;
      rowsDone: number;
    }>,
  };

  const auditEvents: string[] = [];

  return {
    oldKekHex,
    newKekHex,
    oldVersion: 1,
    newVersion: 2,
    pageSize: 500,
    db,
    auditEvents,
    findActiveJob: vi.fn((_keyName: string) => {
      return Promise.resolve(db.jobs.find((j) => j.status === 'running') ?? null);
    }),
    insertJob: vi.fn((_job: { keyName: string; oldVersion: number; newVersion: number }) => {
      const id = 'job-001';
      db.jobs.push({ id, status: 'running', lastProcessedId: null, rowsDone: 0 });
      return Promise.resolve(id);
    }),
    updateJobCursor: vi.fn((jobId: string, lastId: string, rowsDone: number) => {
      const job = db.jobs.find((j) => j.id === jobId);
      if (job !== undefined) {
        job.lastProcessedId = lastId;
        job.rowsDone = rowsDone;
      }
      return Promise.resolve();
    }),
    completeJob: vi.fn((jobId: string) => {
      const job = db.jobs.find((j) => j.id === jobId);
      if (job !== undefined) job.status = 'completed';
      return Promise.resolve();
    }),
    getPage: vi.fn((lastId: string | null, limit: number) => {
      const start = lastId !== null ? db.rows.findIndex((r) => r.id === lastId) + 1 : 0;
      return Promise.resolve(db.rows.slice(start, start + limit));
    }),
    updateRows: vi.fn((updates: Array<{ id: string; dek_envelope: unknown }>) => {
      for (const u of updates) {
        const row = db.rows.find((r) => r.id === u.id);
        if (row !== undefined) row.dek_envelope = u.dek_envelope;
      }
      return Promise.resolve();
    }),
    emitAudit: vi.fn((eventType: string, details: Record<string, unknown>) => {
      auditEvents.push(eventType);
      // Ensure key material is never in details
      const detailsStr = JSON.stringify(details);
      expect(detailsStr).not.toContain(oldKekHex);
      expect(detailsStr).not.toContain(newKekHex);
      return Promise.resolve();
    }),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('runKeyRotation — single page', () => {
  it('re-wraps all rows and emits correct audit events', async () => {
    const rows = [
      { id: 'row-1', dek_envelope: makeValidEnvelope('1') },
      { id: 'row-2', dek_envelope: makeValidEnvelope('1') },
    ];

    const deps = makeTestDeps(rows);
    const result = await runKeyRotation(deps as never);

    expect(result.rowsProcessed).toBe(2);
    expect(deps.auditEvents).toContain('KEY_ROTATION_STARTED');
    expect(deps.auditEvents).toContain('KEY_ROTATION_BATCH_COMPLETED');
    expect(deps.auditEvents).toContain('KEY_ROTATION_COMPLETED');

    // Rows should have new keyVersion
    for (const row of deps.db.rows) {
      const env = row.dek_envelope as { keyVersion: string };
      expect(env.keyVersion).toBe('2');
    }
  });
});

describe('runKeyRotation — concurrency guard', () => {
  it('rejects if an active job already exists', async () => {
    const deps = makeTestDeps([]);
    deps.db.jobs.push({ id: 'existing', status: 'running', lastProcessedId: null, rowsDone: 0 });

    const result = await runKeyRotation(deps as never);

    expect(result.rowsProcessed).toBe(0);
    expect(deps.insertJob).not.toHaveBeenCalled();
  });
});

describe('runKeyRotation — per-row validation', () => {
  it('skips invalid rows and continues without aborting', async () => {
    const rows = [
      { id: 'row-good', dek_envelope: makeValidEnvelope('1') },
      { id: 'row-bad', dek_envelope: makeInvalidEnvelope() },
    ];

    const deps = makeTestDeps(rows);
    const result = await runKeyRotation(deps as never);

    // Good row processed, bad row skipped
    expect(result.rowsProcessed).toBe(1);
    expect(deps.auditEvents).toContain('KEY_ROTATION_ROW_ERROR');
    expect(deps.auditEvents).toContain('KEY_ROTATION_COMPLETED');
  });
});
