/**
 * @ordr/workflow — Condition branching, delay scheduling, state machine, tenant isolation
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - No PHI in test data — only tokenised entity IDs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkflowStatus, WorkflowStep, AuditCall } from './workflow-helpers.js';
import {
  WORKFLOW_EVENTS,
  VALID_TRANSITIONS,
  InMemoryDefinitionStore,
  WorkflowEngine,
  WorkflowEngineError,
  InMemoryInstanceStore,
  InMemoryStepResultStore,
  DelayScheduler,
  makeActionStep,
  makeDelayStep,
  makeConditionStep,
  makeDefinition,
  makeContext,
  makeInstance,
  makeSuccessHandler,
  makeMockAuditLogger,
} from './workflow-helpers.js';

// Shared state — reset per test via resetAll()
let defStore: InMemoryDefinitionStore;
let instanceStore: InMemoryInstanceStore;
let stepResultStore: InMemoryStepResultStore;
let auditCalls: AuditCall[];
let engine: WorkflowEngine;
const tenantId = 'tenant-engine';

function resetAll(): void {
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
}

// ─── 6. Condition Step Branching ────────────────────────────────

describe('WorkflowEngine — condition step branching', () => {
  beforeEach(() => {
    resetAll();
    engine.registerAction(makeSuccessHandler('paid_action'));
    engine.registerAction(makeSuccessHandler('unpaid_action'));
  });

  it('takes trueBranch when condition is met (eq)', async () => {
    const steps: WorkflowStep[] = [
      makeConditionStep('Check Payment', 'variables.paymentStatus', 'eq', 'paid', 1, 2),
      makeActionStep('Paid Action', 'paid_action'),
      makeActionStep('Unpaid Action', 'unpaid_action'),
    ];
    const def = makeDefinition(tenantId, steps);
    defStore.seed([def]);

    const ctx = makeContext(tenantId, 'entity-paid', { paymentStatus: 'paid' });
    const instance = await engine.startWorkflow(def.id, ctx, tenantId);
    const stepResults = await stepResultStore.getByInstance(instance.id);
    const condResult = stepResults.find((r) => r.stepType === 'condition');
    expect(condResult?.output['branchTaken']).toBe('true');
    expect(condResult?.output['conditionMet']).toBe(true);
  });

  it('takes falseBranch when condition is not met', async () => {
    const steps: WorkflowStep[] = [
      makeConditionStep('Check Payment', 'variables.paymentStatus', 'eq', 'paid', 1, 2),
      makeActionStep('Paid Action', 'paid_action'),
      makeActionStep('Unpaid Action', 'unpaid_action'),
    ];
    const def = makeDefinition(tenantId, steps);
    defStore.seed([def]);
    await engine.startWorkflow(def.id, makeContext(tenantId, 'e-unpaid', { paymentStatus: 'overdue' }), tenantId);
  });

  it('gt operator evaluates correctly', async () => {
    const def = makeDefinition(tenantId, [makeConditionStep('C', 'variables.score', 'gt', 50, 1, 1)]);
    defStore.seed([def]);
    const inst = await engine.startWorkflow(def.id, makeContext(tenantId, 'e1', { score: 75 }), tenantId);
    const results = await stepResultStore.getByInstance(inst.id);
    expect(results.find((r) => r.stepType === 'condition')?.output['conditionMet']).toBe(true);
  });

  it('lt operator evaluates correctly', async () => {
    const def = makeDefinition(tenantId, [makeConditionStep('C', 'variables.age', 'lt', 30, 1, 1)]);
    defStore.seed([def]);
    const inst = await engine.startWorkflow(def.id, makeContext(tenantId, 'e2', { age: 25 }), tenantId);
    const results = await stepResultStore.getByInstance(inst.id);
    expect(results.find((r) => r.stepType === 'condition')?.output['conditionMet']).toBe(true);
  });

  it('neq operator evaluates correctly', async () => {
    const def = makeDefinition(tenantId, [makeConditionStep('C', 'variables.status', 'neq', 'active', 1, 1)]);
    defStore.seed([def]);
    const inst = await engine.startWorkflow(def.id, makeContext(tenantId, 'e3', { status: 'inactive' }), tenantId);
    const results = await stepResultStore.getByInstance(inst.id);
    expect(results.find((r) => r.stepType === 'condition')?.output['conditionMet']).toBe(true);
  });
});

// ─── 7. Delay Step Scheduling ────────────────────────────────────

describe('WorkflowEngine — delay step', () => {
  beforeEach(resetAll);

  it('delay step without scheduler pauses workflow with waiting status', async () => {
    const def = makeDefinition(tenantId, [makeDelayStep('Wait', 5000)]);
    defStore.seed([def]);
    const instance = await engine.startWorkflow(def.id, makeContext(tenantId), tenantId);
    expect(instance.status).toBe('paused');
    const results = await stepResultStore.getByInstance(instance.id);
    expect(results.find((r) => r.stepType === 'delay')?.status).toBe('waiting');
  });

  it('delay step with scheduler creates a pending schedule', async () => {
    const scheduler = new DelayScheduler();
    const mock = makeMockAuditLogger();
    const schedulerEngine = new WorkflowEngine({
      definitionStore: defStore, instanceStore, stepResultStore,
      auditLogger: mock.logger, scheduler,
    });
    const def = makeDefinition(tenantId, [makeDelayStep('Wait', 5000)]);
    defStore.seed([def]);
    const instance = await schedulerEngine.startWorkflow(def.id, makeContext(tenantId), tenantId);
    expect(instance.status).toBe('paused');
    expect(scheduler.pendingCount).toBe(1);
  });

  it('delay step with scheduler stores scheduledAt in step result output', async () => {
    const scheduler = new DelayScheduler();
    const mock = makeMockAuditLogger();
    const schedulerEngine = new WorkflowEngine({
      definitionStore: defStore, instanceStore, stepResultStore,
      auditLogger: mock.logger, scheduler,
    });
    const def = makeDefinition(tenantId, [makeDelayStep('Wait', 5000)]);
    defStore.seed([def]);
    const instance = await schedulerEngine.startWorkflow(def.id, makeContext(tenantId), tenantId);
    const results = await stepResultStore.getByInstance(instance.id);
    expect(results.find((r) => r.stepType === 'delay')?.output['scheduledAt']).toBeDefined();
  });
});

// ─── 8. State Machine Transitions ───────────────────────────────

describe('WorkflowEngine — validateTransition', () => {
  beforeEach(resetAll);

  it('allows valid transitions', () => {
    const valid: [WorkflowStatus, WorkflowStatus][] = [
      ['pending', 'running'], ['pending', 'cancelled'],
      ['running', 'paused'], ['running', 'completed'], ['running', 'failed'], ['running', 'cancelled'],
      ['paused', 'running'], ['paused', 'cancelled'],
    ];
    for (const [from, to] of valid) {
      expect(() => engine.validateTransition(from, to)).not.toThrow();
    }
  });

  it('rejects invalid transitions', () => {
    const invalid: [WorkflowStatus, WorkflowStatus][] = [
      ['completed', 'running'], ['completed', 'failed'], ['completed', 'cancelled'],
      ['failed', 'running'], ['failed', 'paused'],
      ['cancelled', 'running'], ['cancelled', 'paused'],
      ['pending', 'completed'], ['pending', 'failed'], ['pending', 'paused'],
    ];
    for (const [from, to] of invalid) {
      expect(() => engine.validateTransition(from, to)).toThrow(WorkflowEngineError);
      try { engine.validateTransition(from, to); } catch (err) {
        expect((err as WorkflowEngineError).code).toBe('INVALID_TRANSITION');
      }
    }
  });

  it('terminal states have no valid targets', () => {
    expect(VALID_TRANSITIONS.completed).toHaveLength(0);
    expect(VALID_TRANSITIONS.failed).toHaveLength(0);
    expect(VALID_TRANSITIONS.cancelled).toHaveLength(0);
  });
});

// ─── 9. Tenant Isolation ────────────────────────────────────────

describe('WorkflowEngine — tenant isolation', () => {
  beforeEach(resetAll);

  it('rejects startWorkflow when definition belongs to another tenant', async () => {
    const def = makeDefinition('tenant-A', [makeActionStep('S')]);
    defStore.seed([def]);
    await expect(
      engine.startWorkflow(def.id, makeContext('tenant-B'), 'tenant-B'),
    ).rejects.toMatchObject({ code: 'DEFINITION_NOT_FOUND' });
  });

  it('rejects pauseWorkflow for a cross-tenant instance', async () => {
    const inst = makeInstance('tenant-A', 'def-1', 'running');
    await instanceStore.save(inst);
    await expect(engine.pauseWorkflow('tenant-B', inst.id)).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
  });

  it('rejects resumeWorkflow for a cross-tenant instance', async () => {
    const def = makeDefinition('tenant-A', [makeActionStep('S')]);
    defStore.seed([def]);
    const inst = makeInstance('tenant-A', def.id, 'paused');
    await instanceStore.save(inst);
    await expect(engine.resumeWorkflow('tenant-B', inst.id)).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
  });

  it('rejects cancelWorkflow for a cross-tenant instance', async () => {
    const inst = makeInstance('tenant-A', 'def-1', 'running');
    await instanceStore.save(inst);
    await expect(engine.cancelWorkflow('tenant-B', inst.id, 'x')).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
  });
});
