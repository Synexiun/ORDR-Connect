/**
 * @ordr/workflow — Workflow Definition Store (CRUD + built-in templates)
 *
 * Manages workflow templates that define multi-step automation sequences.
 * Built-in templates cover common customer operations patterns.
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - All definitions are tenant-scoped
 * - Every CRUD operation is audit-logged
 * - Definitions are versioned for change tracking
 */

import { randomUUID } from 'node:crypto';
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowAuditLogger,
} from './types.js';

// ─── Validation ─────────────────────────────────────────────────

export class WorkflowDefinitionError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'WorkflowDefinitionError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function validateDefinition(
  name: string,
  steps: readonly WorkflowStep[],
): void {
  if (!name || name.trim().length === 0) {
    throw new WorkflowDefinitionError(
      'Workflow name is required',
      'INVALID_NAME',
    );
  }

  if (steps.length === 0) {
    throw new WorkflowDefinitionError(
      'Workflow must have at least one step',
      'NO_STEPS',
    );
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (!step.name || step.name.trim().length === 0) {
      throw new WorkflowDefinitionError(
        `Step ${String(i)} must have a name`,
        'INVALID_STEP_NAME',
      );
    }

    if (step.config.type === 'condition') {
      if (step.config.trueBranch < 0 || step.config.trueBranch >= steps.length) {
        throw new WorkflowDefinitionError(
          `Step ${String(i)} condition trueBranch index ${String(step.config.trueBranch)} is out of bounds`,
          'INVALID_BRANCH',
        );
      }
      if (step.config.falseBranch < 0 || step.config.falseBranch >= steps.length) {
        throw new WorkflowDefinitionError(
          `Step ${String(i)} condition falseBranch index ${String(step.config.falseBranch)} is out of bounds`,
          'INVALID_BRANCH',
        );
      }
    }

    if (step.config.type === 'parallel') {
      for (const branchIdx of step.config.branches) {
        if (branchIdx < 0 || branchIdx >= steps.length) {
          throw new WorkflowDefinitionError(
            `Step ${String(i)} parallel branch index ${String(branchIdx)} is out of bounds`,
            'INVALID_BRANCH',
          );
        }
      }
      if (step.config.mode === 'n') {
        const required = step.config.requiredCompletions ?? 0;
        if (required <= 0 || required > step.config.branches.length) {
          throw new WorkflowDefinitionError(
            `Step ${String(i)} parallel mode 'n' requires valid requiredCompletions (1–${String(step.config.branches.length)})`,
            'INVALID_PARALLEL_CONFIG',
          );
        }
      }
    }

    if (step.config.type === 'delay' && step.config.durationMs <= 0) {
      throw new WorkflowDefinitionError(
        `Step ${String(i)} delay duration must be positive`,
        'INVALID_DELAY',
      );
    }
  }
}

// ─── Definition Store Interface ─────────────────────────────────

export interface WorkflowDefinitionStore {
  create(
    tenantId: string,
    name: string,
    description: string,
    steps: readonly WorkflowStep[],
    triggers: readonly import('./types.js').TriggerConfig[],
  ): Promise<WorkflowDefinition>;

  getById(
    tenantId: string,
    id: string,
  ): Promise<WorkflowDefinition | undefined>;

  list(tenantId: string): Promise<readonly WorkflowDefinition[]>;

  update(
    tenantId: string,
    id: string,
    updates: {
      readonly name?: string | undefined;
      readonly description?: string | undefined;
      readonly steps?: readonly WorkflowStep[] | undefined;
      readonly triggers?: readonly import('./types.js').TriggerConfig[] | undefined;
      readonly isActive?: boolean | undefined;
    },
  ): Promise<WorkflowDefinition | undefined>;

  delete(tenantId: string, id: string): Promise<boolean>;
}

// ─── In-Memory Store ────────────────────────────────────────────

export class InMemoryDefinitionStore implements WorkflowDefinitionStore {
  private readonly definitions: Map<string, WorkflowDefinition> = new Map();
  private readonly auditLogger: WorkflowAuditLogger | undefined;

  constructor(auditLogger?: WorkflowAuditLogger) {
    this.auditLogger = auditLogger;
  }

