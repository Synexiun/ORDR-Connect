/**
 * @ordr/workflow — Type definitions for multi-step workflow orchestration
 *
 * Workflows are event-sourced, tenant-isolated sequences of steps that
 * automate customer operations: collections cadences, onboarding flows,
 * appointment reminders, and churn intervention.
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - All types use readonly to enforce immutability
 * - WorkflowContext is encrypted (JSONB) at the database layer
 * - PHI is NEVER stored in plaintext — only tokenized references
 * - Every state transition emits an audit event
 */

// ─── Step Types ─────────────────────────────────────────────────

export const STEP_TYPES = [
  'action',
  'condition',
  'delay',
  'parallel',
  'human-review',
] as const;

export type StepType = (typeof STEP_TYPES)[number];

// ─── Workflow Status ────────────────────────────────────────────

export const WORKFLOW_STATUSES = [
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

// ─── Step Status ────────────────────────────────────────────────

export const STEP_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'waiting',
] as const;

export type StepStatus = (typeof STEP_STATUSES)[number];

// ─── Parallel Mode ──────────────────────────────────────────────

export const PARALLEL_MODES = ['all', 'any', 'n'] as const;

export type ParallelMode = (typeof PARALLEL_MODES)[number];

// ─── Trigger Type ───────────────────────────────────────────────

export const TRIGGER_TYPES = ['event', 'schedule', 'manual'] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];

// ─── Retry Config ───────────────────────────────────────────────

export interface RetryConfig {
  readonly maxRetries: number;
  readonly backoffMs: number;
  readonly backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
} as const;

// ─── Workflow Step ──────────────────────────────────────────────

export interface WorkflowStep {
  readonly name: string;
  readonly type: StepType;
  readonly config: StepConfig;
  readonly timeoutMs?: number | undefined;
  readonly retryConfig?: RetryConfig | undefined;
}

// ─── Step Config Variants ───────────────────────────────────────

export type StepConfig =
  | ActionStepConfig
  | ConditionStepConfig
  | DelayStepConfig
  | ParallelStepConfig
  | HumanReviewStepConfig;

export interface ActionStepConfig {
  readonly type: 'action';
  readonly actionName: string;
  readonly parameters: Record<string, unknown>;
}

export interface ConditionStepConfig {
  readonly type: 'condition';
  readonly expression: string;
  readonly field: string;
  readonly operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte';
  readonly value: unknown;
  /** Step index to jump to if condition is true. */
  readonly trueBranch: number;
  /** Step index to jump to if condition is false. */
  readonly falseBranch: number;
}

export interface DelayStepConfig {
  readonly type: 'delay';
  /** Delay duration in milliseconds. */
  readonly durationMs: number;
  /** If true, skip weekends and holidays (TCPA compliance). */
  readonly businessHoursOnly: boolean;
  /** Optional cron expression for scheduled delays. */
  readonly cronExpression?: string | undefined;
}

export interface ParallelStepConfig {
  readonly type: 'parallel';
  /** Steps to execute in parallel (indices into the definition's step array). */
  readonly branches: readonly number[];
  /** all = wait for all, any = wait for first, n = wait for N completions. */
  readonly mode: ParallelMode;
  /** Required completions when mode = 'n'. */
  readonly requiredCompletions?: number | undefined;
}

export interface HumanReviewStepConfig {
  readonly type: 'human-review';
  readonly description: string;
  readonly assigneeRole?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

// ─── Trigger Config ─────────────────────────────────────────────

export interface TriggerConfig {
  readonly type: TriggerType;
  /** Event type to listen for (e.g., 'customer.created'). */
  readonly eventType?: string | undefined;
  /** Cron expression for schedule-based triggers. */
  readonly cronExpression?: string | undefined;
  /** Entity type filter (e.g., 'customer', 'order'). */
  readonly entityType?: string | undefined;
}

// ─── Workflow Definition ────────────────────────────────────────

export interface WorkflowDefinition {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly steps: readonly WorkflowStep[];
  readonly triggers: readonly TriggerConfig[];
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─── Workflow Context ───────────────────────────────────────────

/**
 * Context carried through workflow execution.
 *
 * SECURITY: When persisted, this is encrypted (AES-256-GCM) at the
 * database layer. PHI must NEVER appear in plaintext — use tokenized
 * references (customer_id, not customer_name).
 */
export interface WorkflowContext {
  readonly entityType: string;
  readonly entityId: string;
  readonly tenantId: string;
  readonly variables: Record<string, unknown>;
  readonly correlationId: string;
  readonly initiatedBy: string;
}

// ─── Workflow Instance ──────────────────────────────────────────

export interface WorkflowInstance {
  readonly id: string;
  readonly tenantId: string;
  readonly definitionId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly status: WorkflowStatus;
  readonly currentStepIndex: number;
  readonly context: WorkflowContext;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly error: string | null;
}

// ─── Step Result ────────────────────────────────────────────────

export interface StepResult {
  readonly id: string;
  readonly instanceId: string;
  readonly stepIndex: number;
  readonly stepType: StepType;
  readonly status: StepStatus;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown>;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly error: string | null;
  readonly retryCount: number;
}

// ─── Workflow Schedule ──────────────────────────────────────────

export interface WorkflowSchedule {
  readonly id: string;
  readonly instanceId: string;
  readonly stepIndex: number;
  readonly scheduledAt: Date;
  readonly executedAt: Date | null;
  readonly status: 'pending' | 'executed' | 'cancelled';
}

// ─── State Transitions ─────────────────────────────────────────

/**
 * Valid workflow status transitions.
 * Enforced by the WorkflowEngine state machine.
 */
export const VALID_TRANSITIONS: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  pending: ['running', 'cancelled'],
  running: ['paused', 'completed', 'failed', 'cancelled'],
  paused: ['running', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
} as const;

// ─── Action Handler ─────────────────────────────────────────────

/**
 * Interface for registered action handlers.
 * Each action (send_email, check_payment, etc.) implements this.
 */
export interface ActionHandler {
  readonly name: string;
  execute(
    parameters: Record<string, unknown>,
    context: WorkflowContext,
  ): Promise<ActionHandlerResult>;
}

export interface ActionHandlerResult {
  readonly success: boolean;
  readonly output: Record<string, unknown>;
  readonly error?: string | undefined;
}

// ─── Audit Logger Interface (decoupled for testing) ─────────────

export interface WorkflowAuditLogger {
  log(input: {
    readonly tenantId: string;
    readonly eventType: string;
    readonly actorType: 'system' | 'user';
    readonly actorId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly action: string;
    readonly details: Record<string, unknown>;
    readonly timestamp: Date;
  }): Promise<{ readonly id: string }>;
}

// ─── Event Constants ────────────────────────────────────────────

export const WORKFLOW_EVENTS = {
  STARTED: 'workflow.started',
  STEP_COMPLETED: 'workflow.step_completed',
  STEP_FAILED: 'workflow.step_failed',
  PAUSED: 'workflow.paused',
  RESUMED: 'workflow.resumed',
  COMPLETED: 'workflow.completed',
  FAILED: 'workflow.failed',
  CANCELLED: 'workflow.cancelled',
} as const;
