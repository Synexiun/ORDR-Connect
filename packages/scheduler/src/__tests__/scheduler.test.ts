/**
 * @ordr/scheduler — Comprehensive Test Suite
 *
 * Covers:
 * - Cron parser: parseCron, isValidCron, createCronExpression, nextOccurrence
 * - InMemorySchedulerStore: definitions, instances, locks, dead letter, getDueInstances
 * - JobScheduler: registration, scheduleOnce, triggerJob, start/stop, execution,
 *   retry behaviour, dead-lettering, audit logging
 *
 * SOC2 CC7.1 / ISO 27001 A.12.4.1 / HIPAA §164.312(b)
 * All scheduler state changes MUST be audit-logged — test coverage enforces this.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseCron, isValidCron, createCronExpression, nextOccurrence } from '../cron-parser.js';
import { InMemorySchedulerStore, JobScheduler } from '../scheduler.js';
import {
  DEFAULT_RETRY_POLICY,
  DEFAULT_SCHEDULER_CONFIG,
  JOB_STATUSES,
  JOB_PRIORITIES,
} from '../types.js';
import type { ParsedCron } from '../cron-parser.js';
import type {
  JobDefinition,
  JobInstance,
  JobResult,
  JobHandler,
  DeadLetterEntry,
  SchedulerAuditLogger,
  SchedulerAlertCallback,
} from '../scheduler.js';
import type {
  CronExpression,
  JobStatus,
  JobPriority,
  RetryPolicy,
} from '../types.js';

// ─── Factory Helpers ─────────────────────────────────────────────

let defCounter = 0;
let instCounter = 0;

function makeDefinition(overrides?: Partial<Omit<JobDefinition, 'createdAt' | 'updatedAt'>>): JobDefinition {
  defCounter++;
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: overrides?.id ?? `def-${String(defCounter)}`,
    name: overrides?.name ?? `Test Job ${String(defCounter)}`,
    description: overrides?.description ?? 'A test job definition',
    cronExpression: overrides?.cronExpression !== undefined
      ? overrides.cronExpression
      : ('0 * * * *' as CronExpression),
    jobType: overrides?.jobType ?? `job-type-${String(defCounter)}`,
    payloadTemplate: overrides?.payloadTemplate ?? {},
    isActive: overrides?.isActive !== undefined ? overrides.isActive : true,
    priority: overrides?.priority ?? 'normal',
    retryPolicy: overrides?.retryPolicy ?? DEFAULT_RETRY_POLICY,
    createdAt: now,
    updatedAt: now,
  };
}

function makeInstance(overrides?: Partial<JobInstance>): JobInstance {
  instCounter++;
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: overrides?.id ?? `inst-${String(instCounter)}`,
    definitionId: overrides?.definitionId ?? 'def-1',
    tenantId: overrides?.tenantId !== undefined ? overrides.tenantId : null,
    status: overrides?.status ?? 'pending',
    payload: overrides?.payload ?? {},
    result: overrides?.result !== undefined ? overrides.result : null,
    error: overrides?.error !== undefined ? overrides.error : null,
    startedAt: overrides?.startedAt !== undefined ? overrides.startedAt : null,
    completedAt: overrides?.completedAt !== undefined ? overrides.completedAt : null,
    nextRetryAt: overrides?.nextRetryAt !== undefined ? overrides.nextRetryAt : null,
    retryCount: overrides?.retryCount ?? 0,
    lockedBy: overrides?.lockedBy !== undefined ? overrides.lockedBy : null,
    lockedAt: overrides?.lockedAt !== undefined ? overrides.lockedAt : null,
    createdAt: overrides?.createdAt ?? now,
  };
}

// ─── Audit Logger Mock ───────────────────────────────────────────

interface AuditCall {
  readonly eventType: string;
  readonly resource: string;
  readonly resourceId: string;
  readonly action: string;
  readonly details: Record<string, unknown>;
  readonly timestamp: Date;
}

function makeAuditLogger(): { logger: SchedulerAuditLogger; calls: AuditCall[] } {
  const calls: AuditCall[] = [];
  const logger: SchedulerAuditLogger = async (entry) => {
    calls.push(entry);
  };
  return { logger, calls };
}

function makeAlertCallback(): { callback: SchedulerAlertCallback; alerts: Array<Parameters<SchedulerAlertCallback>[0]> } {
  const alerts: Array<Parameters<SchedulerAlertCallback>[0]> = [];
  const callback: SchedulerAlertCallback = async (alert) => {
    alerts.push(alert);
  };
  return { callback, alerts };
}

// ─── Success / Failure Handlers ─────────────────────────────────

function makeSuccessHandler(data?: Record<string, unknown>): JobHandler {
  return async (_payload: Record<string, unknown>): Promise<JobResult> => ({
    success: true,
    data: data ?? { ok: true },
    durationMs: 10,
  });
}

function makeFailureHandler(errorMessage: string): JobHandler {
  return async (_payload: Record<string, unknown>): Promise<JobResult> => ({
    success: false,
    data: {},
    error: errorMessage,
    durationMs: 5,
  });
}

// ─────────────────────────────────────────────────────────────────
// 1. CRON PARSER — parseCron
// ─────────────────────────────────────────────────────────────────

describe('parseCron()', () => {
  describe('wildcard expressions', () => {
    it('parses "* * * * *" (every minute) — all fields contain all valid values', () => {
      const parsed = parseCron('* * * * *');

      expect(parsed.minutes.size).toBe(60);   // 0-59
      expect(parsed.hours.size).toBe(24);      // 0-23
      expect(parsed.daysOfMonth.size).toBe(31);// 1-31
      expect(parsed.months.size).toBe(12);     // 1-12
      expect(parsed.daysOfWeek.size).toBe(7);  // 0-6

      expect(parsed.minutes.has(0)).toBe(true);
      expect(parsed.minutes.has(59)).toBe(true);
      expect(parsed.hours.has(23)).toBe(true);
      expect(parsed.daysOfMonth.has(1)).toBe(true);
      expect(parsed.daysOfMonth.has(31)).toBe(true);
      expect(parsed.months.has(1)).toBe(true);
      expect(parsed.months.has(12)).toBe(true);
      expect(parsed.daysOfWeek.has(0)).toBe(true);
      expect(parsed.daysOfWeek.has(6)).toBe(true);
    });

    it('parses "0 */6 * * *" (every 6 hours at minute 0)', () => {
      const parsed = parseCron('0 */6 * * *');

      expect(parsed.minutes.size).toBe(1);
      expect(parsed.minutes.has(0)).toBe(true);

      // 0, 6, 12, 18 — 4 values
      expect(parsed.hours.size).toBe(4);
      expect(parsed.hours.has(0)).toBe(true);
      expect(parsed.hours.has(6)).toBe(true);
      expect(parsed.hours.has(12)).toBe(true);
      expect(parsed.hours.has(18)).toBe(true);
      expect(parsed.hours.has(23)).toBe(false);
    });

    it('parses "30 9 * * 1-5" (9:30 Mon-Fri)', () => {
      const parsed = parseCron('30 9 * * 1-5');

      expect(parsed.minutes.size).toBe(1);
      expect(parsed.minutes.has(30)).toBe(true);

      expect(parsed.hours.size).toBe(1);
      expect(parsed.hours.has(9)).toBe(true);

      expect(parsed.daysOfMonth.size).toBe(31);

      expect(parsed.daysOfWeek.size).toBe(5);
      expect(parsed.daysOfWeek.has(1)).toBe(true); // Monday
      expect(parsed.daysOfWeek.has(2)).toBe(true); // Tuesday
      expect(parsed.daysOfWeek.has(3)).toBe(true); // Wednesday
      expect(parsed.daysOfWeek.has(4)).toBe(true); // Thursday
      expect(parsed.daysOfWeek.has(5)).toBe(true); // Friday
      expect(parsed.daysOfWeek.has(0)).toBe(false); // Sunday
      expect(parsed.daysOfWeek.has(6)).toBe(false); // Saturday
    });
  });

  describe('step expressions', () => {
    it('parses "*/15 * * * *" (every 15 minutes)', () => {
      const parsed = parseCron('*/15 * * * *');

      expect(parsed.minutes.size).toBe(4);
      expect(parsed.minutes.has(0)).toBe(true);
      expect(parsed.minutes.has(15)).toBe(true);
      expect(parsed.minutes.has(30)).toBe(true);
      expect(parsed.minutes.has(45)).toBe(true);
      expect(parsed.minutes.has(1)).toBe(false);
    });

    it('parses "0 0 */2 * *" (every 2 days at midnight)', () => {
      const parsed = parseCron('0 0 */2 * *');

      expect(parsed.daysOfMonth.has(1)).toBe(true);
      expect(parsed.daysOfMonth.has(3)).toBe(true);
      expect(parsed.daysOfMonth.has(31)).toBe(true);
      expect(parsed.daysOfMonth.has(2)).toBe(false);
    });

    it('parses "0 */4 * * *" (every 4 hours)', () => {
      const parsed = parseCron('0 */4 * * *');

      // 0, 4, 8, 12, 16, 20 — 6 values
      expect(parsed.hours.size).toBe(6);
      expect(parsed.hours.has(0)).toBe(true);
      expect(parsed.hours.has(4)).toBe(true);
      expect(parsed.hours.has(20)).toBe(true);
      expect(parsed.hours.has(23)).toBe(false);
    });

    it('parses step starting from a value "5/10 * * * *"', () => {
      const parsed = parseCron('5/10 * * * *');

      // 5, 15, 25, 35, 45, 55 — 6 values
      expect(parsed.minutes.size).toBe(6);
      expect(parsed.minutes.has(5)).toBe(true);
      expect(parsed.minutes.has(15)).toBe(true);
      expect(parsed.minutes.has(55)).toBe(true);
      expect(parsed.minutes.has(0)).toBe(false);
    });
  });

  describe('range expressions', () => {
    it('parses range "1-5" in day-of-week field', () => {
      const parsed = parseCron('0 12 * * 1-5');

      expect(parsed.daysOfWeek.size).toBe(5);
      for (let d = 1; d <= 5; d++) {
        expect(parsed.daysOfWeek.has(d)).toBe(true);
      }
      expect(parsed.daysOfWeek.has(0)).toBe(false);
      expect(parsed.daysOfWeek.has(6)).toBe(false);
    });

    it('parses range with step "0-59/10 * * * *"', () => {
      const parsed = parseCron('0-59/10 * * * *');

      // 0, 10, 20, 30, 40, 50 — 6 values
      expect(parsed.minutes.size).toBe(6);
      expect(parsed.minutes.has(0)).toBe(true);
      expect(parsed.minutes.has(10)).toBe(true);
      expect(parsed.minutes.has(50)).toBe(true);
      expect(parsed.minutes.has(59)).toBe(false);
    });

    it('parses month range "6-9" (Jun-Sep)', () => {
      const parsed = parseCron('0 0 1 6-9 *');

      expect(parsed.months.size).toBe(4);
      expect(parsed.months.has(6)).toBe(true);
      expect(parsed.months.has(7)).toBe(true);
      expect(parsed.months.has(8)).toBe(true);
      expect(parsed.months.has(9)).toBe(true);
      expect(parsed.months.has(5)).toBe(false);
    });
  });

  describe('list expressions', () => {
    it('parses list "1,3,5" in day-of-week field (Mon, Wed, Fri)', () => {
      const parsed = parseCron('0 8 * * 1,3,5');

      expect(parsed.daysOfWeek.size).toBe(3);
      expect(parsed.daysOfWeek.has(1)).toBe(true);
      expect(parsed.daysOfWeek.has(3)).toBe(true);
      expect(parsed.daysOfWeek.has(5)).toBe(true);
      expect(parsed.daysOfWeek.has(2)).toBe(false);
    });

    it('parses list "0,15,30,45" in minute field (quarterly)', () => {
      const parsed = parseCron('0,15,30,45 * * * *');

      expect(parsed.minutes.size).toBe(4);
      expect(parsed.minutes.has(0)).toBe(true);
      expect(parsed.minutes.has(15)).toBe(true);
      expect(parsed.minutes.has(30)).toBe(true);
      expect(parsed.minutes.has(45)).toBe(true);
      expect(parsed.minutes.has(1)).toBe(false);
    });

    it('parses month list "1,4,7,10" (quarterly months)', () => {
      const parsed = parseCron('0 0 1 1,4,7,10 *');

      expect(parsed.months.size).toBe(4);
      expect(parsed.months.has(1)).toBe(true);
      expect(parsed.months.has(4)).toBe(true);
      expect(parsed.months.has(7)).toBe(true);
      expect(parsed.months.has(10)).toBe(true);
      expect(parsed.months.has(2)).toBe(false);
    });
  });

  describe('combination expressions', () => {
    it('parses combined list and range "1-3,5,7-9" in minute field', () => {
      const parsed = parseCron('1-3,5,7-9 * * * *');

      // 1, 2, 3, 5, 7, 8, 9 — 7 values
      expect(parsed.minutes.size).toBe(7);
      expect(parsed.minutes.has(1)).toBe(true);
      expect(parsed.minutes.has(2)).toBe(true);
      expect(parsed.minutes.has(3)).toBe(true);
      expect(parsed.minutes.has(5)).toBe(true);
      expect(parsed.minutes.has(7)).toBe(true);
      expect(parsed.minutes.has(9)).toBe(true);
      expect(parsed.minutes.has(4)).toBe(false);
      expect(parsed.minutes.has(6)).toBe(false);
    });

    it('handles extra whitespace between fields gracefully', () => {
      const parsed = parseCron('  0   12   *   *   *  ');

      expect(parsed.minutes.size).toBe(1);
      expect(parsed.minutes.has(0)).toBe(true);
      expect(parsed.hours.size).toBe(1);
      expect(parsed.hours.has(12)).toBe(true);
    });
  });

  describe('error cases', () => {
    it('throws on fewer than 5 fields', () => {
      expect(() => parseCron('* * * *')).toThrow('5 fields');
    });

    it('throws on more than 5 fields', () => {
      expect(() => parseCron('* * * * * *')).toThrow('5 fields');
    });

    it('throws on minute out of bounds (negative)', () => {
      expect(() => parseCron('-1 * * * *')).toThrow();
    });

    it('throws on minute out of bounds (> 59)', () => {
      expect(() => parseCron('60 * * * *')).toThrow('out of bounds');
    });

    it('throws on hour out of bounds (> 23)', () => {
      expect(() => parseCron('0 24 * * *')).toThrow('out of bounds');
    });

    it('throws on day-of-month out of bounds (0)', () => {
      expect(() => parseCron('0 0 0 * *')).toThrow('out of bounds');
    });

    it('throws on day-of-month out of bounds (> 31)', () => {
      expect(() => parseCron('0 0 32 * *')).toThrow('out of bounds');
    });

    it('throws on month out of bounds (0)', () => {
      expect(() => parseCron('0 0 1 0 *')).toThrow('out of bounds');
    });

    it('throws on month out of bounds (> 12)', () => {
      expect(() => parseCron('0 0 1 13 *')).toThrow('out of bounds');
    });

    it('throws on day-of-week out of bounds (> 6)', () => {
      expect(() => parseCron('0 0 * * 7')).toThrow('out of bounds');
    });

    it('throws on invalid step value (zero)', () => {
      expect(() => parseCron('*/0 * * * *')).toThrow();
    });

    it('throws on non-numeric value in a field', () => {
      expect(() => parseCron('abc * * * *')).toThrow();
    });

    it('throws on inverted range (start > end)', () => {
      expect(() => parseCron('59-0 * * * *')).toThrow();
    });

    it('throws on empty string', () => {
      expect(() => parseCron('')).toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. CRON PARSER — isValidCron
// ─────────────────────────────────────────────────────────────────

describe('isValidCron()', () => {
  it('returns true for "* * * * *"', () => {
    expect(isValidCron('* * * * *')).toBe(true);
  });

  it('returns true for "0 */6 * * *"', () => {
    expect(isValidCron('0 */6 * * *')).toBe(true);
  });

  it('returns true for "30 9 * * 1-5"', () => {
    expect(isValidCron('30 9 * * 1-5')).toBe(true);
  });

  it('returns true for complex list+range "0,30 9-17 * * 1-5"', () => {
    expect(isValidCron('0,30 9-17 * * 1-5')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidCron('')).toBe(false);
  });

  it('returns false for 4-field expression', () => {
    expect(isValidCron('0 0 * *')).toBe(false);
  });

  it('returns false for 6-field expression', () => {
    expect(isValidCron('0 0 * * * *')).toBe(false);
  });

  it('returns false for out-of-bounds minute', () => {
    expect(isValidCron('60 * * * *')).toBe(false);
  });

  it('returns false for out-of-bounds hour', () => {
    expect(isValidCron('0 24 * * *')).toBe(false);
  });

  it('returns false for non-numeric field', () => {
    expect(isValidCron('x * * * *')).toBe(false);
  });

  it('returns false for invalid step (zero)', () => {
    expect(isValidCron('*/0 * * * *')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. CRON PARSER — createCronExpression
// ─────────────────────────────────────────────────────────────────

describe('createCronExpression()', () => {
  it('returns a branded CronExpression for a valid string', () => {
    const expr: CronExpression = createCronExpression('0 0 * * *');
    // Type check: can be assigned to CronExpression
    expect(typeof expr).toBe('string');
    expect(expr).toBe('0 0 * * *');
  });

  it('preserves the original expression string value', () => {
    const input = '30 9 * * 1-5';
    const expr = createCronExpression(input);
    expect(expr).toBe(input);
  });

  it('throws on an invalid expression', () => {
    expect(() => createCronExpression('not valid')).toThrow();
  });

  it('throws on an empty string', () => {
    expect(() => createCronExpression('')).toThrow();
  });

  it('throws on out-of-bounds values', () => {
    expect(() => createCronExpression('60 * * * *')).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────
// 4. CRON PARSER — nextOccurrence
// ─────────────────────────────────────────────────────────────────

describe('nextOccurrence()', () => {
  it('finds the next minute after a given time for "* * * * *"', () => {
    const parsed = parseCron('* * * * *');
    // Use a local-time reference since nextOccurrence works with local Date methods
    const after = new Date(2026, 2, 25, 10, 30, 0, 0); // Mar 25 10:30 local
    const next = nextOccurrence(parsed, after);

    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(after.getTime());
    // Should be exactly the next minute
    expect(next!.getMinutes()).toBe(31);
    expect(next!.getHours()).toBe(10);
    expect(next!.getSeconds()).toBe(0);
    expect(next!.getMilliseconds()).toBe(0);
  });

  it('finds the next 6-hour boundary for "0 */6 * * *"', () => {
    const parsed = parseCron('0 */6 * * *');
    // Currently 10:30 local — next 6h boundary is 12:00 local
    const after = new Date(2026, 2, 25, 10, 30, 0, 0);
    const next = nextOccurrence(parsed, after);

    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(12);
    expect(next!.getMinutes()).toBe(0);
  });

  it('finds the next weekday 9:30 for "30 9 * * 1-5"', () => {
    const parsed = parseCron('30 9 * * 1-5');
    // Wednesday 2026-03-25 at 10:00 local — next should be Thursday 2026-03-26 at 09:30 local
    const after = new Date(2026, 2, 25, 10, 0, 0, 0);
    const next = nextOccurrence(parsed, after);

    expect(next).not.toBeNull();
    // Must be a weekday (1-5)
    const dow = next!.getDay();
    expect(dow).toBeGreaterThanOrEqual(1);
    expect(dow).toBeLessThanOrEqual(5);
    expect(next!.getHours()).toBe(9);
    expect(next!.getMinutes()).toBe(30);
  });

  it('returns null for an impossible cron schedule (Feb 30)', () => {
    // Feb 30 never exists — parser accepts it but nextOccurrence should return null
    const parsed = parseCron('0 0 30 2 *');
    const after = new Date('2026-01-01T00:00:00.000Z');
    const next = nextOccurrence(parsed, after);
    expect(next).toBeNull();
  });

  it('always returns a time strictly after the reference date', () => {
    const parsed = parseCron('* * * * *');
    const after = new Date('2026-06-01T12:00:00.000Z');
    const next = nextOccurrence(parsed, after);

    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(after.getTime());
  });

  it('returns a Date with seconds and milliseconds zeroed', () => {
    const parsed = parseCron('*/10 * * * *');
    const after = new Date('2026-03-01T08:07:45.500Z');
    const next = nextOccurrence(parsed, after);

    expect(next).not.toBeNull();
    expect(next!.getSeconds()).toBe(0);
    expect(next!.getMilliseconds()).toBe(0);
  });

  it('handles month-specific schedule correctly "0 12 1 6 *" (noon 1 June)', () => {
    const parsed = parseCron('0 12 1 6 *');
    const after = new Date('2026-01-15T00:00:00.000Z');
    const next = nextOccurrence(parsed, after);

    expect(next).not.toBeNull();
    // Must be month 6, day 1, hour 12
    expect(next!.getMonth() + 1).toBe(6);
    expect(next!.getDate()).toBe(1);
    expect(next!.getHours()).toBe(12);
    expect(next!.getMinutes()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// 5. InMemorySchedulerStore — Definitions CRUD
// ─────────────────────────────────────────────────────────────────

describe('InMemorySchedulerStore — definitions', () => {
  let store: InMemorySchedulerStore;

  beforeEach(() => {
    store = new InMemorySchedulerStore();
    defCounter = 0;
    instCounter = 0;
  });

  it('saveDefinition persists a definition retrievable by getDefinition', async () => {
    const def = makeDefinition();
    await store.saveDefinition(def);

    const retrieved = await store.getDefinition(def.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(def.id);
    expect(retrieved!.name).toBe(def.name);
    expect(retrieved!.jobType).toBe(def.jobType);
  });

  it('getDefinition returns null for an unknown ID', async () => {
    const result = await store.getDefinition('nonexistent-id');
    expect(result).toBeNull();
  });

  it('listDefinitions returns all saved definitions', async () => {
    const def1 = makeDefinition();
    const def2 = makeDefinition();
    await store.saveDefinition(def1);
    await store.saveDefinition(def2);

    const all = await store.listDefinitions();
    expect(all.length).toBe(2);
    const ids = all.map((d) => d.id);
    expect(ids).toContain(def1.id);
    expect(ids).toContain(def2.id);
  });

  it('listDefinitions returns empty array when no definitions saved', async () => {
    const all = await store.listDefinitions();
    expect(all).toHaveLength(0);
  });

  it('getActiveDefinitions returns only isActive=true definitions', async () => {
    const active = makeDefinition({ isActive: true });
    const inactive = makeDefinition({ isActive: false });
    await store.saveDefinition(active);
    await store.saveDefinition(inactive);

    const results = await store.getActiveDefinitions();
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe(active.id);
  });

  it('disableDefinition sets isActive to false', async () => {
    const def = makeDefinition({ isActive: true });
    await store.saveDefinition(def);

    await store.disableDefinition(def.id);

    const updated = await store.getDefinition(def.id);
    expect(updated).not.toBeNull();
    expect(updated!.isActive).toBe(false);
  });

  it('disableDefinition is a no-op for unknown IDs', async () => {
    // Should not throw
    await expect(store.disableDefinition('ghost-id')).resolves.toBeUndefined();
  });

  it('saveDefinition overwrites an existing definition with same ID', async () => {
    const def = makeDefinition({ name: 'Original Name' });
    await store.saveDefinition(def);

    const updated: JobDefinition = { ...def, name: 'Updated Name', updatedAt: new Date() };
    await store.saveDefinition(updated);

    const retrieved = await store.getDefinition(def.id);
    expect(retrieved!.name).toBe('Updated Name');

    const all = await store.listDefinitions();
    expect(all.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────
// 6. InMemorySchedulerStore — Instances CRUD
// ─────────────────────────────────────────────────────────────────

describe('InMemorySchedulerStore — instances', () => {
  let store: InMemorySchedulerStore;

  beforeEach(() => {
    store = new InMemorySchedulerStore();
    defCounter = 0;
    instCounter = 0;
  });

  it('createInstance persists an instance retrievable by getInstance', async () => {
    const inst = makeInstance();
    await store.createInstance(inst);

    const retrieved = await store.getInstance(inst.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(inst.id);
    expect(retrieved!.status).toBe('pending');
  });

  it('getInstance returns null for unknown ID', async () => {
    const result = await store.getInstance('ghost-id');
    expect(result).toBeNull();
  });

  it('updateInstance replaces the stored instance', async () => {
    const inst = makeInstance({ status: 'pending' });
    await store.createInstance(inst);

    const running: JobInstance = {
      ...inst,
      status: 'running',
      startedAt: new Date(),
    };
    await store.updateInstance(running);

    const retrieved = await store.getInstance(inst.id);
    expect(retrieved!.status).toBe('running');
    expect(retrieved!.startedAt).not.toBeNull();
  });

  it('listInstances returns all instances with no filter', async () => {
    await store.createInstance(makeInstance({ status: 'pending' }));
    await store.createInstance(makeInstance({ status: 'completed' }));
    await store.createInstance(makeInstance({ status: 'failed' }));

    const all = await store.listInstances();
    expect(all.length).toBe(3);
  });

  it('listInstances filters by status', async () => {
    await store.createInstance(makeInstance({ status: 'pending' }));
    await store.createInstance(makeInstance({ status: 'pending' }));
    await store.createInstance(makeInstance({ status: 'completed' }));

    const pending = await store.listInstances({ status: 'pending' });
    expect(pending.length).toBe(2);
    expect(pending.every((i) => i.status === 'pending')).toBe(true);
  });

  it('getRetryableInstances returns only retrying instances with due nextRetryAt', async () => {
    const now = new Date('2026-03-25T12:00:00.000Z');
    const pastDue = makeInstance({
      status: 'retrying',
      nextRetryAt: new Date('2026-03-25T11:00:00.000Z'),
    });
    const notYetDue = makeInstance({
      status: 'retrying',
      nextRetryAt: new Date('2026-03-25T13:00:00.000Z'),
    });
    const pending = makeInstance({ status: 'pending', nextRetryAt: null });

    await store.createInstance(pastDue);
    await store.createInstance(notYetDue);
    await store.createInstance(pending);

    const retryable = await store.getRetryableInstances(now);
    expect(retryable.length).toBe(1);
    expect(retryable[0]!.id).toBe(pastDue.id);
  });
});

// ─────────────────────────────────────────────────────────────────
// 7. InMemorySchedulerStore — getDueInstances
// ─────────────────────────────────────────────────────────────────

describe('InMemorySchedulerStore — getDueInstances', () => {
  let store: InMemorySchedulerStore;

  beforeEach(() => {
    store = new InMemorySchedulerStore();
    defCounter = 0;
    instCounter = 0;
  });

  it('returns pending instances with createdAt <= now', async () => {
    const now = new Date('2026-03-25T12:00:00.000Z');
    const due = makeInstance({
      status: 'pending',
      createdAt: new Date('2026-03-25T11:59:00.000Z'),
    });
    const future = makeInstance({
      status: 'pending',
      createdAt: new Date('2026-03-25T13:00:00.000Z'),
    });

    await store.createInstance(due);
    await store.createInstance(future);

    const results = await store.getDueInstances(now);
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe(due.id);
  });

  it('excludes non-pending instances', async () => {
    const now = new Date('2026-03-25T12:00:00.000Z');
    const statuses: JobStatus[] = ['running', 'completed', 'failed', 'retrying', 'cancelled'];

    for (const status of statuses) {
      await store.createInstance(
        makeInstance({ status, createdAt: new Date('2026-03-25T10:00:00.000Z') }),
      );
    }

    const results = await store.getDueInstances(now);
    expect(results).toHaveLength(0);
  });

  it('sorts by priority — critical before normal', async () => {
    const now = new Date('2026-03-25T12:00:00.000Z');
    const created = new Date('2026-03-25T10:00:00.000Z');

    const criticalDef = makeDefinition({ priority: 'critical' });
    const normalDef = makeDefinition({ priority: 'normal' });

    await store.saveDefinition(criticalDef);
    await store.saveDefinition(normalDef);

    const normalInst = makeInstance({
      status: 'pending',
      createdAt: new Date(created.getTime() - 1000), // older
      definitionId: normalDef.id,
    });
    const criticalInst = makeInstance({
      status: 'pending',
      createdAt: created,
      definitionId: criticalDef.id,
    });

    await store.createInstance(normalInst);
    await store.createInstance(criticalInst);

    const results = await store.getDueInstances(now);
    expect(results.length).toBe(2);
    // Critical should be first regardless of creation time
    expect(results[0]!.id).toBe(criticalInst.id);
    expect(results[1]!.id).toBe(normalInst.id);
  });

  it('within same priority, sorts by createdAt (oldest first)', async () => {
    const now = new Date('2026-03-25T12:00:00.000Z');

    const older = makeInstance({
      status: 'pending',
      createdAt: new Date('2026-03-25T09:00:00.000Z'),
    });
    const newer = makeInstance({
      status: 'pending',
      createdAt: new Date('2026-03-25T11:00:00.000Z'),
    });

    await store.createInstance(newer);
    await store.createInstance(older);

    const results = await store.getDueInstances(now);
    expect(results.length).toBe(2);
    expect(results[0]!.id).toBe(older.id);
    expect(results[1]!.id).toBe(newer.id);
  });
});

// ─────────────────────────────────────────────────────────────────
// 8. InMemorySchedulerStore — Advisory Locks
// ─────────────────────────────────────────────────────────────────

describe('InMemorySchedulerStore — advisory locks', () => {
  let store: InMemorySchedulerStore;

  beforeEach(() => {
    store = new InMemorySchedulerStore();
    defCounter = 0;
    instCounter = 0;
  });

  it('tryLock returns true on first acquisition', async () => {
    const inst = makeInstance();
    await store.createInstance(inst);

    const result = await store.tryLock(inst.id, 'scheduler-A', new Date());
    expect(result).toBe(true);
  });

  it('tryLock returns false when lock is already held', async () => {
    const inst = makeInstance();
    await store.createInstance(inst);

    await store.tryLock(inst.id, 'scheduler-A', new Date());
    const second = await store.tryLock(inst.id, 'scheduler-B', new Date());
    expect(second).toBe(false);
  });

  it('releaseLock allows re-acquisition after release', async () => {
    const inst = makeInstance();
    await store.createInstance(inst);

    await store.tryLock(inst.id, 'scheduler-A', new Date());
    await store.releaseLock(inst.id, 'scheduler-A');

    const reAcquired = await store.tryLock(inst.id, 'scheduler-B', new Date());
    expect(reAcquired).toBe(true);
  });

  it('releaseLock by wrong holder does not release the lock', async () => {
    const inst = makeInstance();
    await store.createInstance(inst);

    await store.tryLock(inst.id, 'scheduler-A', new Date());
    await store.releaseLock(inst.id, 'scheduler-B'); // wrong holder

    // scheduler-A still holds it — scheduler-C should fail
    const result = await store.tryLock(inst.id, 'scheduler-C', new Date());
    expect(result).toBe(false);
  });

  it('tryLock updates the instance lockedBy field', async () => {
    const inst = makeInstance();
    await store.createInstance(inst);

    await store.tryLock(inst.id, 'scheduler-A', new Date());
    const updated = await store.getInstance(inst.id);

    expect(updated!.lockedBy).toBe('scheduler-A');
    expect(updated!.lockedAt).not.toBeNull();
  });

  it('releaseLock clears lockedBy and lockedAt on the instance', async () => {
    const inst = makeInstance();
    await store.createInstance(inst);

    await store.tryLock(inst.id, 'scheduler-A', new Date());
    await store.releaseLock(inst.id, 'scheduler-A');

    const updated = await store.getInstance(inst.id);
    expect(updated!.lockedBy).toBeNull();
    expect(updated!.lockedAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// 9. InMemorySchedulerStore — Dead Letter Queue
// ─────────────────────────────────────────────────────────────────

describe('InMemorySchedulerStore — dead letter queue', () => {
  let store: InMemorySchedulerStore;

  beforeEach(() => {
    store = new InMemorySchedulerStore();
  });

  function makeDeadLetter(overrides?: Partial<DeadLetterEntry>): DeadLetterEntry {
    return {
      id: overrides?.id ?? `dl-${Math.random().toString(36).slice(2)}`,
      jobInstanceId: overrides?.jobInstanceId ?? 'inst-1',
      definitionId: overrides?.definitionId ?? 'def-1',
      error: overrides?.error ?? 'Something went wrong',
      payload: overrides?.payload ?? { key: 'value' },
      failedAt: overrides?.failedAt ?? new Date(),
    };
  }

  it('addToDeadLetter persists an entry', async () => {
    const entry = makeDeadLetter();
    await store.addToDeadLetter(entry);

    const retrieved = await store.getDeadLetterEntry(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(entry.id);
    expect(retrieved!.error).toBe(entry.error);
  });

  it('getDeadLetterEntry returns null for unknown ID', async () => {
    const result = await store.getDeadLetterEntry('ghost-dl');
    expect(result).toBeNull();
  });

  it('listDeadLetter returns all entries', async () => {
    await store.addToDeadLetter(makeDeadLetter({ id: 'dl-1' }));
    await store.addToDeadLetter(makeDeadLetter({ id: 'dl-2' }));

    const list = await store.listDeadLetter();
    expect(list.length).toBe(2);
    const ids = list.map((e) => e.id);
    expect(ids).toContain('dl-1');
    expect(ids).toContain('dl-2');
  });

  it('removeDeadLetterEntry deletes the entry', async () => {
    const entry = makeDeadLetter();
    await store.addToDeadLetter(entry);
    await store.removeDeadLetterEntry(entry.id);

    const result = await store.getDeadLetterEntry(entry.id);
    expect(result).toBeNull();

    const list = await store.listDeadLetter();
    expect(list).toHaveLength(0);
  });

  it('removeDeadLetterEntry is a no-op for unknown IDs', async () => {
    await expect(store.removeDeadLetterEntry('ghost-dl')).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// 10. JobScheduler — registerJob + getStatus
// ─────────────────────────────────────────────────────────────────

describe('JobScheduler — registerJob', () => {
  let store: InMemorySchedulerStore;
  let auditCalls: AuditCall[];
  let scheduler: JobScheduler;

  beforeEach(() => {
    store = new InMemorySchedulerStore();
    defCounter = 0;
    instCounter = 0;
    const audit = makeAuditLogger();
    const alerting = makeAlertCallback();
    auditCalls = audit.calls;
    scheduler = new JobScheduler(
      store,
      audit.logger,
      alerting.callback,
      { pollIntervalMs: 60_000, instanceId: 'test-scheduler' },
    );
  });

  it('registerJob persists the definition in the store', async () => {
    const def = makeDefinition();
    const defInput = { ...def } as Omit<JobDefinition, 'createdAt' | 'updatedAt'>;
    delete (defInput as Partial<JobDefinition>).createdAt;
    delete (defInput as Partial<JobDefinition>).updatedAt;

    await scheduler.registerJob(defInput, makeSuccessHandler());

    const saved = await store.getDefinition(def.id);
    expect(saved).not.toBeNull();
    expect(saved!.id).toBe(def.id);
    expect(saved!.jobType).toBe(def.jobType);
  });

  it('getStatus reflects registered handlers count', async () => {
    const def1 = makeDefinition({ jobType: 'job-type-A' });
    const def2 = makeDefinition({ jobType: 'job-type-B' });
    const def1Input = omitTimestamps(def1);
    const def2Input = omitTimestamps(def2);

    await scheduler.registerJob(def1Input, makeSuccessHandler());
    await scheduler.registerJob(def2Input, makeSuccessHandler());

    const status = await scheduler.getStatus();
    expect(status.registeredHandlers).toBe(2);
  });

  it('registerJob emits an audit log entry', async () => {
    const def = makeDefinition();
    await scheduler.registerJob(omitTimestamps(def), makeSuccessHandler());

    const registerEntries = auditCalls.filter((c) => c.action === 'register');
    expect(registerEntries.length).toBe(1);
    expect(registerEntries[0]!.resource).toBe('job_definition');
    expect(registerEntries[0]!.resourceId).toBe(def.id);
  });

  it('getStatus reports running=false before start()', async () => {
    const status = await scheduler.getStatus();
    expect(status.running).toBe(false);
    expect(status.runningJobs).toBe(0);
  });

  it('getStatus reports instanceId from config', async () => {
    const status = await scheduler.getStatus();
    expect(status.instanceId).toBe('test-scheduler');
  });

  it('getStatus includes nextScheduled for cron definitions', async () => {
    const def = makeDefinition({
      cronExpression: '0 0 * * *' as CronExpression,
      jobType: 'nightly-check',
    });
    await scheduler.registerJob(omitTimestamps(def), makeSuccessHandler());

    const status = await scheduler.getStatus();
    expect(status.nextScheduled.length).toBeGreaterThanOrEqual(1);
    expect(status.nextScheduled[0]!.jobType).toBe('nightly-check');
    expect(status.nextScheduled[0]!.nextRunAt).toBeInstanceOf(Date);
  });
});

// ─────────────────────────────────────────────────────────────────
// 11. JobScheduler — scheduleOnce
// ─────────────────────────────────────────────────────────────────

describe('JobScheduler — scheduleOnce', () => {
  let store: InMemorySchedulerStore;
  let scheduler: JobScheduler;
  let auditCalls: AuditCall[];

  beforeEach(() => {
    store = new InMemorySchedulerStore();
    defCounter = 0;
    instCounter = 0;
    const audit = makeAuditLogger();
    const alerting = makeAlertCallback();
    auditCalls = audit.calls;
    scheduler = new JobScheduler(
      store,
      audit.logger,
      alerting.callback,
      { pollIntervalMs: 60_000, instanceId: 'test-scheduler' },
    );
  });

  it('scheduleOnce creates a pending instance', async () => {
    const runAt = new Date(Date.now() + 5_000);
    const instanceId = await scheduler.scheduleOnce('send-email', { to: 'a@b.com' }, runAt);

    expect(typeof instanceId).toBe('string');
    expect(instanceId).toBeTruthy();

    const inst = await store.getInstance(instanceId);
    expect(inst).not.toBeNull();
    expect(inst!.status).toBe('pending');
    expect(inst!.payload).toEqual({ to: 'a@b.com' });
  });

  it('scheduleOnce sets createdAt to the runAt time', async () => {
    const runAt = new Date('2026-06-01T09:00:00.000Z');
    const instanceId = await scheduler.scheduleOnce('my-job', {}, runAt);

    const inst = await store.getInstance(instanceId);
    expect(inst!.createdAt.getTime()).toBe(runAt.getTime());
  });

  it('scheduleOnce sets tenantId from options', async () => {
    const runAt = new Date();
    const instanceId = await scheduler.scheduleOnce(
      'tenant-job',
      { key: 1 },
      runAt,
      { tenantId: 'tenant-xyz' },
    );

    const inst = await store.getInstance(instanceId);
    expect(inst!.tenantId).toBe('tenant-xyz');
  });

  it('scheduleOnce emits an audit log entry with action schedule_once', async () => {
    const runAt = new Date();
    await scheduler.scheduleOnce('audit-check', {}, runAt, { tenantId: 'tenant-1' });

    const entries = auditCalls.filter((c) => c.action === 'schedule_once');
    expect(entries.length).toBe(1);
    expect(entries[0]!.resource).toBe('job_instance');
    expect(entries[0]!.details['tenantId']).toBe('tenant-1');
  });

  it('scheduleOnce auto-creates an ad-hoc definition when no matching jobType exists', async () => {
    const runAt = new Date();
    await scheduler.scheduleOnce('brand-new-type', {}, runAt);

    const defs = await store.listDefinitions();
    expect(defs.length).toBe(1);
    expect(defs[0]!.jobType).toBe('brand-new-type');
    expect(defs[0]!.cronExpression).toBeNull();
  });

  it('scheduleOnce reuses an existing definition for the same jobType', async () => {
    const def = makeDefinition({ jobType: 'reused-type' });
    await store.saveDefinition(def);

    const runAt = new Date();
    await scheduler.scheduleOnce('reused-type', {}, runAt);

    const defs = await store.listDefinitions();
    expect(defs.length).toBe(1); // No new definition created
  });
});

// ─────────────────────────────────────────────────────────────────
// 12. JobScheduler — triggerJob
// ─────────────────────────────────────────────────────────────────

describe('JobScheduler — triggerJob', () => {
  let store: InMemorySchedulerStore;
  let scheduler: JobScheduler;
  let auditCalls: AuditCall[];

  beforeEach(() => {
    store = new InMemorySchedulerStore();
    defCounter = 0;
    instCounter = 0;
    const audit = makeAuditLogger();
    const alerting = makeAlertCallback();
    auditCalls = audit.calls;
    scheduler = new JobScheduler(
      store,
      audit.logger,
      alerting.callback,
      { pollIntervalMs: 60_000, instanceId: 'test-scheduler' },
    );
  });

  it('triggerJob creates a pending instance', async () => {
    const def = makeDefinition({ jobType: 'trigger-test' });
    await store.saveDefinition(def);

    const instanceId = await scheduler.triggerJob(def.id);

    const inst = await store.getInstance(instanceId);
    expect(inst).not.toBeNull();
    expect(inst!.status).toBe('pending');
    expect(inst!.definitionId).toBe(def.id);
  });

  it('triggerJob throws for unknown definition ID', async () => {
    await expect(scheduler.triggerJob('no-such-def')).rejects.toThrow(
      'not found',
    );
  });

  it('triggerJob copies the definition payloadTemplate into the instance', async () => {
    const def = makeDefinition({
      jobType: 'payload-test',
      payloadTemplate: { region: 'us-east-1', batch: 500 },
    });
    await store.saveDefinition(def);

    const instanceId = await scheduler.triggerJob(def.id);
    const inst = await store.getInstance(instanceId);

    expect(inst!.payload).toEqual({ region: 'us-east-1', batch: 500 });
  });

  it('triggerJob emits an audit log entry with action manual_trigger', async () => {
    const def = makeDefinition({ jobType: 'audit-trigger' });
    await store.saveDefinition(def);

    await scheduler.triggerJob(def.id, 'tenant-123');

    const entries = auditCalls.filter((c) => c.action === 'manual_trigger');
    expect(entries.length).toBe(1);
    expect(entries[0]!.details['tenantId']).toBe('tenant-123');
    expect(entries[0]!.details['jobType']).toBe('audit-trigger');
  });

  it('triggerJob sets tenantId on the created instance', async () => {
    const def = makeDefinition({ jobType: 'tenant-trigger' });
    await store.saveDefinition(def);

    const instanceId = await scheduler.triggerJob(def.id, 'tenant-abc');
    const inst = await store.getInstance(instanceId);

    expect(inst!.tenantId).toBe('tenant-abc');
  });
});

// ─────────────────────────────────────────────────────────────────
// 13. JobScheduler — start / stop lifecycle
// ─────────────────────────────────────────────────────────────────

describe('JobScheduler — start/stop lifecycle', () => {
  let store: InMemorySchedulerStore;
  let auditCalls: AuditCall[];
  let scheduler: JobScheduler;

  beforeEach(() => {
    store = new InMemorySchedulerStore();
    defCounter = 0;
    instCounter = 0;
    const audit = makeAuditLogger();
    const alerting = makeAlertCallback();
    auditCalls = audit.calls;
    scheduler = new JobScheduler(
      store,
      audit.logger,
      alerting.callback,
      { pollIntervalMs: 60_000, instanceId: 'lifecycle-test' },
    );
  });

  it('getStatus reports running=false before start()', async () => {
    const status = await scheduler.getStatus();
    expect(status.running).toBe(false);
  });

  it('start() transitions running to true', async () => {
    await scheduler.start();
    try {
      const status = await scheduler.getStatus();
      expect(status.running).toBe(true);
    } finally {
      await scheduler.stop();
    }
  });

  it('stop() transitions running to false', async () => {
    await scheduler.start();
    await scheduler.stop();

    const status = await scheduler.getStatus();
    expect(status.running).toBe(false);
  });

  it('start() is idempotent — calling twice does not throw', async () => {
    await scheduler.start();
    await scheduler.start(); // second call should be no-op
    try {
      const status = await scheduler.getStatus();
      expect(status.running).toBe(true);
    } finally {
      await scheduler.stop();
    }
  });

  it('stop() is idempotent — calling twice does not throw', async () => {
    await scheduler.start();
    await scheduler.stop();
    await expect(scheduler.stop()).resolves.toBeUndefined();
  });

  it('start() emits an audit log entry with action start', async () => {
    await scheduler.start();
    try {
      const entries = auditCalls.filter((c) => c.action === 'start');
      expect(entries.length).toBe(1);
      expect(entries[0]!.resource).toBe('scheduler');
      expect(entries[0]!.resourceId).toBe('lifecycle-test');
    } finally {
      await scheduler.stop();
    }
  });

  it('stop() emits an audit log entry with action stop', async () => {
    await scheduler.start();
    await scheduler.stop();

    const entries = auditCalls.filter((c) => c.action === 'stop');
    expect(entries.length).toBe(1);
    expect(entries[0]!.resource).toBe('scheduler');
  });
});

// ─────────────────────────────────────────────────────────────────
// 14. JobScheduler — job execution: successful handler
// ─────────────────────────────────────────────────────────────────

describe('JobScheduler — successful job execution', () => {
  let store: InMemorySchedulerStore;
  let auditCalls: AuditCall[];
  let scheduler: JobScheduler;

  beforeEach(() => {
    store = new InMemorySchedulerStore();
    defCounter = 0;
    instCounter = 0;
    const audit = makeAuditLogger();
    const alerting = makeAlertCallback();
    auditCalls = audit.calls;
    scheduler = new JobScheduler(
      store,
      audit.logger,
      alerting.callback,
      { pollIntervalMs: 60_000, instanceId: 'exec-test' },
    );
  });

  it('triggerJob + start executes handler and marks instance completed', async () => {
    const def = makeDefinition({ jobType: 'success-exec' });
    await scheduler.registerJob(omitTimestamps(def), makeSuccessHandler({ processed: true }));

    await scheduler.start();
    try {
      const instanceId = await scheduler.triggerJob(def.id);
      // Allow micro-task queue to drain
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      const inst = await store.getInstance(instanceId);
      expect(inst).not.toBeNull();
      expect(inst!.status).toBe('completed');
      expect(inst!.result).toEqual({ processed: true });
      expect(inst!.completedAt).not.toBeNull();
      expect(inst!.error).toBeNull();
    } finally {
      await scheduler.stop();
    }
  });

  it('completed instance has lockedBy cleared after execution', async () => {
    const def = makeDefinition({ jobType: 'lock-clear-test' });
    await scheduler.registerJob(omitTimestamps(def), makeSuccessHandler());

    await scheduler.start();
    try {
      const instanceId = await scheduler.triggerJob(def.id);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      const inst = await store.getInstance(instanceId);
      expect(inst!.lockedBy).toBeNull();
      expect(inst!.lockedAt).toBeNull();
    } finally {
      await scheduler.stop();
    }
  });

  it('execution emits execute_start and execute_complete audit entries', async () => {
    const def = makeDefinition({ jobType: 'audit-exec' });
    await scheduler.registerJob(omitTimestamps(def), makeSuccessHandler());

    await scheduler.start();
    try {
      await scheduler.triggerJob(def.id);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      const startEntries = auditCalls.filter((c) => c.action === 'execute_start');
      const completeEntries = auditCalls.filter((c) => c.action === 'execute_complete');

      expect(startEntries.length).toBeGreaterThanOrEqual(1);
      expect(completeEntries.length).toBeGreaterThanOrEqual(1);
      expect(completeEntries[0]!.details['success']).toBe(true);
    } finally {
      await scheduler.stop();
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 15. JobScheduler — job execution: failing handler (retry + DLQ)
// ─────────────────────────────────────────────────────────────────

describe('JobScheduler — failing handler and retry behaviour', () => {
  let store: InMemorySchedulerStore;
  let auditCalls: AuditCall[];
  let alerts: Array<Parameters<SchedulerAlertCallback>[0]>;
  let scheduler: JobScheduler;

  beforeEach(() => {
    store = new InMemorySchedulerStore();
    defCounter = 0;
    instCounter = 0;
    const audit = makeAuditLogger();
    const alerting = makeAlertCallback();
    auditCalls = audit.calls;
    alerts = alerting.alerts;
    scheduler = new JobScheduler(
      store,
      audit.logger,
      alerting.callback,
      { pollIntervalMs: 60_000, instanceId: 'retry-test' },
    );
  });

  it('first failure marks instance as retrying and increments retryCount', async () => {
    const retryPolicy: RetryPolicy = {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 10_000,
    };
    const def = makeDefinition({
      jobType: 'fail-job',
      retryPolicy,
    });
    await scheduler.registerJob(omitTimestamps(def), makeFailureHandler('DB timeout'));

    await scheduler.start();
    try {
      const instanceId = await scheduler.triggerJob(def.id);
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      const inst = await store.getInstance(instanceId);
      expect(inst!.status).toBe('retrying');
      expect(inst!.retryCount).toBe(1);
      expect(inst!.error).toBe('DB timeout');
      expect(inst!.nextRetryAt).not.toBeNull();
    } finally {
      await scheduler.stop();
    }
  });

  it('failure emits execute_retry_scheduled audit entry', async () => {
    const retryPolicy: RetryPolicy = {
      maxRetries: 2,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
    };
    const def = makeDefinition({ jobType: 'retry-audit', retryPolicy });
    await scheduler.registerJob(omitTimestamps(def), makeFailureHandler('timeout'));

    await scheduler.start();
    try {
      await scheduler.triggerJob(def.id);
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      const retryEntries = auditCalls.filter((c) => c.action === 'execute_retry_scheduled');
      expect(retryEntries.length).toBeGreaterThanOrEqual(1);
      expect(retryEntries[0]!.details['error']).toBe('timeout');
      expect(retryEntries[0]!.details['retryCount']).toBe(1);
    } finally {
      await scheduler.stop();
    }
  });

  it('instance is dead-lettered after exhausting all retries', async () => {
    const retryPolicy: RetryPolicy = {
      maxRetries: 0, // immediate DLQ on first failure
      baseDelayMs: 0,
      maxDelayMs: 0,
    };
    const def = makeDefinition({ jobType: 'dlq-job', retryPolicy });
    await scheduler.registerJob(omitTimestamps(def), makeFailureHandler('permanent error'));

    await scheduler.start();
    try {
      const instanceId = await scheduler.triggerJob(def.id);
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      const inst = await store.getInstance(instanceId);
      expect(inst!.status).toBe('failed');
      expect(inst!.error).toBe('permanent error');

      const dlq = await store.listDeadLetter();
      expect(dlq.length).toBe(1);
      expect(dlq[0]!.jobInstanceId).toBe(instanceId);
      expect(dlq[0]!.error).toBe('permanent error');
    } finally {
      await scheduler.stop();
    }
  });

  it('dead-lettering emits dead_lettered audit entry', async () => {
    const retryPolicy: RetryPolicy = { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 };
    const def = makeDefinition({ jobType: 'dlq-audit', retryPolicy });
    await scheduler.registerJob(omitTimestamps(def), makeFailureHandler('critical failure'));

    await scheduler.start();
    try {
      await scheduler.triggerJob(def.id);
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      const dlqEntries = auditCalls.filter((c) => c.action === 'dead_lettered');
      expect(dlqEntries.length).toBeGreaterThanOrEqual(1);
      expect(dlqEntries[0]!.details['error']).toBe('critical failure');
    } finally {
      await scheduler.stop();
    }
  });

  it('critical priority failure triggers a p1 alert', async () => {
    const retryPolicy: RetryPolicy = { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 };
    const def = makeDefinition({
      jobType: 'critical-failure',
      priority: 'critical',
      retryPolicy,
    });
    await scheduler.registerJob(omitTimestamps(def), makeFailureHandler('p1 error'));

    await scheduler.start();
    try {
      await scheduler.triggerJob(def.id);
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0]!.severity).toBe('p1');
      expect(alerts[0]!.jobType).toBe('critical-failure');
      expect(alerts[0]!.error).toBe('p1 error');
    } finally {
      await scheduler.stop();
    }
  });

  it('high priority failure triggers a p2 alert', async () => {
    const retryPolicy: RetryPolicy = { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 };
    const def = makeDefinition({
      jobType: 'high-failure',
      priority: 'high',
      retryPolicy,
    });
    await scheduler.registerJob(omitTimestamps(def), makeFailureHandler('high error'));

    await scheduler.start();
    try {
      await scheduler.triggerJob(def.id);
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      const highAlerts = alerts.filter((a) => a.severity === 'p2');
      expect(highAlerts.length).toBeGreaterThanOrEqual(1);
    } finally {
      await scheduler.stop();
    }
  });

  it('normal priority failure triggers a p3 alert', async () => {
    const retryPolicy: RetryPolicy = { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 };
    const def = makeDefinition({
      jobType: 'normal-failure',
      priority: 'normal',
      retryPolicy,
    });
    await scheduler.registerJob(omitTimestamps(def), makeFailureHandler('normal error'));

    await scheduler.start();
    try {
      await scheduler.triggerJob(def.id);
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      const normalAlerts = alerts.filter((a) => a.severity === 'p3');
      expect(normalAlerts.length).toBeGreaterThanOrEqual(1);
    } finally {
      await scheduler.stop();
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 16. JobScheduler — retryDeadLetter
// ─────────────────────────────────────────────────────────────────

describe('JobScheduler — retryDeadLetter', () => {
  let store: InMemorySchedulerStore;
  let auditCalls: AuditCall[];
  let scheduler: JobScheduler;

  beforeEach(() => {
    store = new InMemorySchedulerStore();
    defCounter = 0;
    instCounter = 0;
    const audit = makeAuditLogger();
    const alerting = makeAlertCallback();
    auditCalls = audit.calls;
    scheduler = new JobScheduler(
      store,
      audit.logger,
      alerting.callback,
      { pollIntervalMs: 60_000, instanceId: 'dlq-retry-test' },
    );
  });

  it('retryDeadLetter creates a new pending instance and removes the DLQ entry', async () => {
    const def = makeDefinition({ jobType: 'dlq-retry' });
    await store.saveDefinition(def);

    const dlEntry: DeadLetterEntry = {
      id: 'dl-entry-1',
      jobInstanceId: 'inst-old-1',
      definitionId: def.id,
      error: 'original failure',
      payload: { retryMe: true },
      failedAt: new Date(),
    };
    await store.addToDeadLetter(dlEntry);

    const newInstanceId = await scheduler.retryDeadLetter('dl-entry-1');

    const newInst = await store.getInstance(newInstanceId);
    expect(newInst).not.toBeNull();
    expect(newInst!.status).toBe('pending');
    expect(newInst!.payload).toEqual({ retryMe: true });
    expect(newInst!.retryCount).toBe(0);

    const dlqAfter = await store.listDeadLetter();
    expect(dlqAfter).toHaveLength(0);
  });

  it('retryDeadLetter throws for unknown DLQ entry', async () => {
    await expect(scheduler.retryDeadLetter('ghost-dl')).rejects.toThrow('not found');
  });

  it('retryDeadLetter emits audit entry with action retry_dead_letter', async () => {
    const def = makeDefinition({ jobType: 'dlq-audit-retry' });
    await store.saveDefinition(def);

    const dlEntry: DeadLetterEntry = {
      id: 'dl-audit-1',
      jobInstanceId: 'inst-old-2',
      definitionId: def.id,
      error: 'some error',
      payload: {},
      failedAt: new Date(),
    };
    await store.addToDeadLetter(dlEntry);

    await scheduler.retryDeadLetter('dl-audit-1');

    const retryEntries = auditCalls.filter((c) => c.action === 'retry_dead_letter');
    expect(retryEntries.length).toBe(1);
    expect(retryEntries[0]!.details['originalDeadLetterId']).toBe('dl-audit-1');
    expect(retryEntries[0]!.details['originalInstanceId']).toBe('inst-old-2');
  });
});

// ─────────────────────────────────────────────────────────────────
// 17. Constants verification
// ─────────────────────────────────────────────────────────────────

describe('exported constants', () => {
  it('JOB_STATUSES contains all 6 expected statuses', () => {
    const expected: JobStatus[] = ['pending', 'running', 'completed', 'failed', 'retrying', 'cancelled'];
    expect(JOB_STATUSES).toHaveLength(6);
    for (const s of expected) {
      expect(JOB_STATUSES).toContain(s);
    }
  });

  it('JOB_PRIORITIES contains all 4 expected priorities', () => {
    const expected: JobPriority[] = ['critical', 'high', 'normal', 'low'];
    expect(JOB_PRIORITIES).toHaveLength(4);
    for (const p of expected) {
      expect(JOB_PRIORITIES).toContain(p);
    }
  });

  it('DEFAULT_RETRY_POLICY has correct values', () => {
    expect(DEFAULT_RETRY_POLICY.maxRetries).toBe(3);
    expect(DEFAULT_RETRY_POLICY.baseDelayMs).toBe(30_000);
    expect(DEFAULT_RETRY_POLICY.maxDelayMs).toBe(3_600_000);
  });

  it('DEFAULT_SCHEDULER_CONFIG has correct values', () => {
    expect(DEFAULT_SCHEDULER_CONFIG.pollIntervalMs).toBe(15_000);
    expect(DEFAULT_SCHEDULER_CONFIG.maxConcurrentJobs).toBe(10);
    expect(DEFAULT_SCHEDULER_CONFIG.instanceId).toBe('scheduler-default');
  });
});

// ─────────────────────────────────────────────────────────────────
// Utility — strips timestamps for registerJob calls
// ─────────────────────────────────────────────────────────────────

function omitTimestamps(
  def: JobDefinition,
): Omit<JobDefinition, 'createdAt' | 'updatedAt'> {
  const { createdAt: _c, updatedAt: _u, ...rest } = def;
  return rest;
}