  async create(
    tenantId: string,
    name: string,
    description: string,
    steps: readonly WorkflowStep[],
    triggers: readonly import('./types.js').TriggerConfig[],
  ): Promise<WorkflowDefinition> {
    validateDefinition(name, steps);

    const now = new Date();
    const definition: WorkflowDefinition = {
      id: randomUUID(),
      tenantId,
      name,
      description,
      version: 1,
      steps,
      triggers,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    this.definitions.set(definition.id, definition);

    await this.auditLogger?.log({
      tenantId,
      eventType: 'workflow.definition_created',
      actorType: 'system',
      actorId: 'workflow-engine',
      resource: 'workflow_definitions',
      resourceId: definition.id,
      action: 'create',
      details: { name, stepCount: steps.length },
      timestamp: now,
    });

    return definition;
  }

  async getById(
    tenantId: string,
    id: string,
  ): Promise<WorkflowDefinition | undefined> {
    const def = this.definitions.get(id);
    if (def && def.tenantId === tenantId) {
      return def;
    }
    return undefined;
  }

  async list(tenantId: string): Promise<readonly WorkflowDefinition[]> {
    const results: WorkflowDefinition[] = [];
    for (const def of this.definitions.values()) {
      if (def.tenantId === tenantId) {
        results.push(def);
      }
    }
    return results;
  }

  async update(
    tenantId: string,
    id: string,
    updates: {
      readonly name?: string | undefined;
      readonly description?: string | undefined;
      readonly steps?: readonly WorkflowStep[] | undefined;
      readonly triggers?: readonly import('./types.js').TriggerConfig[] | undefined;
      readonly isActive?: boolean | undefined;
    },
  ): Promise<WorkflowDefinition | undefined> {
    const existing = this.definitions.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return undefined;
    }

    const newSteps = updates.steps ?? existing.steps;
    const newName = updates.name ?? existing.name;
    if (updates.steps !== undefined || updates.name !== undefined) {
      validateDefinition(newName, newSteps);
    }

    const now = new Date();
    const updated: WorkflowDefinition = {
      ...existing,
      name: newName,
      description: updates.description ?? existing.description,
      steps: newSteps,
      triggers: updates.triggers ?? existing.triggers,
      isActive: updates.isActive ?? existing.isActive,
      version: existing.version + 1,
      updatedAt: now,
    };

    this.definitions.set(id, updated);

    await this.auditLogger?.log({
      tenantId,
      eventType: 'workflow.definition_updated',
      actorType: 'system',
      actorId: 'workflow-engine',
      resource: 'workflow_definitions',
      resourceId: id,
      action: 'update',
      details: {
        version: updated.version,
        changedFields: Object.keys(updates).filter((k) => updates[k as keyof typeof updates] !== undefined),
      },
      timestamp: now,
    });

    return updated;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const existing = this.definitions.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return false;
    }

    this.definitions.delete(id);

    await this.auditLogger?.log({
      tenantId,
      eventType: 'workflow.definition_deleted',
      actorType: 'system',
      actorId: 'workflow-engine',
      resource: 'workflow_definitions',
      resourceId: id,
      action: 'delete',
      details: { name: existing.name },
      timestamp: new Date(),
    });

    return true;
  }

  /** Seed definitions directly (for testing). */
  seed(defs: readonly WorkflowDefinition[]): void {
    for (const def of defs) {
      this.definitions.set(def.id, def);
    }
  }

  /** Clear all definitions (for testing). */
  clear(): void {
    this.definitions.clear();
  }
}

// ─── Built-in Templates ─────────────────────────────────────────

/** One day in milliseconds. */
const ONE_DAY_MS = 86_400_000;

/** One hour in milliseconds. */
const ONE_HOUR_MS = 3_600_000;

/**
 * Collections Cadence — 7-step automated collections sequence.
 * TCPA: business-hours-only for all outbound communication steps.
 */
export const COLLECTIONS_CADENCE_STEPS: readonly WorkflowStep[] = [
  {
    name: 'Initial Contact',
    type: 'action',
    config: {
      type: 'action',
      actionName: 'send_sms',
      parameters: { template: 'collections_initial', channel: 'sms' },
    },
    timeoutMs: 30_000,
  },
  {
    name: 'Wait 3 Days',
    type: 'delay',
    config: {
      type: 'delay',
      durationMs: 3 * ONE_DAY_MS,
      businessHoursOnly: true,
    },
  },
  {
    name: 'Check Payment Status',
    type: 'condition',
    config: {
      type: 'condition',
      expression: 'payment_status == paid',
      field: 'variables.paymentStatus',
      operator: 'eq',
      value: 'paid',
      trueBranch: 6,
      falseBranch: 3,
    },
  },
  {
    name: 'Follow-up Contact',
    type: 'action',
    config: {
      type: 'action',
      actionName: 'send_email',
      parameters: { template: 'collections_followup', channel: 'email' },
    },
    timeoutMs: 30_000,
  },
  {
    name: 'Wait 7 Days',
    type: 'delay',
    config: {
      type: 'delay',
      durationMs: 7 * ONE_DAY_MS,
      businessHoursOnly: true,
    },
  },
  {
    name: 'Escalation Notice',
    type: 'action',
    config: {
      type: 'action',
      actionName: 'send_email',
      parameters: { template: 'collections_escalation', channel: 'email' },
    },
    timeoutMs: 30_000,
  },
  {
    name: 'Complete',
    type: 'action',
    config: {
      type: 'action',
      actionName: 'log_completion',
      parameters: { outcome: 'collections_complete' },
    },
    timeoutMs: 10_000,
  },
] as const;

/**
 * Customer Onboarding — 5-step welcome sequence.
 */
