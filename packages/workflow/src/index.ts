/**
 * @ordr/workflow — Multi-step Workflow Orchestration Engine
 *
 * Orchestrates automated customer operations workflows:
 * collections cadences, onboarding flows, appointment reminders,
 * and churn intervention sequences.
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - Every state change is WORM audit-logged
 * - PHI encrypted at storage layer (never plaintext)
 * - TCPA business-hours enforcement for outbound comms
 * - Tenant isolation on all operations
 *
 * Usage:
 *   import { WorkflowEngine, InMemoryDefinitionStore, DelayScheduler } from '@ordr/workflow';
 *
 *   const engine = new WorkflowEngine({ definitionStore, instanceStore, stepResultStore, auditLogger });
 *   engine.registerAction(sendEmailHandler);
 *   const instance = await engine.startWorkflow(definitionId, context, tenantId);
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  StepType,
  WorkflowStatus,
  StepStatus,
  ParallelMode,
  TriggerType,
  RetryConfig,
  WorkflowStep,
  StepConfig,
  ActionStepConfig,
  ConditionStepConfig,
  DelayStepConfig,
  ParallelStepConfig,
  HumanReviewStepConfig,
  TriggerConfig,
  WorkflowDefinition,
  WorkflowContext,
  WorkflowInstance,
  StepResult,
  WorkflowSchedule,
  ActionHandler,
  ActionHandlerResult,
  WorkflowAuditLogger,
} from './types.js';

export {
  STEP_TYPES,
  WORKFLOW_STATUSES,
  STEP_STATUSES,
  PARALLEL_MODES,
  TRIGGER_TYPES,
  DEFAULT_RETRY_CONFIG,
  VALID_TRANSITIONS,
  WORKFLOW_EVENTS,
} from './types.js';

// ─── Definitions ──────────────────────────────────────────────────
export {
  InMemoryDefinitionStore,
  WorkflowDefinitionError,
  validateDefinition,
  createBuiltinDefinitions,
  BUILTIN_TEMPLATES,
  COLLECTIONS_CADENCE_STEPS,
  CUSTOMER_ONBOARDING_STEPS,
  HEALTHCARE_APPOINTMENT_STEPS,
  CHURN_INTERVENTION_STEPS,
} from './definitions.js';

export type { WorkflowDefinitionStore } from './definitions.js';

// ─── Engine ───────────────────────────────────────────────────────
export {
  WorkflowEngine,
  WorkflowEngineError,
  InMemoryInstanceStore,
  InMemoryStepResultStore,
} from './engine.js';

export type {
  WorkflowEngineDeps,
  WorkflowInstanceStore,
  StepResultStore,
} from './engine.js';

// ─── Triggers ─────────────────────────────────────────────────────
export { WorkflowTrigger, matchesCron } from './triggers.js';

export type { TriggerEvent, WorkflowTriggerDeps } from './triggers.js';

// ─── Scheduler ────────────────────────────────────────────────────
export { DelayScheduler, DEFAULT_BUSINESS_HOURS } from './scheduler.js';

export type { BusinessHoursConfig } from './scheduler.js';
