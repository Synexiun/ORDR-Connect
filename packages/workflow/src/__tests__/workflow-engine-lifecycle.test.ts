/**
 * @ordr/workflow — Engine lifecycle, action execution, pause/resume/cancel
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - No PHI in test data — only tokenised entity IDs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkflowStep, WorkflowInstance, AuditCall } from './workflow-helpers.js';
import {
  WORKFLOW_EVENTS,
  InMemoryDefinitionStore,
  WorkflowEngine,
  WorkflowEngineError,
  InMemoryInstanceStore,
  InMemoryStepResultStore,
  makeActionStep,
  makeDelayStep,
  makeHumanReviewStep,
  makeDefinition,
  makeContext,
  makeInstance,
  makeSuccessHandler,
  makeFailingHandler,
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

// ─── 4 & 5. WorkflowEngine Lifecycle + Action Execution ─────────

describe('WorkflowEngine — lifecycle and action steps', () => {
  beforeEach(resetAll);

  it('starts a workflow and returns a completed instance', async () => {
    const def = await defStore.create(tenantId, 'Simple Flow', '', [makeActionStep('Send Email', 'send_email')], []);
    engine.registerAction(makeSuccessHandler('send_email'));
    const instance = await engine.startWorkflow(def.id, makeContext(tenantId), tenantId);
    expect(instance.status).toBe('completed');
    expect(instance.tenantId).toBe(tenantId);
  });

  it('completes a two-action workflow advancing step index', async () => {
    const def = await defStore.create(tenantId, 'Two Steps', '', [
      makeActionStep('Step 1', 'action_a'), makeActionStep('Step 2', 'action_b'),
    ], []);
    engine.registerAction(makeSuccessHandler('action_a'));
    engine.registerAction(makeSuccessHandler('action_b'));
    const instance = await engine.startWorkflow(def.id, makeContext(tenantId), tenantId);
    expect(instance.status).toBe('completed');
    expect(instance.completedAt).not.toBeNull();
  });

  it('emits workflow.started audit event on start', async () => {
    const def = await defStore.create(tenantId, 'Audited', '', [makeActionStep('S', 'noop')], []);
    engine.registerAction(makeSuccessHandler('noop'));
    await engine.startWorkflow(def.id, makeContext(tenantId), tenantId);
    const started = auditCalls.find((c) => c.eventType === WORKFLOW_EVENTS.STARTED);
    expect(started).toBeDefined();
    expect(started?.tenantId).toBe(tenantId);
  });

  it('emits workflow.completed audit event on completion', async () => {
    const def = await defStore.create(tenantId, 'Complete', '', [makeActionStep('S', 'noop')], []);
    engine.registerAction(makeSuccessHandler('noop'));
    await engine.startWorkflow(def.id, makeContext(tenantId), tenantId);
    expect(auditCalls.find((c) => c.eventType === WORKFLOW_EVENTS.COMPLETED)).toBeDefined();
  });

  it('marks instance as failed when action handler returns success: false', async () => {
    const noRetryDef = makeDefinition(tenantId, [{
      name: 'Fail Step', type: 'action',
      config: { type: 'action', actionName: 'fail_action', parameters: {} },
      retryConfig: { maxRetries: 0, backoffMs: 0, backoffMultiplier: 1 },
    }]);
    defStore.seed([noRetryDef]);
    engine.registerAction(makeFailingHandler('fail_action', 'deliberate failure'));
    const instance = await engine.startWorkflow(noRetryDef.id, makeContext(tenantId), tenantId);
    expect(instance.status).toBe('failed');
  });

  it('marks workflow as failed when no handler is registered for action', async () => {
    const def = makeDefinition(tenantId, [{
      name: 'Ghost Action', type: 'action',
      config: { type: 'action', actionName: 'unregistered_action', parameters: {} },
      retryConfig: { maxRetries: 0, backoffMs: 0, backoffMultiplier: 1 },
    }]);
    defStore.seed([def]);
    const instance = await engine.startWorkflow(def.id, makeContext(tenantId), tenantId);
    expect(instance.status).toBe('failed');
  });

  it('throws DEFINITION_NOT_FOUND for unknown definition ID', async () => {
    await expect(
      engine.startWorkflow('unknown-def-id', makeContext(tenantId), tenantId),
    ).rejects.toThrow(WorkflowEngineError);
  });

  it('throws DEFINITION_INACTIVE for an inactive definition', async () => {
    const def = makeDefinition(tenantId, [makeActionStep('S')], { isActive: false });
    defStore.seed([def]);
    await expect(
      engine.startWorkflow(def.id, makeContext(tenantId), tenantId),
    ).rejects.toMatchObject({ code: 'DEFINITION_INACTIVE' });
  });

  it('saves step results to stepResultStore', async () => {
    const def = await defStore.create(tenantId, 'Tracked', '', [makeActionStep('S', 'track')], []);
    engine.registerAction(makeSuccessHandler('track', { result: 'ok' }));
    const instance = await engine.startWorkflow(def.id, makeContext(tenantId), tenantId);
    const results = await stepResultStore.getByInstance(instance.id);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.status).toBe('completed');
  });

  it('action step output is stored in step result', async () => {
    const def = await defStore.create(tenantId, 'Output', '', [makeActionStep('S', 'out')], []);
    engine.registerAction(makeSuccessHandler('out', { sent: true, messageId: 'msg-1' }));
    const instance = await engine.startWorkflow(def.id, makeContext(tenantId), tenantId);
    const results = await stepResultStore.getByInstance(instance.id);
    expect(results[0]?.output).toMatchObject({ sent: true, messageId: 'msg-1' });
  });

  it('registerAction / getAction round-trip', () => {
    engine.registerAction(makeSuccessHandler('my_action'));
    expect(engine.getAction('my_action')).toBeDefined();
    expect(engine.getAction('other_action')).toBeUndefined();
  });
});

// ─── 5. Pause → Resume → Complete ───────────────────────────────

describe('WorkflowEngine — pause / resume / cancel', () => {
  beforeEach(resetAll);

  it('pause → resume → complete a workflow with a delay in between', async () => {
    const def = makeDefinition(tenantId, [
      makeActionStep('Send Initial', 'send_initial'),
      makeDelayStep('Wait', 1000, false),
      makeActionStep('Send Followup', 'send_followup'),
    ]);
    defStore.seed([def]);
    engine.registerAction(makeSuccessHandler('send_initial'));
    engine.registerAction(makeSuccessHandler('send_followup'));

    const started = await engine.startWorkflow(def.id, makeContext(tenantId), tenantId);
    expect(started.status).toBe('paused');
    expect(started.currentStepIndex).toBe(1);

    const resumed = await engine.resumeWorkflow(tenantId, started.id);
    expect(resumed.status).toBe('completed');
  });

  it('emits workflow.paused audit event on manual pause', async () => {
    const def = makeDefinition(tenantId, [makeActionStep('S', 'noop')]);
    defStore.seed([def]);
    const inst = makeInstance(tenantId, def.id, 'running', 0);
    await instanceStore.save(inst);

    await engine.pauseWorkflow(tenantId, inst.id);
    expect(auditCalls.find((c) => c.eventType === WORKFLOW_EVENTS.PAUSED)).toBeDefined();
    expect(auditCalls.find((c) => c.eventType === WORKFLOW_EVENTS.PAUSED)?.resourceId).toBe(inst.id);
  });

  it('emits workflow.resumed audit event on resume', async () => {
    const def = makeDefinition(tenantId, [makeActionStep('S', 'noop'), makeActionStep('S2', 'noop')]);
    defStore.seed([def]);
    engine.registerAction(makeSuccessHandler('noop'));
    const inst = makeInstance(tenantId, def.id, 'paused', 0);
    await instanceStore.save(inst);

    await engine.resumeWorkflow(tenantId, inst.id);
    expect(auditCalls.find((c) => c.eventType === WORKFLOW_EVENTS.RESUMED)).toBeDefined();
  });

  it('cancels a running workflow and emits workflow.cancelled', async () => {
    const def = makeDefinition(tenantId, [makeActionStep('S', 'noop')]);
    defStore.seed([def]);
    const inst = makeInstance(tenantId, def.id, 'running', 0);
    await instanceStore.save(inst);

    const cancelled = await engine.cancelWorkflow(tenantId, inst.id, 'Customer requested');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error).toBe('Customer requested');
    expect(auditCalls.find((c) => c.eventType === WORKFLOW_EVENTS.CANCELLED)).toBeDefined();
  });

  it('cancels a paused workflow', async () => {
    const def = makeDefinition(tenantId, [makeActionStep('S', 'noop')]);
    defStore.seed([def]);
    const inst = makeInstance(tenantId, def.id, 'paused', 0);
    await instanceStore.save(inst);
    const cancelled = await engine.cancelWorkflow(tenantId, inst.id, 'Paused cancel');
    expect(cancelled.status).toBe('cancelled');
  });

  it('throws INSTANCE_NOT_FOUND when pausing unknown instance', async () => {
    await expect(engine.pauseWorkflow(tenantId, 'unknown')).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
  });

  it('throws INSTANCE_NOT_FOUND when resuming unknown instance', async () => {
    await expect(engine.resumeWorkflow(tenantId, 'unknown')).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
  });

  it('throws INSTANCE_NOT_FOUND when cancelling unknown instance', async () => {
    await expect(engine.cancelWorkflow(tenantId, 'unknown', 'r')).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
  });

  it('human-review step causes workflow to pause', async () => {
    const def = makeDefinition(tenantId, [makeHumanReviewStep('Review Required')]);
    defStore.seed([def]);
    const instance = await engine.startWorkflow(def.id, makeContext(tenantId), tenantId);
    expect(instance.status).toBe('paused');
  });
});
