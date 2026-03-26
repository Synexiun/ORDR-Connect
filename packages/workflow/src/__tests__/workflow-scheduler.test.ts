/**
 * @ordr/workflow — In-memory stores, delay scheduler, business hours, cron, triggers, constants
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - No PHI in test data — only tokenised entity IDs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  StepResult,
  WorkflowInstance,
  TriggerConfig,
  AuditCall,
  TriggerEvent,
  BusinessHoursConfig,
} from './workflow-helpers.js';
import {
  VALID_TRANSITIONS,
  WORKFLOW_EVENTS,
  DEFAULT_RETRY_CONFIG,
  InMemoryDefinitionStore,
  WorkflowEngine,
  InMemoryInstanceStore,
  InMemoryStepResultStore,
  DelayScheduler,
  DEFAULT_BUSINESS_HOURS,
  WorkflowTrigger,
  matchesCron,
  makeActionStep,
  makeDefinition,
  makeContext,
  makeInstance,
  makeSuccessHandler,
  makeSchedule,
  makeMockAuditLogger,
} from './workflow-helpers.js';

// ─── 10. InMemoryInstanceStore CRUD ─────────────────────────────

describe('InMemoryInstanceStore', () => {
  let store: InMemoryInstanceStore;

  beforeEach(() => {
    store = new InMemoryInstanceStore();
  });

  it('saves and retrieves an instance by ID', async () => {
    const inst = makeInstance('tenant-1', 'def-1', 'running');
    await store.save(inst);
    const fetched = await store.getById('tenant-1', inst.id);
    expect(fetched?.id).toBe(inst.id);
  });

  it('returns undefined for missing instance', async () => {
    const result = await store.getById('tenant-1', 'nonexistent');
    expect(result).toBeUndefined();
  });

  it('enforces tenant isolation on getById', async () => {
    const inst = makeInstance('tenant-A', 'def-1', 'running');
    await store.save(inst);
    const result = await store.getById('tenant-B', inst.id);
    expect(result).toBeUndefined();
  });

  it('lists only instances for the requesting tenant', async () => {
    const instA = makeInstance('tenant-A', 'def-1', 'running');
    const instB = makeInstance('tenant-B', 'def-1', 'running');
    await store.save(instA);
    await store.save(instB);

    const listA = await store.list('tenant-A');
    expect(listA).toHaveLength(1);
    expect(listA[0]?.id).toBe(instA.id);
  });

  it('filters by status', async () => {
    const running = makeInstance('tenant-1', 'def-1', 'running');
    const completed = makeInstance('tenant-1', 'def-1', 'completed');
    await store.save(running);
    await store.save(completed);

    const runningList = await store.list('tenant-1', { status: 'running' });
    expect(runningList).toHaveLength(1);
    expect(runningList[0]?.status).toBe('running');
  });

  it('filters by definitionId', async () => {
    const inst1 = makeInstance('tenant-1', 'def-aaa', 'running');
    const inst2 = makeInstance('tenant-1', 'def-bbb', 'running');
    await store.save(inst1);
    await store.save(inst2);

    const result = await store.list('tenant-1', { definitionId: 'def-aaa' });
    expect(result).toHaveLength(1);
    expect(result[0]?.definitionId).toBe('def-aaa');
  });

  it('findByEntity returns active instance for matching entity', async () => {
    const inst = makeInstance('tenant-1', 'def-1', 'running');
    const withEntity: WorkflowInstance = { ...inst, entityType: 'customer', entityId: 'cust-99' };
    await store.save(withEntity);

    const found = await store.findByEntity('tenant-1', 'customer', 'cust-99', 'def-1');
    expect(found?.id).toBe(inst.id);
  });

  it('findByEntity returns undefined for completed instances (deduplication allows restart)', async () => {
    const inst = makeInstance('tenant-1', 'def-1', 'completed');
    const withEntity: WorkflowInstance = { ...inst, entityType: 'customer', entityId: 'cust-88' };
    await store.save(withEntity);

    const found = await store.findByEntity('tenant-1', 'customer', 'cust-88', 'def-1');
    expect(found).toBeUndefined();
  });

  it('clear removes all instances', async () => {
    await store.save(makeInstance('tenant-1', 'def-1', 'running'));
    store.clear();
    const list = await store.list('tenant-1');
    expect(list).toHaveLength(0);
  });

  it('save overwrites an existing instance (upsert behaviour)', async () => {
    const inst = makeInstance('tenant-1', 'def-1', 'running');
    await store.save(inst);
    const updated: WorkflowInstance = { ...inst, status: 'paused' };
    await store.save(updated);

    const fetched = await store.getById('tenant-1', inst.id);
    expect(fetched?.status).toBe('paused');
  });
});

// ─── 11. InMemoryStepResultStore ────────────────────────────────

describe('InMemoryStepResultStore', () => {
  let store: InMemoryStepResultStore;

  beforeEach(() => {
    store = new InMemoryStepResultStore();
  });

  it('saves and retrieves step results by instance ID', async () => {
    const result: StepResult = {
      id: 'sr-1',
      instanceId: 'inst-1',
      stepIndex: 0,
      stepType: 'action',
      status: 'completed',
      input: {},
      output: { sent: true },
      startedAt: new Date(),
      completedAt: new Date(),
      error: null,
      retryCount: 0,
    };
    await store.save(result);
    const fetched = await store.getByInstance('inst-1');
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.id).toBe('sr-1');
  });

  it('returns empty array for unknown instance', async () => {
    const results = await store.getByInstance('nonexistent');
    expect(results).toHaveLength(0);
  });

  it('accumulates multiple step results for the same instance', async () => {
    for (let i = 0; i < 3; i++) {
      await store.save({
        id: `sr-${String(i)}`,
        instanceId: 'inst-multi',
        stepIndex: i,
        stepType: 'action',
        status: 'completed',
        input: {},
        output: {},
        startedAt: new Date(),
        completedAt: new Date(),
        error: null,
        retryCount: 0,
      });
    }
    const results = await store.getByInstance('inst-multi');
    expect(results).toHaveLength(3);
  });

  it('clear removes all results', async () => {
    await store.save({
      id: 'sr-clear',
      instanceId: 'inst-1',
      stepIndex: 0,
      stepType: 'action',
      status: 'completed',
      input: {},
      output: {},
      startedAt: new Date(),
      completedAt: new Date(),
      error: null,
      retryCount: 0,
    });
    store.clear();
    const results = await store.getByInstance('inst-1');
    expect(results).toHaveLength(0);
  });
});

// ─── 12. DelayScheduler: schedule / getDueSchedules / markExecuted ──

describe('DelayScheduler — core operations', () => {
  let scheduler: DelayScheduler;

  beforeEach(() => {
    scheduler = new DelayScheduler();
  });

  it('schedule stores a pending schedule', () => {
    const past = new Date(Date.now() - 5000);
    scheduler.schedule(makeSchedule('sched-1', 'inst-1', past));
    expect(scheduler.pendingCount).toBe(1);
  });

  it('getDueSchedules returns schedules whose scheduledAt <= now', () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 60_000);
    scheduler.schedule(makeSchedule('sched-past', 'inst-1', past));
    scheduler.schedule(makeSchedule('sched-future', 'inst-2', future));

    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(1);
    expect(due[0]?.id).toBe('sched-past');
  });

  it('getDueSchedules ignores already executed schedules', () => {
    const past = new Date(Date.now() - 1000);
    scheduler.schedule(makeSchedule('sched-exec', 'inst-1', past, 'executed'));
    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(0);
  });

  it('getDueSchedules ignores cancelled schedules', () => {
    const past = new Date(Date.now() - 1000);
    scheduler.schedule(makeSchedule('sched-canc', 'inst-1', past, 'cancelled'));
    const due = scheduler.getDueSchedules(new Date());
    expect(due).toHaveLength(0);
  });

  it('markExecuted sets status to executed and sets executedAt', async () => {
    const past = new Date(Date.now() - 1000);
    scheduler.schedule(makeSchedule('sched-mark', 'inst-1', past));
    await scheduler.markExecuted('sched-mark');
    const sched = scheduler.getById('sched-mark');
    expect(sched?.status).toBe('executed');
    expect(sched?.executedAt).not.toBeNull();
  });

  it('cancelSchedule sets status to cancelled', async () => {
    const future = new Date(Date.now() + 60_000);
    scheduler.schedule(makeSchedule('sched-cancel', 'inst-1', future));
    await scheduler.cancelSchedule('sched-cancel');
    const sched = scheduler.getById('sched-cancel');
    expect(sched?.status).toBe('cancelled');
  });

  it('cancelByInstance cancels all pending schedules for an instance', async () => {
    const future = new Date(Date.now() + 60_000);
    scheduler.schedule(makeSchedule('s1', 'inst-target', future));
    scheduler.schedule(makeSchedule('s2', 'inst-target', future));
    scheduler.schedule(makeSchedule('s3', 'inst-other', future));

    const count = await scheduler.cancelByInstance('inst-target');
    expect(count).toBe(2);
    expect(scheduler.getById('s1')?.status).toBe('cancelled');
    expect(scheduler.getById('s2')?.status).toBe('cancelled');
    expect(scheduler.getById('s3')?.status).toBe('pending');
  });

  it('getByInstance returns all schedules for an instance', () => {
    const future = new Date(Date.now() + 60_000);
    scheduler.schedule(makeSchedule('s1', 'inst-q', future));
    scheduler.schedule(makeSchedule('s2', 'inst-q', future));
    scheduler.schedule(makeSchedule('s3', 'inst-other', future));

    const results = scheduler.getByInstance('inst-q');
    expect(results).toHaveLength(2);
  });

  it('poll marks due schedules executed and returns instanceId/stepIndex', async () => {
    const past = new Date(Date.now() - 1000);
    scheduler.schedule({ ...makeSchedule('sp1', 'inst-poll', past), stepIndex: 3 });

    const toResume = await scheduler.poll(new Date());
    expect(toResume).toHaveLength(1);
    expect(toResume[0]?.instanceId).toBe('inst-poll');
    expect(toResume[0]?.stepIndex).toBe(3);
    expect(scheduler.getById('sp1')?.status).toBe('executed');
  });

  it('pendingCount decrements after markExecuted', async () => {
    const past = new Date(Date.now() - 1000);
    scheduler.schedule(makeSchedule('sched-dec', 'inst-1', past));
    expect(scheduler.pendingCount).toBe(1);
    await scheduler.markExecuted('sched-dec');
    expect(scheduler.pendingCount).toBe(0);
  });

  it('clear removes all schedules', () => {
    scheduler.schedule(makeSchedule('s1', 'inst-1', new Date()));
    scheduler.clear();
    expect(scheduler.pendingCount).toBe(0);
    expect(scheduler.getById('s1')).toBeUndefined();
  });

  it('calculateResumeTime without businessHoursOnly is now + durationMs', () => {
    const before = Date.now();
    const result = scheduler.calculateResumeTime(60_000, false);
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(result.getTime()).toBeLessThanOrEqual(after + 60_000);
  });
});

// ─── 13. DelayScheduler — Business Hours ────────────────────────

describe('DelayScheduler — business hours', () => {
  const businessHours: BusinessHoursConfig = {
    startHour: 9,
    endHour: 17,
    workDays: [1, 2, 3, 4, 5],
    holidays: ['2025-12-25'],
  };

  let scheduler: DelayScheduler;

  beforeEach(() => {
    scheduler = new DelayScheduler(businessHours);
  });

  it('isBusinessHours returns true for a weekday within hours', () => {
    const date = new Date('2025-01-06T10:00:00');
    expect(scheduler.isBusinessHours(date)).toBe(true);
  });

  it('isBusinessHours returns false for Saturday', () => {
    const saturday = new Date('2025-01-04T10:00:00');
    expect(scheduler.isBusinessHours(saturday)).toBe(false);
  });

  it('isBusinessHours returns false for Sunday', () => {
    const sunday = new Date('2025-01-05T10:00:00');
    expect(scheduler.isBusinessHours(sunday)).toBe(false);
  });

  it('isBusinessHours returns false before start hour', () => {
    const earlyMonday = new Date('2025-01-06T07:00:00');
    expect(scheduler.isBusinessHours(earlyMonday)).toBe(false);
  });

  it('isBusinessHours returns false at or after end hour', () => {
    const lateMonday = new Date('2025-01-06T17:00:00');
    expect(scheduler.isBusinessHours(lateMonday)).toBe(false);
  });

  it('isBusinessHours returns false on a configured holiday', () => {
    const holiday = new Date('2025-12-25T10:00:00');
    expect(scheduler.isBusinessHours(holiday)).toBe(false);
  });

  it('adjustToBusinessHours advances from Saturday to Monday at start hour', () => {
    const saturday = new Date('2025-01-04T10:00:00');
    const adjusted = scheduler.adjustToBusinessHours(saturday);
    expect(adjusted.getDay()).toBe(1);
    expect(adjusted.getHours()).toBe(9);
    expect(adjusted.getMinutes()).toBe(0);
  });

  it('adjustToBusinessHours advances from Sunday to Monday at start hour', () => {
    const sunday = new Date('2025-01-05T10:00:00');
    const adjusted = scheduler.adjustToBusinessHours(sunday);
    expect(adjusted.getDay()).toBe(1);
    expect(adjusted.getHours()).toBe(9);
  });

  it('adjustToBusinessHours advances from before-hours to start hour same day', () => {
    const earlyMonday = new Date('2025-01-06T06:00:00');
    const adjusted = scheduler.adjustToBusinessHours(earlyMonday);
    expect(adjusted.getDay()).toBe(1);
    expect(adjusted.getHours()).toBe(9);
  });

  it('adjustToBusinessHours advances from after-hours to next business day', () => {
    const lateMonday = new Date('2025-01-06T18:00:00');
    const adjusted = scheduler.adjustToBusinessHours(lateMonday);
    expect(adjusted.getDay()).toBe(2);
    expect(adjusted.getHours()).toBe(9);
  });

  it('adjustToBusinessHours skips the holiday and lands on next business day', () => {
    const holidayDate = new Date('2025-12-25T10:00:00');
    const adjusted = scheduler.adjustToBusinessHours(holidayDate);
    const adjustedStr = adjusted.toISOString().slice(0, 10);
    expect(adjustedStr).toBe('2025-12-26');
    expect(adjusted.getHours()).toBe(9);
  });

  it('adjustToBusinessHours returns unchanged date when already within business hours', () => {
    const midMonday = new Date('2025-01-06T14:30:00');
    const adjusted = scheduler.adjustToBusinessHours(midMonday);
    expect(adjusted.getDay()).toBe(1);
    expect(adjusted.getHours()).toBe(14);
    expect(adjusted.getMinutes()).toBe(30);
  });

  it('DEFAULT_BUSINESS_HOURS has startHour 8 and endHour 21', () => {
    expect(DEFAULT_BUSINESS_HOURS.startHour).toBe(8);
    expect(DEFAULT_BUSINESS_HOURS.endHour).toBe(21);
    expect(DEFAULT_BUSINESS_HOURS.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(DEFAULT_BUSINESS_HOURS.holidays).toHaveLength(0);
  });
});

// ─── 14. matchesCron ────────────────────────────────────────────

describe('matchesCron', () => {
  it('matches wildcard * for every field', () => {
    const date = new Date('2025-06-15T14:30:00');
    expect(matchesCron('* * * * *', date)).toBe(true);
  });

  it('matches a specific minute', () => {
    const date = new Date('2025-06-15T14:30:00');
    expect(matchesCron('30 * * * *', date)).toBe(true);
    expect(matchesCron('15 * * * *', date)).toBe(false);
  });

  it('matches a specific hour', () => {
    const date = new Date('2025-06-15T14:30:00');
    expect(matchesCron('* 14 * * *', date)).toBe(true);
    expect(matchesCron('* 9 * * *', date)).toBe(false);
  });

  it('matches a specific day of month', () => {
    const date = new Date('2025-06-15T14:30:00');
    expect(matchesCron('* * 15 * *', date)).toBe(true);
    expect(matchesCron('* * 1 * *', date)).toBe(false);
  });

  it('matches a specific month', () => {
    const date = new Date('2025-06-15T14:30:00');
    expect(matchesCron('* * * 6 *', date)).toBe(true);
    expect(matchesCron('* * * 1 *', date)).toBe(false);
  });

  it('matches a specific day of week (0=Sunday)', () => {
    const sunday = new Date('2025-06-15T14:30:00');
    expect(matchesCron('* * * * 0', sunday)).toBe(true);
    expect(matchesCron('* * * * 1', sunday)).toBe(false);
  });

  it('supports comma-separated values in a field', () => {
    const date = new Date('2025-06-15T14:30:00');
    expect(matchesCron('0,15,30,45 * * * *', date)).toBe(true);
    expect(matchesCron('0,15,45 * * * *', date)).toBe(false);
  });

  it('supports step values */N in minute field', () => {
    const date = new Date('2025-06-15T14:30:00');
    expect(matchesCron('*/5 * * * *', date)).toBe(true);
    expect(matchesCron('*/7 * * * *', date)).toBe(false);
  });

  it('returns false for malformed expression (wrong part count)', () => {
    const date = new Date();
    expect(matchesCron('* * * *', date)).toBe(false);
    expect(matchesCron('* * * * * *', date)).toBe(false);
  });

  it('returns false for empty expression', () => {
    expect(matchesCron('', new Date())).toBe(false);
  });
});

