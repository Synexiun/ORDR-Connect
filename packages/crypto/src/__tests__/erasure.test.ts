import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CryptographicErasure } from '../erasure.js';
import type { ErasureAuditEntry, ErasureRecord } from '../erasure.js';
import { isOk, isErr } from '@ordr/core';

describe('CryptographicErasure', () => {
  let auditLog: ErasureAuditEntry[];
  let auditLogger: (entry: ErasureAuditEntry) => void;
  let destroyedKeys: Set<string>;
  let keyDestructor: (keyId: string) => boolean;
  let keyExistenceChecker: (keyId: string) => boolean;
  let erasure: CryptographicErasure;

  beforeEach(() => {
    auditLog = [];
    auditLogger = (entry) => auditLog.push(entry);
    destroyedKeys = new Set();
    keyDestructor = (keyId) => {
      destroyedKeys.add(keyId);
      return true;
    };
    keyExistenceChecker = (keyId) => !destroyedKeys.has(keyId);
    erasure = new CryptographicErasure(auditLogger, keyDestructor, keyExistenceChecker);
  });

  // ── Schedule Erasure ────────────────────────────────────────────

  describe('scheduleErasure', () => {
    it('creates a scheduled erasure record', () => {
      const result = erasure.scheduleErasure('tenant-1', 'key-abc', 'GDPR deletion request');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.tenantId).toBe('tenant-1');
        expect(result.data.keyId).toBe('key-abc');
        expect(result.data.reason).toBe('GDPR deletion request');
        expect(result.data.status).toBe('scheduled');
        expect(result.data.executedAt).toBeNull();
        expect(result.data.verifiedAt).toBeNull();
      }
    });

    it('generates a unique ID for each record', () => {
      const r1 = erasure.scheduleErasure('t1', 'k1', 'reason 1');
      const r2 = erasure.scheduleErasure('t1', 'k2', 'reason 2');
      if (isOk(r1) && isOk(r2)) {
        expect(r1.data.id).not.toBe(r2.data.id);
      }
    });

    it('logs a schedule audit entry', () => {
      erasure.scheduleErasure('tenant-1', 'key-abc', 'GDPR request');
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]?.operation).toBe('schedule');
      expect(auditLog[0]?.status).toBe('scheduled');
      expect(auditLog[0]?.tenantId).toBe('tenant-1');
      expect(auditLog[0]?.keyId).toBe('key-abc');
    });

    it('records the scheduledAt timestamp', () => {
      const before = new Date();
      const result = erasure.scheduleErasure('t1', 'k1', 'reason');
      const after = new Date();
      if (isOk(result)) {
        expect(result.data.scheduledAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(result.data.scheduledAt.getTime()).toBeLessThanOrEqual(after.getTime());
      }
    });

    it('fails with empty tenantId', () => {
      const result = erasure.scheduleErasure('', 'key-abc', 'reason');
      expect(isErr(result)).toBe(true);
    });

    it('fails with empty keyId', () => {
      const result = erasure.scheduleErasure('tenant-1', '', 'reason');
      expect(isErr(result)).toBe(true);
    });

    it('fails with empty reason', () => {
      const result = erasure.scheduleErasure('tenant-1', 'key-abc', '');
      expect(isErr(result)).toBe(true);
    });

    it('does not produce audit entry on validation failure', () => {
      erasure.scheduleErasure('', '', '');
      expect(auditLog).toHaveLength(0);
    });

    it('includes the erasureId in the audit entry', () => {
      const result = erasure.scheduleErasure('t1', 'k1', 'reason');
      if (isOk(result)) {
        expect(auditLog[0]?.erasureId).toBe(result.data.id);
      }
    });

    it('includes the reason in the audit entry', () => {
      erasure.scheduleErasure('t1', 'k1', 'HIPAA disposal');
      expect(auditLog[0]?.reason).toBe('HIPAA disposal');
    });

    it('generates UUID-format IDs', () => {
      const result = erasure.scheduleErasure('t1', 'k1', 'reason');
      if (isOk(result)) {
        // UUID v4 pattern
        expect(result.data.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      }
    });
  });

  // ── Execute Erasure ─────────────────────────────────────────────

  describe('executeErasure', () => {
    it('destroys the key and updates the record', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'key-1', 'deletion request');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      const execResult = erasure.executeErasure(scheduleResult.data);
      expect(isOk(execResult)).toBe(true);
      if (isOk(execResult)) {
        expect(execResult.data.status).toBe('executed');
        expect(execResult.data.executedAt).not.toBeNull();
      }
    });

    it('calls the key destructor', () => {
      const destructorSpy = vi.fn(() => true);
      const e = new CryptographicErasure(auditLogger, destructorSpy, keyExistenceChecker);
      const record = e.scheduleErasure('t1', 'key-x', 'reason');
      if (isOk(record)) {
        e.executeErasure(record.data);
      }
      expect(destructorSpy).toHaveBeenCalledWith('key-x');
    });

    it('logs an execute audit entry', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'key-1', 'reason');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      auditLog.length = 0; // Clear schedule log
      erasure.executeErasure(scheduleResult.data);

      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]?.operation).toBe('execute');
      expect(auditLog[0]?.status).toBe('executed');
    });

    it('fails when record is not in scheduled status', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'key-1', 'reason');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      const execResult = erasure.executeErasure(scheduleResult.data);
      if (!isOk(execResult)) throw new Error('Execute failed');

      // Try to execute again — should fail because status is 'executed'
      const reExecResult = erasure.executeErasure(execResult.data);
      expect(isErr(reExecResult)).toBe(true);
    });

    it('returns error when key destruction fails', () => {
      const failingDestructor = () => false;
      const e = new CryptographicErasure(auditLogger, failingDestructor, keyExistenceChecker);
      const record = e.scheduleErasure('t1', 'key-fail', 'reason');
      if (!isOk(record)) throw new Error('Schedule failed');

      const execResult = e.executeErasure(record.data);
      expect(isErr(execResult)).toBe(true);
    });

    it('logs a failed execution audit entry', () => {
      const failingDestructor = () => false;
      const e = new CryptographicErasure(auditLogger, failingDestructor, keyExistenceChecker);
      const record = e.scheduleErasure('t1', 'key-fail', 'reason');
      if (!isOk(record)) throw new Error('Schedule failed');

      auditLog.length = 0;
      e.executeErasure(record.data);

      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]?.status).toBe('failed');
    });

    it('records the executedAt timestamp', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'key-1', 'reason');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      const before = new Date();
      const execResult = erasure.executeErasure(scheduleResult.data);
      const after = new Date();

      if (isOk(execResult)) {
        expect(execResult.data.executedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(execResult.data.executedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
      }
    });

    it('preserves the original tenantId and keyId in executed record', () => {
      const scheduleResult = erasure.scheduleErasure('tenant-abc', 'key-xyz', 'reason');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      const execResult = erasure.executeErasure(scheduleResult.data);
      if (isOk(execResult)) {
        expect(execResult.data.tenantId).toBe('tenant-abc');
        expect(execResult.data.keyId).toBe('key-xyz');
      }
    });

    it('preserves the original scheduledAt in executed record', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'k1', 'reason');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      const execResult = erasure.executeErasure(scheduleResult.data);
      if (isOk(execResult)) {
        expect(execResult.data.scheduledAt).toEqual(scheduleResult.data.scheduledAt);
      }
    });

    it('adds the key to destroyed set on success', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'key-to-destroy', 'reason');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      erasure.executeErasure(scheduleResult.data);
      expect(destroyedKeys.has('key-to-destroy')).toBe(true);
    });

    it('fails when trying to execute a verified record', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'k1', 'reason');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      const execResult = erasure.executeErasure(scheduleResult.data);
      if (!isOk(execResult)) throw new Error('Execute failed');

      const verifyResult = erasure.verifyErasure(execResult.data);
      if (!isOk(verifyResult)) throw new Error('Verify failed');

      const reExecResult = erasure.executeErasure(verifyResult.data);
      expect(isErr(reExecResult)).toBe(true);
    });

    it('calls destructor exactly once', () => {
      const destructorSpy = vi.fn(() => true);
      const e = new CryptographicErasure(auditLogger, destructorSpy, keyExistenceChecker);
      const record = e.scheduleErasure('t1', 'key-once', 'reason');
      if (isOk(record)) {
        e.executeErasure(record.data);
      }
      expect(destructorSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Verify Erasure ──────────────────────────────────────────────

  describe('verifyErasure', () => {
    it('confirms key no longer exists', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'key-v', 'reason');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      const execResult = erasure.executeErasure(scheduleResult.data);
      if (!isOk(execResult)) throw new Error('Execute failed');

      const verifyResult = erasure.verifyErasure(execResult.data);
      expect(isOk(verifyResult)).toBe(true);
      if (isOk(verifyResult)) {
        expect(verifyResult.data.status).toBe('verified');
        expect(verifyResult.data.verifiedAt).not.toBeNull();
      }
    });

    it('logs a verify audit entry', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'key-v', 'reason');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      const execResult = erasure.executeErasure(scheduleResult.data);
      if (!isOk(execResult)) throw new Error('Execute failed');

      auditLog.length = 0;
      erasure.verifyErasure(execResult.data);

      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]?.operation).toBe('verify');
      expect(auditLog[0]?.status).toBe('verified');
    });

    it('fails when record is not in executed status', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'key-1', 'reason');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      // Try to verify before executing — should fail
      const verifyResult = erasure.verifyErasure(scheduleResult.data);
      expect(isErr(verifyResult)).toBe(true);
    });

    it('fails when key still exists after destruction', () => {
      // Key existence checker that always says key exists
      const alwaysExistsChecker = () => true;
      const e = new CryptographicErasure(auditLogger, keyDestructor, alwaysExistsChecker);

      const record = e.scheduleErasure('t1', 'key-persist', 'reason');
      if (!isOk(record)) throw new Error('Schedule failed');

      const execResult = e.executeErasure(record.data);
      if (!isOk(execResult)) throw new Error('Execute failed');

      const verifyResult = e.verifyErasure(execResult.data);
      expect(isErr(verifyResult)).toBe(true);
    });

    it('logs a failed verify audit entry when key still exists', () => {
      const alwaysExistsChecker = () => true;
      const e = new CryptographicErasure(auditLogger, keyDestructor, alwaysExistsChecker);

      const record = e.scheduleErasure('t1', 'key-persist', 'reason');
      if (!isOk(record)) throw new Error('Schedule failed');

      const execResult = e.executeErasure(record.data);
      if (!isOk(execResult)) throw new Error('Execute failed');

      auditLog.length = 0;
      e.verifyErasure(execResult.data);

      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]?.status).toBe('failed');
    });

    it('records the verifiedAt timestamp', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'key-v', 'reason');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      const execResult = erasure.executeErasure(scheduleResult.data);
      if (!isOk(execResult)) throw new Error('Execute failed');

      const before = new Date();
      const verifyResult = erasure.verifyErasure(execResult.data);
      const after = new Date();

      if (isOk(verifyResult)) {
        expect(verifyResult.data.verifiedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(verifyResult.data.verifiedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
      }
    });

    it('calls the key existence checker with the correct keyId', () => {
      const checkerSpy = vi.fn(() => false); // Key does not exist (destroyed)
      const e = new CryptographicErasure(auditLogger, keyDestructor, checkerSpy);

      const record = e.scheduleErasure('t1', 'key-check', 'reason');
      if (!isOk(record)) throw new Error('Schedule failed');

      const execResult = e.executeErasure(record.data);
      if (!isOk(execResult)) throw new Error('Execute failed');

      e.verifyErasure(execResult.data);
      expect(checkerSpy).toHaveBeenCalledWith('key-check');
    });

    it('preserves all record fields after verification', () => {
      const scheduleResult = erasure.scheduleErasure('tenant-xyz', 'key-xyz', 'GDPR request');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      const execResult = erasure.executeErasure(scheduleResult.data);
      if (!isOk(execResult)) throw new Error('Execute failed');

      const verifyResult = erasure.verifyErasure(execResult.data);
      if (isOk(verifyResult)) {
        expect(verifyResult.data.tenantId).toBe('tenant-xyz');
        expect(verifyResult.data.keyId).toBe('key-xyz');
        expect(verifyResult.data.reason).toBe('GDPR request');
        expect(verifyResult.data.scheduledAt).toEqual(scheduleResult.data.scheduledAt);
        expect(verifyResult.data.executedAt).toEqual(execResult.data.executedAt);
      }
    });
  });

  // ── Full Lifecycle ──────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('schedule -> execute -> verify produces complete audit trail', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'key-full', 'GDPR Art. 17 request');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      const execResult = erasure.executeErasure(scheduleResult.data);
      if (!isOk(execResult)) throw new Error('Execute failed');

      const verifyResult = erasure.verifyErasure(execResult.data);
      if (!isOk(verifyResult)) throw new Error('Verify failed');

      // 3 audit entries: schedule, execute, verify
      expect(auditLog).toHaveLength(3);
      expect(auditLog[0]?.operation).toBe('schedule');
      expect(auditLog[1]?.operation).toBe('execute');
      expect(auditLog[2]?.operation).toBe('verify');

      // All entries reference the same erasure ID
      const erasureId = auditLog[0]?.erasureId;
      expect(auditLog[1]?.erasureId).toBe(erasureId);
      expect(auditLog[2]?.erasureId).toBe(erasureId);
    });

    it('cannot re-execute a completed erasure', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'key-once', 'reason');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      const execResult = erasure.executeErasure(scheduleResult.data);
      if (!isOk(execResult)) throw new Error('Execute failed');

      const verifyResult = erasure.verifyErasure(execResult.data);
      if (!isOk(verifyResult)) throw new Error('Verify failed');

      // Cannot execute again on verified record
      const reExec = erasure.executeErasure(verifyResult.data);
      expect(isErr(reExec)).toBe(true);
    });

    it('cannot verify a scheduled (non-executed) record', () => {
      const scheduleResult = erasure.scheduleErasure('t1', 'key-skip', 'reason');
      if (!isOk(scheduleResult)) throw new Error('Schedule failed');

      const verifyResult = erasure.verifyErasure(scheduleResult.data);
      expect(isErr(verifyResult)).toBe(true);
    });

    it('audit entries include tenant and key information', () => {
      erasure.scheduleErasure('tenant-abc', 'key-xyz', 'data deletion');
      expect(auditLog[0]?.tenantId).toBe('tenant-abc');
      expect(auditLog[0]?.keyId).toBe('key-xyz');
      expect(auditLog[0]?.reason).toBe('data deletion');
    });

    it('audit entries include timestamps', () => {
      erasure.scheduleErasure('t1', 'k1', 'reason');
      expect(auditLog[0]?.timestamp).toBeInstanceOf(Date);
    });

    it('multiple erasure requests are handled independently', () => {
      const r1 = erasure.scheduleErasure('t1', 'key-a', 'reason A');
      const r2 = erasure.scheduleErasure('t1', 'key-b', 'reason B');

      if (!isOk(r1) || !isOk(r2)) throw new Error('Schedule failed');

      // Execute only the first
      const exec1 = erasure.executeErasure(r1.data);
      expect(isOk(exec1)).toBe(true);

      // Second should still be schedulable to execute
      const exec2 = erasure.executeErasure(r2.data);
      expect(isOk(exec2)).toBe(true);

      // Verify both
      if (isOk(exec1)) {
        const v1 = erasure.verifyErasure(exec1.data);
        expect(isOk(v1)).toBe(true);
      }
      if (isOk(exec2)) {
        const v2 = erasure.verifyErasure(exec2.data);
        expect(isOk(v2)).toBe(true);
      }

      // Total audit entries: 2 schedule + 2 execute + 2 verify = 6
      expect(auditLog).toHaveLength(6);
    });

    it('failed execution still logs an audit entry', () => {
      const failingDestructor = () => false;
      const e = new CryptographicErasure(auditLogger, failingDestructor, keyExistenceChecker);

      const record = e.scheduleErasure('t1', 'key-fail', 'reason');
      if (!isOk(record)) throw new Error('Schedule failed');

      e.executeErasure(record.data);

      // 1 schedule + 1 failed execute = 2 total
      expect(auditLog).toHaveLength(2);
      expect(auditLog[1]?.operation).toBe('execute');
      expect(auditLog[1]?.status).toBe('failed');
    });

    it('failed verification still logs an audit entry', () => {
      const alwaysExistsChecker = () => true;
      const e = new CryptographicErasure(auditLogger, keyDestructor, alwaysExistsChecker);

      const record = e.scheduleErasure('t1', 'key-v', 'reason');
      if (!isOk(record)) throw new Error('Schedule failed');

      const execResult = e.executeErasure(record.data);
      if (!isOk(execResult)) throw new Error('Execute failed');

      e.verifyErasure(execResult.data);

      // 1 schedule + 1 execute + 1 failed verify = 3 total
      expect(auditLog).toHaveLength(3);
      expect(auditLog[2]?.operation).toBe('verify');
      expect(auditLog[2]?.status).toBe('failed');
    });

    it('state transitions are enforced: scheduled -> executed -> verified', () => {
      const record = erasure.scheduleErasure('t1', 'k1', 'reason');
      if (!isOk(record)) throw new Error('Schedule failed');

      // Cannot verify from scheduled
      expect(isErr(erasure.verifyErasure(record.data))).toBe(true);

      // Can execute from scheduled
      const executed = erasure.executeErasure(record.data);
      if (!isOk(executed)) throw new Error('Execute failed');

      // Cannot execute again from executed
      expect(isErr(erasure.executeErasure(executed.data))).toBe(true);

      // Can verify from executed
      const verified = erasure.verifyErasure(executed.data);
      if (!isOk(verified)) throw new Error('Verify failed');

      // Cannot execute or verify from verified
      expect(isErr(erasure.executeErasure(verified.data))).toBe(true);
      expect(isErr(erasure.verifyErasure(verified.data))).toBe(true);
    });

    it('audit log operations are in chronological order', () => {
      const record = erasure.scheduleErasure('t1', 'k1', 'reason');
      if (!isOk(record)) throw new Error('Schedule failed');

      const executed = erasure.executeErasure(record.data);
      if (!isOk(executed)) throw new Error('Execute failed');

      const verified = erasure.verifyErasure(executed.data);
      if (!isOk(verified)) throw new Error('Verify failed');

      // Timestamps should be non-decreasing
      for (let i = 1; i < auditLog.length; i++) {
        expect(auditLog[i]!.timestamp.getTime()).toBeGreaterThanOrEqual(
          auditLog[i - 1]!.timestamp.getTime(),
        );
      }
    });
  });
});
