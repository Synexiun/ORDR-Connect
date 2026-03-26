/**
 * @ordr/workflow — Workflow Engine (the core)
 *
 * Orchestrates multi-step workflow execution with a strict state machine.
 * Supports: action, condition, delay, parallel, and human-review steps.
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - Every state change → immutable audit event (WORM)
 * - Every step execution → audit logged with timing and outcome
 * - PHI is NEVER logged — only tokenized references
 * - Tenant isolation enforced on all operations
 * - Per-step timeout enforcement
 * - Retry logic with configurable exponential backoff (max 3 retries)
 */

import { randomUUID } from 'node:crypto';
import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowStep,
  WorkflowContext,
  WorkflowStatus,
  StepResult,
  StepStatus,
  ActionHandler,
  ActionHandlerResult,
  WorkflowAuditLogger,
  RetryConfig,
  ConditionStepConfig,
  ActionStepConfig,
  DelayStepConfig,
  ParallelStepConfig,
  HumanReviewStepConfig,
} from './types.js';
import {
  VALID_TRANSITIONS,
  DEFAULT_RETRY_CONFIG,
  WORKFLOW_EVENTS,
} from './types.js';
import type { WorkflowDefinitionStore } from './definitions.js';
import type { DelayScheduler } from './scheduler.js';

// ─── Errors ─────────────────────────────────────────────────────

export class WorkflowEngineError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'WorkflowEngineError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Instance Store Interface ───────────────────────────────────

export interface WorkflowInstanceStore {
  save(instance: WorkflowInstance): Promise<void>;
  getById(tenantId: string, id: string): Promise<WorkflowInstance | undefined>;
  list(
    tenantId: string,
    filters?: {
      readonly status?: WorkflowStatus | undefined;
      readonly entityType?: string | undefined;
      readonly entityId?: string | undefined;
      readonly definitionId?: string | undefined;
    },
  ): Promise<readonly WorkflowInstance[]>;
  findByEntity(
    tenantId: string,
    entityType: string,
    entityId: string,
    definitionId: string,
  ): Promise<WorkflowInstance | undefined>;
}

export interface StepResultStore {
  save(result: StepResult): Promise<void>;
  getByInstance(instanceId: string): Promise<readonly StepResult[]>;
}

// ─── In-Memory Instance Store ───────────────────────────────────

export class InMemoryInstanceStore implements WorkflowInstanceStore {
  private readonly instances: Map<string, WorkflowInstance> = new Map();

  async save(instance: WorkflowInstance): Promise<void> {
    this.instances.set(instance.id, instance);
  }

  async getById(tenantId: string, id: string): Promise<WorkflowInstance | undefined> {
    const inst = this.instances.get(id);
    if (inst && inst.tenantId === tenantId) {
      return inst;
    }
    return undefined;
  }

  async list(
    tenantId: string,
    filters?: {
      readonly status?: WorkflowStatus | undefined;
      readonly entityType?: string | undefined;
      readonly entityId?: string | undefined;
      readonly definitionId?: string | undefined;
    },
  ): Promise<readonly WorkflowInstance[]> {
    const results: WorkflowInstance[] = [];
    for (const inst of this.instances.values()) {
      if (inst.tenantId !== tenantId) continue;
      if (filters?.status !== undefined && inst.status !== filters.status) continue;
      if (filters?.entityType !== undefined && inst.entityType !== filters.entityType) continue;
      if (filters?.entityId !== undefined && inst.entityId !== filters.entityId) continue;
      if (filters?.definitionId !== undefined && inst.definitionId !== filters.definitionId) continue;
      results.push(inst);
    }
    return results;
  }

  async findByEntity(
    tenantId: string,
    entityType: string,
    entityId: string,
    definitionId: string,
  ): Promise<WorkflowInstance | undefined> {
    for (const inst of this.instances.values()) {
      if (
        inst.tenantId === tenantId &&
        inst.entityType === entityType &&
        inst.entityId === entityId &&
        inst.definitionId === definitionId &&
        (inst.status === 'pending' || inst.status === 'running' || inst.status === 'paused')
      ) {
        return inst;
      }
    }
    return undefined;
  }

  clear(): void {
    this.instances.clear();
  }
}

// ─── In-Memory Step Result Store ────────────────────────────────

export class InMemoryStepResultStore implements StepResultStore {
  private readonly results: StepResult[] = [];

  async save(result: StepResult): Promise<void> {
    this.results.push(result);
  }