// ─── 15. WorkflowTrigger ─────────────────────────────────────────

describe('WorkflowTrigger', () => {
  let defStore: InMemoryDefinitionStore;
  let instanceStore: InMemoryInstanceStore;
  let stepResultStore: InMemoryStepResultStore;
  let auditCalls: AuditCall[];
  let engine: WorkflowEngine;
  let trigger: WorkflowTrigger;
  const tenantId = 'tenant-trigger';

  beforeEach(() => {
    defStore = new InMemoryDefinitionStore();
    instanceStore = new InMemoryInstanceStore();
    stepResultStore = new InMemoryStepResultStore();
    const mock = makeMockAuditLogger();
    auditCalls = mock.calls;
    engine = new WorkflowEngine({
      definitionStore: defStore,
      instanceStore,
      stepResultStore,
      auditLogger: mock.logger,
    });
    engine.registerAction(makeSuccessHandler('noop'));
    trigger = new WorkflowTrigger({
      engine,
      definitionStore: defStore,
      instanceStore,
      auditLogger: mock.logger,
    });
  });

  it('evaluateEvent starts matching workflows and returns instance IDs', async () => {
    const triggers: readonly TriggerConfig[] = [
      { type: 'event', eventType: 'customer.created', entityType: 'customer' },
    ];
    const def = makeDefinition(tenantId, [makeActionStep('S', 'noop')], {
      triggers,
      id: 'def-trigger-1',
    });
    defStore.seed([def]);

    const event: TriggerEvent = {
      type: 'customer.created',
      tenantId,
      entityType: 'customer',
      entityId: 'cust-trigger-1',
      payload: {},
      correlationId: 'corr-t1',
      userId: 'user-t1',
    };

    const started = await trigger.evaluateEvent(event);
    expect(started).toHaveLength(1);
  });

  it('evaluateEvent does not start workflow for non-matching event type', async () => {
    const triggers: readonly TriggerConfig[] = [
      { type: 'event', eventType: 'order.created' },
    ];
    const def = makeDefinition(tenantId, [makeActionStep('S', 'noop')], {
      triggers,
      id: 'def-trigger-2',
    });
    defStore.seed([def]);

    const event: TriggerEvent = {
      type: 'customer.updated',
      tenantId,
      entityType: 'customer',
      entityId: 'cust-2',
      payload: {},
      correlationId: 'corr-t2',
      userId: 'user-t2',
    };

    const started = await trigger.evaluateEvent(event);
    expect(started).toHaveLength(0);
  });

  it('evaluateEvent deduplicates: skips if active instance already exists', async () => {
    const triggers: readonly TriggerConfig[] = [
      { type: 'event', eventType: 'customer.created' },
    ];
    const def = makeDefinition(tenantId, [makeActionStep('S', 'noop')], {
      triggers,
      id: 'def-trigger-dedup',
    });
    defStore.seed([def]);

    const existingInst: WorkflowInstance = {
      ...makeInstance(tenantId, def.id, 'running'),
      entityType: 'customer',
      entityId: 'cust-dedup',
    };
    await instanceStore.save(existingInst);

    const event: TriggerEvent = {
      type: 'customer.created',
      tenantId,
      entityType: 'customer',
      entityId: 'cust-dedup',
      payload: {},
      correlationId: 'corr-dedup',
      userId: 'user-dedup',
    };

    const started = await trigger.evaluateEvent(event);
    expect(started).toHaveLength(0);

    const dedupEvent = auditCalls.find((c) => c.eventType === 'workflow.trigger_deduplicated');
    expect(dedupEvent).toBeDefined();
  });

  it('evaluateEvent skips inactive definitions', async () => {
    const triggers: readonly TriggerConfig[] = [
      { type: 'event', eventType: 'customer.created' },
    ];
    const def = makeDefinition(tenantId, [makeActionStep('S', 'noop')], {
      triggers,
      id: 'def-trigger-inactive',
      isActive: false,
    });
    defStore.seed([def]);

    const event: TriggerEvent = {
      type: 'customer.created',
      tenantId,
      entityType: 'customer',
      entityId: 'cust-inactive',
      payload: {},
      correlationId: 'corr-i',
      userId: 'user-i',
    };

    const started = await trigger.evaluateEvent(event);
    expect(started).toHaveLength(0);
  });

  it('manualTrigger starts a workflow and returns an instance ID', async () => {
    const def = makeDefinition(tenantId, [makeActionStep('S', 'noop')], {
      id: 'def-manual-1',
    });
    defStore.seed([def]);

    const instanceId = await trigger.manualTrigger(
      tenantId,
      def.id,
      'customer',
      'cust-manual-1',
      { note: 'test' },
      'user-manual',
    );

    expect(typeof instanceId).toBe('string');
    expect(instanceId.length).toBeGreaterThan(0);
  });

  it('manualTrigger throws when duplicate active instance exists', async () => {
    const def = makeDefinition(tenantId, [makeActionStep('S', 'noop')], {
      id: 'def-manual-dedup',
    });
    defStore.seed([def]);

    const existingInst: WorkflowInstance = {
      ...makeInstance(tenantId, def.id, 'running'),
      entityType: 'customer',
      entityId: 'cust-manual-dup',
    };
    await instanceStore.save(existingInst);

    await expect(
      trigger.manualTrigger(
        tenantId,
        def.id,
        'customer',
        'cust-manual-dup',
        {},
        'user-manual',
      ),
    ).rejects.toThrow(/[Dd]uplicate/);
  });

  it('evaluateSchedules returns definition IDs matching cron at the given time', async () => {
    const triggers: readonly TriggerConfig[] = [
      { type: 'schedule', cronExpression: '30 14 * * *' },
    ];
    const def = makeDefinition(tenantId, [makeActionStep('S', 'noop')], {
      triggers,
      id: 'def-sched-1',
    });
    defStore.seed([def]);

    const matchTime = new Date('2025-06-16T14:30:00');
    const triggered = await trigger.evaluateSchedules(tenantId, matchTime);
    expect(triggered).toContain('def-sched-1');
  });

  it('evaluateSchedules does not match at a non-matching time', async () => {
    const triggers: readonly TriggerConfig[] = [
      { type: 'schedule', cronExpression: '30 14 * * *' },
    ];
    const def = makeDefinition(tenantId, [makeActionStep('S', 'noop')], {
      triggers,
      id: 'def-sched-2',
    });
    defStore.seed([def]);

    const noMatch = new Date('2025-06-16T09:00:00');
    const triggered = await trigger.evaluateSchedules(tenantId, noMatch);
    expect(triggered).not.toContain('def-sched-2');
  });
});