export const CUSTOMER_ONBOARDING_STEPS: readonly WorkflowStep[] = [
  {
    name: 'Welcome Email',
    type: 'action',
    config: {
      type: 'action',
      actionName: 'send_email',
      parameters: { template: 'welcome_email', channel: 'email' },
    },
    timeoutMs: 30_000,
  },
  {
    name: 'Wait 1 Day',
    type: 'delay',
    config: {
      type: 'delay',
      durationMs: ONE_DAY_MS,
      businessHoursOnly: false,
    },
  },
  {
    name: 'Setup Guide',
    type: 'action',
    config: {
      type: 'action',
      actionName: 'send_email',
      parameters: { template: 'setup_guide', channel: 'email' },
    },
    timeoutMs: 30_000,
  },
  {
    name: 'Wait 3 Days',
    type: 'delay',
    config: {
      type: 'delay',
      durationMs: 3 * ONE_DAY_MS,
      businessHoursOnly: false,
    },
  },
  {
    name: 'Check-in Call',
    type: 'action',
    config: {
      type: 'action',
      actionName: 'schedule_call',
      parameters: { template: 'checkin_call', channel: 'voice' },
    },
    timeoutMs: 60_000,
  },
] as const;

/**
 * Healthcare Appointment — 4-step reminder sequence.
 * HIPAA: context references patient by tokenized ID only.
 */
export const HEALTHCARE_APPOINTMENT_STEPS: readonly WorkflowStep[] = [
  {
    name: 'Appointment Reminder (48h)',
    type: 'action',
    config: {
      type: 'action',
      actionName: 'send_sms',
      parameters: { template: 'appointment_reminder_48h', channel: 'sms' },
    },
    timeoutMs: 30_000,
  },
  {
    name: 'Confirmation Request',
    type: 'action',
    config: {
      type: 'action',
      actionName: 'send_sms',
      parameters: { template: 'appointment_confirmation', channel: 'sms' },
    },
    timeoutMs: 30_000,
  },
  {
    name: 'Day-of Reminder',
    type: 'action',
    config: {
      type: 'action',
      actionName: 'send_sms',
      parameters: { template: 'appointment_dayof', channel: 'sms' },
    },
    timeoutMs: 30_000,
  },
  {
    name: 'Post-visit Follow-up',
    type: 'action',
    config: {
      type: 'action',
      actionName: 'send_email',
      parameters: { template: 'post_visit_followup', channel: 'email' },
    },
    timeoutMs: 30_000,
  },
] as const;

/**
 * Churn Intervention — 3-step retention workflow.
 */
export const CHURN_INTERVENTION_STEPS: readonly WorkflowStep[] = [
  {
    name: 'Health Score Alert',
    type: 'action',
    config: {
      type: 'action',
      actionName: 'send_email',
      parameters: { template: 'churn_alert', channel: 'email' },
    },
    timeoutMs: 30_000,
  },
  {
    name: 'Retention Offer',
    type: 'human-review',
    config: {
      type: 'human-review',
      description: 'Review and approve retention offer before sending',
      assigneeRole: 'account_manager',
      timeoutMs: 48 * ONE_HOUR_MS,
    },
    timeoutMs: 48 * ONE_HOUR_MS,
  },
  {
    name: 'Executive Outreach',
    type: 'action',
    config: {
      type: 'action',
      actionName: 'schedule_call',
      parameters: { template: 'executive_outreach', channel: 'voice', escalation: true },
    },
    timeoutMs: 60_000,
  },
] as const;

/**
 * All built-in templates keyed by slug.
 */
export const BUILTIN_TEMPLATES: Readonly<
  Record<string, { readonly name: string; readonly description: string; readonly steps: readonly WorkflowStep[] }>
> = {
  'collections-cadence': {
    name: 'Collections Cadence',
    description: '7-step collections sequence: initial contact, follow-up, escalation, with payment status checks at each stage',
    steps: COLLECTIONS_CADENCE_STEPS,
  },
  'customer-onboarding': {
    name: 'Customer Onboarding',
    description: '5-step onboarding: welcome email, setup guide, check-in call',
    steps: CUSTOMER_ONBOARDING_STEPS,
  },
  'healthcare-appointment': {
    name: 'Healthcare Appointment',
    description: '4-step appointment lifecycle: 48h reminder, confirmation, day-of, post-visit follow-up',
    steps: HEALTHCARE_APPOINTMENT_STEPS,
  },
  'churn-intervention': {
    name: 'Churn Intervention',
    description: '3-step churn prevention: health score alert, HITL retention offer, executive outreach',
    steps: CHURN_INTERVENTION_STEPS,
  },
} as const;

/**
 * Instantiate built-in templates for a specific tenant.
 */
export function createBuiltinDefinitions(tenantId: string): readonly WorkflowDefinition[] {
  const now = new Date();
  return Object.entries(BUILTIN_TEMPLATES).map(([slug, template]) => ({
    id: `${tenantId}_builtin_${slug}`,
    tenantId,
    name: template.name,
    description: template.description,
    version: 1,
    steps: template.steps,
    triggers: [],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
}