  async getByInstance(instanceId: string): Promise<readonly StepResult[]> {
    return this.results.filter((r) => r.instanceId === instanceId);
  }

  clear(): void {
    this.results.length = 0;
  }
}

// ─── Engine Dependencies ────────────────────────────────────────

export interface WorkflowEngineDeps {
  readonly definitionStore: WorkflowDefinitionStore;
  readonly instanceStore: WorkflowInstanceStore;
  readonly stepResultStore: StepResultStore;
  readonly auditLogger: WorkflowAuditLogger;
  readonly scheduler?: DelayScheduler | undefined;
}

// ─── Workflow Engine ────────────────────────────────────────────

export class WorkflowEngine {
  private readonly definitionStore: WorkflowDefinitionStore;
  private readonly instanceStore: WorkflowInstanceStore;
  private readonly stepResultStore: StepResultStore;
  private readonly auditLogger: WorkflowAuditLogger;
  private readonly scheduler: DelayScheduler | undefined;
  private readonly actionHandlers: Map<string, ActionHandler> = new Map();

  constructor(deps: WorkflowEngineDeps) {
    this.definitionStore = deps.definitionStore;
    this.instanceStore = deps.instanceStore;
    this.stepResultStore = deps.stepResultStore;
    this.auditLogger = deps.auditLogger;
    this.scheduler = deps.scheduler;
  }

  // ── Action Handler Registration ─────────────────────────────

  /**
   * Register an action handler for a given action name.
   * Actions are dispatched by name from workflow step configs.
   */
  registerAction(handler: ActionHandler): void {
    this.actionHandlers.set(handler.name, handler);
  }

  /**
   * Get a registered action handler by name.
   */
  getAction(name: string): ActionHandler | undefined {
    return this.actionHandlers.get(name);
  }

  // ── Workflow Lifecycle ──────────────────────────────────────

  /**
   * Start a new workflow instance from a definition.
   *
   * SECURITY: Context is tenant-scoped. Instance inherits tenantId from context.
   * AUDIT: Logs workflow.started event.
   */
  async startWorkflow(
    definitionId: string,
    context: WorkflowContext,
    tenantId: string,
  ): Promise<WorkflowInstance> {
    // Fetch and validate definition
    const definition = await this.definitionStore.getById(tenantId, definitionId);
    if (!definition) {
      throw new WorkflowEngineError(
        `Workflow definition '${definitionId}' not found for tenant '${tenantId}'`,
        'DEFINITION_NOT_FOUND',
      );
    }

    if (!definition.isActive) {
      throw new WorkflowEngineError(
        `Workflow definition '${definitionId}' is not active`,
        'DEFINITION_INACTIVE',
      );
    }

    // Create instance
    const now = new Date();
    const instance: WorkflowInstance = {
      id: randomUUID(),
      tenantId,
      definitionId,
      entityType: context.entityType,
      entityId: context.entityId,
      status: 'running',
      currentStepIndex: 0,
      context,
      startedAt: now,
      completedAt: null,
      error: null,
    };

    await this.instanceStore.save(instance);

    // Audit log
    await this.auditLogger.log({
      tenantId,
      eventType: WORKFLOW_EVENTS.STARTED,
      actorType: 'system',
      actorId: 'workflow-engine',
      resource: 'workflow_instances',
      resourceId: instance.id,
      action: 'start',
      details: {
        definitionId,
        entityType: context.entityType,
        entityId: context.entityId,
        correlationId: context.correlationId,
      },
      timestamp: now,
    });

    // Begin execution
    return this.executeWorkflow(instance, definition);
  }