// ─── 16. DEFAULT_RETRY_CONFIG constant ──────────────────────────

describe('DEFAULT_RETRY_CONFIG', () => {
  it('has maxRetries of 3', () => {
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
  });

  it('has backoffMs of 1000', () => {
    expect(DEFAULT_RETRY_CONFIG.backoffMs).toBe(1000);
  });

  it('has backoffMultiplier of 2', () => {
    expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
  });
});

// ─── 17. WORKFLOW_EVENTS constants ──────────────────────────────

describe('WORKFLOW_EVENTS', () => {
  it('has all required event type constants', () => {
    expect(WORKFLOW_EVENTS.STARTED).toBe('workflow.started');
    expect(WORKFLOW_EVENTS.STEP_COMPLETED).toBe('workflow.step_completed');
    expect(WORKFLOW_EVENTS.STEP_FAILED).toBe('workflow.step_failed');
    expect(WORKFLOW_EVENTS.PAUSED).toBe('workflow.paused');
    expect(WORKFLOW_EVENTS.RESUMED).toBe('workflow.resumed');
    expect(WORKFLOW_EVENTS.COMPLETED).toBe('workflow.completed');
    expect(WORKFLOW_EVENTS.FAILED).toBe('workflow.failed');
    expect(WORKFLOW_EVENTS.CANCELLED).toBe('workflow.cancelled');
  });
});
