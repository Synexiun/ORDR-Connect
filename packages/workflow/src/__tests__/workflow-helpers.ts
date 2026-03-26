/**
 * Shared test helpers for @ordr/workflow test suite.
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - No PHI in test data — only tokenised entity IDs
 * - All types strictly typed — no `any`
 */

import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowStep,
  WorkflowContext,
  WorkflowStatus,
  WorkflowSchedule,
  WorkflowAuditLogger,
  ActionHandler,
  ActionHandlerResult,
} from '../types.js';

// ─── Re-exports for convenience ─────────────────────────────────

export type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowStep,
  WorkflowContext,
  WorkflowStatus,
  WorkflowSchedule,
  WorkflowAuditLogger,
  ActionHandler,
  ActionHandlerResult,
};

export type { StepResult, TriggerConfig } from '../types.js';

export {
  VALID_TRANSITIONS,
  WORKFLOW_EVENTS,
  DEFAULT_RETRY_CONFIG,
} from '../types.js';

export {
  validateDefinition,
  WorkflowDefinitionError,
  InMemoryDefinitionStore,
  createBuiltinDefinitions,
  BUILTIN_TEMPLATES,
  COLLECTIONS_CADENCE_STEPS,
  CUSTOMER_ONBOARDING_STEPS,
  HEALTHCARE_APPOINTMENT_STEPS,
  CHURN_INTERVENTION_STEPS,
} from '../definitions.js';

export {
  WorkflowEngine,
  WorkflowEngineError,
  InMemoryInstanceStore,
  InMemoryStepResultStore,
} from '../engine.js';

export {
  DelayScheduler,
  DEFAULT_BUSINESS_HOURS,
} from '../scheduler.js';

export type { BusinessHoursConfig } from '../scheduler.js';

export { WorkflowTrigger, matchesCron } from '../triggers.js';

export type { TriggerEvent } from '../triggers.js';

// ─── Audit Logger Mock ──────────────────────────────────────────

export interface AuditCall {
  readonly tenantId: string;
  readonly eventType: string;
  readonly actorType: 'system' | 'user';
  readonly actorId: string;
  readonly resource: string;
  readonly resourceId: string;
  readonly action: string;
  readonly details: Record<string, unknown>;
  readonly timestamp: Date;
}

export function makeMockAuditLogger(): { logger: WorkflowAuditLogger; calls: AuditCall[] } {
  const calls: AuditCall[] = [];
  const logger: WorkflowAuditLogger = {
    async log(input) {
      calls.push(input);
      return { id: `audit-${String(calls.length)}` };
    },
  };
  return { logger, calls };
}

// ─── Factory Helpers ────────────────────────────────────────────

export function makeActionStep(
  name: string,
  actionName = 'send_email',
  overrides: Partial<WorkflowStep> = {},
): WorkflowStep {
  return {
    name,
    type: 'action',
    config: {
      type: 'action',
      actionName,
      parameters: { template: 'test_template' },
    },
    ...overrides,
  };
}

export function makeDelayStep(name: string, durationMs = 1000, businessHoursOnly = false): WorkflowStep {
  return {
    name,
    type: 'delay',
    config: {
      type: 'delay',
      durationMs,
      businessHoursOnly,
    },
  };
}

export function makeConditionStep(
  name: string,
  field: string,
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte',
  value: unknown,
  trueBranch: number,
  falseBranch: number,
): WorkflowStep {
  return {
    name,
    type: 'condition',
    config: {
      type: 'condition',
      expression: `${field} ${operator} ${String(value)}`,
      field,
      operator,
      value,
      trueBranch,
      falseBranch,
    },
  };
}

export function makeHumanReviewStep(name: string): WorkflowStep {
  return {
    name,
    type: 'human-review',
    config: {
      type: 'human-review',
      description: 'Review required',
      assigneeRole: 'manager',
    },
  };
}

export function makeDefinition(
  tenantId: string,
  steps: readonly WorkflowStep[],
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  const now = new Date();
  return {
    id: `def-${tenantId}-${String(Date.now())}`,
    tenantId,
    name: 'Test Workflow',
    description: 'Test workflow definition',
    version: 1,
    steps,
    triggers: [],
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeContext(
  tenantId: string,
  entityId = 'entity-001',
  variables: Record<string, unknown> = {},
): WorkflowContext {
  return {
    entityType: 'customer',
    entityId,
    tenantId,
    variables,
    correlationId: `corr-${entityId}`,
    initiatedBy: 'test-user',
  };
}

export function makeInstance(
  tenantId: string,
  definitionId: string,
  status: WorkflowStatus = 'running',
  currentStepIndex = 0,
): WorkflowInstance {
  const now = new Date();
  return {
    id: `inst-${tenantId}-${String(Date.now())}-${String(Math.random()).slice(2)}`,
    tenantId,
    definitionId,
    entityType: 'customer',
    entityId: 'entity-001',
    status,
    currentStepIndex,
    context: makeContext(tenantId),
    startedAt: now,
    completedAt: null,
    error: null,
  };
}

export function makeSuccessHandler(name: string, output: Record<string, unknown> = {}): ActionHandler {
  return {
    name,
    async execute(_params, _ctx): Promise<ActionHandlerResult> {
      return { success: true, output };
    },
  };
}

export function makeFailingHandler(name: string, errorMsg = 'handler error'): ActionHandler {
  return {
    name,
    async execute(_params, _ctx): Promise<ActionHandlerResult> {
      return { success: false, output: {}, error: errorMsg };
    },
  };
}

export function makeSchedule(
  id: string,
  instanceId: string,
  scheduledAt: Date,
  status: WorkflowSchedule['status'] = 'pending',
): WorkflowSchedule {
  return {
    id,
    instanceId,
    stepIndex: 0,
    scheduledAt,
    executedAt: null,
    status,
  };
}