  /**
   * Execute the workflow from its current step forward.
   */
  private async executeWorkflow(
    instance: WorkflowInstance,
    definition: WorkflowDefinition,
  ): Promise<WorkflowInstance> {
    let current = instance;

    while (
      current.status === 'running' &&
      current.currentStepIndex < definition.steps.length
    ) {
      const step = definition.steps[current.currentStepIndex];
      if (!step) {
        break;
      }

      const result = await this.executeStep(current, step);

      if (result.status === 'waiting') {
        // Step is waiting (delay or human-review) — stop execution loop
        const paused: WorkflowInstance = {
          ...current,
          status: 'paused',
        };
        await this.instanceStore.save(paused);
        return paused;
      }

      if (result.status === 'failed') {
        // Step failed — mark workflow as failed
        const failed: WorkflowInstance = {
          ...current,
          status: 'failed',
          error: result.error ?? 'Step execution failed',
          completedAt: new Date(),
        };
        await this.instanceStore.save(failed);

        await this.auditLogger.log({
          tenantId: current.tenantId,
          eventType: WORKFLOW_EVENTS.FAILED,
          actorType: 'system',
          actorId: 'workflow-engine',
          resource: 'workflow_instances',
          resourceId: current.id,
          action: 'fail',
          details: {
            stepIndex: current.currentStepIndex,
            stepName: step.name,
            error: result.error ?? 'unknown',
          },
          timestamp: new Date(),
        });

        return failed;
      }

      // Determine next step index
      let nextIndex: number;
      if (step.config.type === 'condition') {
        const condResult = result.output['branchTaken'] as string | undefined;
        nextIndex = condResult === 'true'
          ? step.config.trueBranch
          : step.config.falseBranch;
      } else {
        nextIndex = current.currentStepIndex + 1;
      }

      // Advance to next step
      current = {
        ...current,
        currentStepIndex: nextIndex,
      };
      await this.instanceStore.save(current);
    }

    // Workflow completed
    if (current.status === 'running') {
      const completed: WorkflowInstance = {
        ...current,
        status: 'completed',
        completedAt: new Date(),
      };
      await this.instanceStore.save(completed);

      await this.auditLogger.log({
        tenantId: current.tenantId,
        eventType: WORKFLOW_EVENTS.COMPLETED,
        actorType: 'system',
        actorId: 'workflow-engine',
        resource: 'workflow_instances',
        resourceId: current.id,
        action: 'complete',
        details: {
          stepsExecuted: current.currentStepIndex,
        },
        timestamp: new Date(),
      });

      return completed;
    }

    return current;
  }

  /**
   * Execute a single step, dispatching to the appropriate handler.
   *
   * AUDIT: Every step execution is logged with timing and outcome.
   * SECURITY: Per-step timeout enforcement.
   * RETRY: Configurable backoff (max 3 retries per step).
   */
  async executeStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
  ): Promise<StepResult> {
    const startedAt = new Date();
    const retryConfig = step.retryConfig ?? DEFAULT_RETRY_CONFIG;
    let lastError: string | null = null;
    let retryCount = 0;

    while (retryCount <= retryConfig.maxRetries) {
      try {
        const result = await this.executeStepOnce(instance, step, startedAt, retryCount);

        // Log step result
        await this.stepResultStore.save(result);

        // Audit log step completion
        await this.auditLogger.log({
          tenantId: instance.tenantId,
          eventType: result.status === 'completed'
            ? WORKFLOW_EVENTS.STEP_COMPLETED
            : result.status === 'waiting'
              ? 'workflow.step_waiting'
              : WORKFLOW_EVENTS.STEP_FAILED,
          actorType: 'system',
          actorId: 'workflow-engine',
          resource: 'workflow_step_results',
          resourceId: result.id,
          action: `step_${step.type}`,
          details: {
            instanceId: instance.id,
            stepIndex: instance.currentStepIndex,
            stepName: step.name,
            stepType: step.type,
            status: result.status,
            retryCount,
            durationMs: result.completedAt
              ? result.completedAt.getTime() - startedAt.getTime()
              : 0,
          },
          timestamp: new Date(),
        });

        if (result.status !== 'failed' || retryCount >= retryConfig.maxRetries) {
          return result;
        }

        lastError = result.error;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }

      retryCount++;
      if (retryCount <= retryConfig.maxRetries) {
        const delay = retryConfig.backoffMs * Math.pow(retryConfig.backoffMultiplier, retryCount - 1);
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    const failedResult: StepResult = {
      id: randomUUID(),
      instanceId: instance.id,
      stepIndex: instance.currentStepIndex,
      stepType: step.type,
      status: 'failed',
      input: {},
      output: {},
      startedAt,
      completedAt: new Date(),
      error: lastError ?? 'Step execution failed after retries',
      retryCount,
    };

    await this.stepResultStore.save(failedResult);
    return failedResult;
  }

  /**
   * Execute a single attempt of a step.
   */
  private async executeStepOnce(
    instance: WorkflowInstance,
    step: WorkflowStep,
    startedAt: Date,
    retryCount: number,
  ): Promise<StepResult> {
    const timeoutMs = step.timeoutMs ?? 30_000;

    const resultPromise = this.dispatchStep(instance, step, startedAt, retryCount);

    if (timeoutMs <= 0) {
      return resultPromise;
    }

    // Race the step against a timeout, ensuring we always clean up the timer
    // to prevent leaked handles and OOM from accumulated pending timers.
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<StepResult>((_, reject) => {
      timerId = setTimeout(() => {
        reject(new WorkflowEngineError(
          `Step '${step.name}' timed out after ${String(timeoutMs)}ms`,
          'STEP_TIMEOUT',
        ));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([resultPromise, timeoutPromise]);
      clearTimeout(timerId);
      return result;
    } catch (err: unknown) {
      clearTimeout(timerId);
      throw err;
    }
  }

  /**
   * Dispatch to the correct step handler based on step type.
   */
  private async dispatchStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
    startedAt: Date,
    retryCount: number,
  ): Promise<StepResult> {
    switch (step.config.type) {
      case 'action':
        return this.executeActionStep(instance, step, step.config, startedAt, retryCount);
      case 'condition':
        return this.executeConditionStep(instance, step, step.config, startedAt, retryCount);
      case 'delay':
        return this.executeDelayStep(instance, step, step.config, startedAt, retryCount);
      case 'parallel':
        return this.executeParallelStep(instance, step, step.config, startedAt, retryCount);
      case 'human-review':
        return this.executeHumanReviewStep(instance, step, step.config, startedAt, retryCount);
      default: {
        // Exhaustive check
        const exhaustive: never = step.config;
        throw new WorkflowEngineError(
          `Unknown step type: ${JSON.stringify(exhaustive)}`,
          'UNKNOWN_STEP_TYPE',
        );
      }
    }
  }

  // ── Step Handlers ───────────────────────────────────────────

  private async executeActionStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
    config: ActionStepConfig,
    startedAt: Date,
    retryCount: number,
  ): Promise<StepResult> {
    const handler = this.actionHandlers.get(config.actionName);
    if (!handler) {
      return {
        id: randomUUID(),
        instanceId: instance.id,
        stepIndex: instance.currentStepIndex,
        stepType: 'action',
        status: 'failed',
        input: config.parameters,
        output: {},
        startedAt,
        completedAt: new Date(),
        error: `No action handler registered for '${config.actionName}'`,
        retryCount,
      };
    }

    let result: ActionHandlerResult;
    try {
      result = await handler.execute(config.parameters, instance.context);
    } catch (err: unknown) {
      return {
        id: randomUUID(),
        instanceId: instance.id,
        stepIndex: instance.currentStepIndex,
        stepType: 'action',
        status: 'failed',
        input: config.parameters,
        output: {},
        startedAt,
        completedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
        retryCount,
      };
    }

    return {
      id: randomUUID(),
      instanceId: instance.id,
      stepIndex: instance.currentStepIndex,
      stepType: 'action',
      status: result.success ? 'completed' : 'failed',
      input: config.parameters,
      output: result.output,
      startedAt,
      completedAt: new Date(),
      error: result.error ?? null,
      retryCount,
    };
  }

  private async executeConditionStep(
    _instance: WorkflowInstance,
    _step: WorkflowStep,
    config: ConditionStepConfig,
    startedAt: Date,
    retryCount: number,
  ): Promise<StepResult> {
    const fieldValue = this.resolveField(config.field, _instance.context);
    const conditionMet = this.evaluateCondition(fieldValue, config.operator, config.value);

    return {
      id: randomUUID(),
      instanceId: _instance.id,
      stepIndex: _instance.currentStepIndex,
      stepType: 'condition',
      status: 'completed',
      input: { field: config.field, operator: config.operator, value: config.value },
      output: {
        conditionMet,
        branchTaken: conditionMet ? 'true' : 'false',
        fieldValue: typeof fieldValue === 'object' ? '[object]' : String(fieldValue ?? 'undefined'),
      },
      startedAt,
      completedAt: new Date(),
      error: null,
      retryCount,
    };
  }

  private async executeDelayStep(
    instance: WorkflowInstance,
    _step: WorkflowStep,
    config: DelayStepConfig,
    startedAt: Date,
    retryCount: number,
  ): Promise<StepResult> {
    // If a scheduler is configured, schedule the resume and return 'waiting'
    if (this.scheduler) {
      const scheduledAt = this.scheduler.calculateResumeTime(
        config.durationMs,
        config.businessHoursOnly,
      );

      this.scheduler.schedule({
        id: randomUUID(),
        instanceId: instance.id,
        stepIndex: instance.currentStepIndex,
        scheduledAt,
        executedAt: null,
        status: 'pending',
      });

      return {
        id: randomUUID(),
        instanceId: instance.id,
        stepIndex: instance.currentStepIndex,
        stepType: 'delay',
        status: 'waiting',
        input: { durationMs: config.durationMs, businessHoursOnly: config.businessHoursOnly },
        output: { scheduledAt: scheduledAt.toISOString() },
        startedAt,
        completedAt: null,
        error: null,
        retryCount,
      };
    }

    // No scheduler — return 'waiting' to indicate the workflow should pause
    return {
      id: randomUUID(),
      instanceId: instance.id,
      stepIndex: instance.currentStepIndex,
      stepType: 'delay',
      status: 'waiting',
      input: { durationMs: config.durationMs, businessHoursOnly: config.businessHoursOnly },
      output: {},
      startedAt,
      completedAt: null,
      error: null,
      retryCount,
    };
  }

  private async executeParallelStep(
    instance: WorkflowInstance,
    _step: WorkflowStep,
    config: ParallelStepConfig,
    startedAt: Date,
    retryCount: number,
  ): Promise<StepResult> {
    const definition = await this.definitionStore.getById(
      instance.tenantId,
      instance.definitionId,
    );

    if (!definition) {
      return {
        id: randomUUID(),
        instanceId: instance.id,
        stepIndex: instance.currentStepIndex,
        stepType: 'parallel',
        status: 'failed',
        input: { branches: config.branches, mode: config.mode },
        output: {},
        startedAt,
        completedAt: new Date(),
        error: 'Workflow definition not found for parallel step',
        retryCount,
      };
    }

    // Execute all branch steps concurrently
    const branchPromises = config.branches.map(async (branchIdx) => {
      const branchStep = definition.steps[branchIdx];
      if (!branchStep) {
        return {
          branchIndex: branchIdx,
          success: false,
          error: `Branch step ${String(branchIdx)} not found`,
        };
      }

      const branchInstance: WorkflowInstance = {
        ...instance,
        currentStepIndex: branchIdx,
      };

      try {
        const result = await this.executeStep(branchInstance, branchStep);
        return {
          branchIndex: branchIdx,
          success: result.status === 'completed',
          error: result.error,
        };
      } catch (err: unknown) {
        return {
          branchIndex: branchIdx,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const branchResults = await Promise.all(branchPromises);
    const successCount = branchResults.filter((r) => r.success).length;

    let overallSuccess: boolean;
    switch (config.mode) {
      case 'all':
        overallSuccess = successCount === config.branches.length;
        break;
      case 'any':
        overallSuccess = successCount > 0;
        break;
      case 'n':
        overallSuccess = successCount >= (config.requiredCompletions ?? 1);
        break;
      default:
        overallSuccess = false;
    }

    return {
      id: randomUUID(),
      instanceId: instance.id,
      stepIndex: instance.currentStepIndex,
      stepType: 'parallel',
      status: overallSuccess ? 'completed' : 'failed',
      input: { branches: config.branches, mode: config.mode },
      output: {
        branchResults,
        successCount,
        totalBranches: config.branches.length,
      },
      startedAt,
      completedAt: new Date(),
      error: overallSuccess ? null : `Parallel step failed: ${String(successCount)}/${String(config.branches.length)} succeeded (mode: ${config.mode})`,
      retryCount,
    };
  }

  private async executeHumanReviewStep(
    instance: WorkflowInstance,
    _step: WorkflowStep,
    config: HumanReviewStepConfig,
    startedAt: Date,
    retryCount: number,
  ): Promise<StepResult> {
    // Human review steps always pause the workflow for HITL approval
    return {
      id: randomUUID(),
      instanceId: instance.id,
      stepIndex: instance.currentStepIndex,
      stepType: 'human-review',
      status: 'waiting',
      input: {
        description: config.description,
        assigneeRole: config.assigneeRole ?? null,
      },
      output: {},
      startedAt,
      completedAt: null,
      error: null,
      retryCount,
    };
  }

  // ── Pause / Resume / Cancel ─────────────────────────────────

  /**
   * Pause a running workflow.
   *
   * AUDIT: Logs workflow.paused event.
   */
  async pauseWorkflow(
    tenantId: string,
    instanceId: string,
  ): Promise<WorkflowInstance> {
    const instance = await this.instanceStore.getById(tenantId, instanceId);
    if (!instance) {
      throw new WorkflowEngineError(
        `Workflow instance '${instanceId}' not found`,
        'INSTANCE_NOT_FOUND',
      );
    }

    this.validateTransition(instance.status, 'paused');

    const paused: WorkflowInstance = {
      ...instance,
      status: 'paused',
    };

    await this.instanceStore.save(paused);

    await this.auditLogger.log({
      tenantId,
      eventType: WORKFLOW_EVENTS.PAUSED,
      actorType: 'user',
      actorId: 'workflow-engine',
      resource: 'workflow_instances',
      resourceId: instanceId,
      action: 'pause',
      details: {
        previousStatus: instance.status,
        currentStepIndex: instance.currentStepIndex,
      },
      timestamp: new Date(),
    });

    return paused;
  }

  /**
   * Resume a paused workflow from its current step.
   *
   * AUDIT: Logs workflow.resumed event.
   */
  async resumeWorkflow(
    tenantId: string,
    instanceId: string,
  ): Promise<WorkflowInstance> {
    const instance = await this.instanceStore.getById(tenantId, instanceId);
    if (!instance) {
      throw new WorkflowEngineError(
        `Workflow instance '${instanceId}' not found`,
        'INSTANCE_NOT_FOUND',
      );
    }

    this.validateTransition(instance.status, 'running');

    const definition = await this.definitionStore.getById(tenantId, instance.definitionId);
    if (!definition) {
      throw new WorkflowEngineError(
        `Workflow definition '${instance.definitionId}' not found`,
        'DEFINITION_NOT_FOUND',
      );
    }

    // Advance past the current step (it was the delay/human-review that paused)
    const resumed: WorkflowInstance = {
      ...instance,
      status: 'running',
      currentStepIndex: instance.currentStepIndex + 1,
    };

    await this.instanceStore.save(resumed);

    await this.auditLogger.log({
      tenantId,
      eventType: WORKFLOW_EVENTS.RESUMED,
      actorType: 'system',
      actorId: 'workflow-engine',
      resource: 'workflow_instances',
      resourceId: instanceId,
      action: 'resume',
      details: {
        previousStatus: instance.status,
        resumedAtStep: resumed.currentStepIndex,
      },
      timestamp: new Date(),
    });

    // Continue execution from resumed step
    return this.executeWorkflow(resumed, definition);
  }

  /**
   * Cancel a workflow with a reason.
   *
   * AUDIT: Logs workflow.cancelled event with reason.
   */
  async cancelWorkflow(
    tenantId: string,
    instanceId: string,
    reason: string,
  ): Promise<WorkflowInstance> {
    const instance = await this.instanceStore.getById(tenantId, instanceId);
    if (!instance) {
      throw new WorkflowEngineError(
        `Workflow instance '${instanceId}' not found`,
        'INSTANCE_NOT_FOUND',
      );
    }

    this.validateTransition(instance.status, 'cancelled');

    const cancelled: WorkflowInstance = {
      ...instance,
      status: 'cancelled',
      error: reason,
      completedAt: new Date(),
    };

    await this.instanceStore.save(cancelled);

    await this.auditLogger.log({
      tenantId,
      eventType: WORKFLOW_EVENTS.CANCELLED,
      actorType: 'user',
      actorId: 'workflow-engine',
      resource: 'workflow_instances',
      resourceId: instanceId,
      action: 'cancel',
      details: {
        reason,
        previousStatus: instance.status,
        stepsCompleted: instance.currentStepIndex,
      },
      timestamp: new Date(),
    });

    return cancelled;
  }

  // ── State Machine ───────────────────────────────────────────

  /**
   * Validate a status transition against the state machine.
   * Throws if the transition is invalid.
   */
  validateTransition(from: WorkflowStatus, to: WorkflowStatus): void {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new WorkflowEngineError(
        `Invalid workflow transition: ${from} -> ${to}`,
        'INVALID_TRANSITION',
      );
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  /**
   * Resolve a dot-notation field path against a WorkflowContext.
   */
  private resolveField(path: string, context: WorkflowContext): unknown {
    const parts = path.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = context;
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      current = current[part];
    }
    return current;
  }

  /**
   * Evaluate a simple condition.
   */
  private evaluateCondition(
    fieldValue: unknown,
    operator: string,
    value: unknown,
  ): boolean {
    switch (operator) {
      case 'eq':
        return fieldValue === value;
      case 'neq':
        return fieldValue !== value;
      case 'gt':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue > value;
      case 'lt':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue < value;
      case 'gte':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue >= value;
      case 'lte':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue <= value;
      default:
        return false;
    }
  }

  /** Promise-based sleep utility. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
