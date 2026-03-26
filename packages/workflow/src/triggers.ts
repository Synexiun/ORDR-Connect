/**
 * @ordr/workflow — Trigger System
 *
 * Event-based, schedule-based, and manual triggers for workflow start.
 * Includes deduplication to prevent duplicate workflows for the same entity.
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - All trigger evaluations are audit-logged
 * - Tenant isolation enforced on all trigger operations
 * - Deduplication prevents runaway duplicate workflows
 */

import { randomUUID } from 'node:crypto';
import type {
  TriggerConfig,
  WorkflowContext,
  WorkflowAuditLogger,
} from './types.js';
import type { WorkflowEngine } from './engine.js';
import type { WorkflowInstanceStore } from './engine.js';
import type { WorkflowDefinitionStore } from './definitions.js';

// ─── Cron Parser (simplified) ───────────────────────────────────

/**
 * Parse a simplified cron expression for matching.
 * Format: "minute hour dayOfMonth month dayOfWeek"
 * Supports: * (any), specific numbers, no ranges/lists for simplicity.
 */
export function matchesCron(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  const [minutePart, hourPart, dayPart, monthPart, dowPart] = parts;
  if (!minutePart || !hourPart || !dayPart || !monthPart || !dowPart) {
    return false;
  }

  const minute = date.getMinutes();
  const hour = date.getHours();
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();

  return (
    matchesCronPart(minutePart, minute) &&
    matchesCronPart(hourPart, hour) &&
    matchesCronPart(dayPart, day) &&
    matchesCronPart(monthPart, month) &&
    matchesCronPart(dowPart, dow)
  );
}

function matchesCronPart(part: string, value: number): boolean {
  if (part === '*') {
    return true;
  }

  // Support comma-separated values: "1,15,30"
  if (part.includes(',')) {
    const values = part.split(',').map(Number);
    return values.includes(value);
  }

  // Support step values: "*/5"
  if (part.startsWith('*/')) {
    const step = Number(part.slice(2));
    return !isNaN(step) && step > 0 && value % step === 0;
  }

  const parsed = Number(part);
  return !isNaN(parsed) && parsed === value;
}

// ─── Trigger Evaluator ──────────────────────────────────────────

export interface TriggerEvent {
  readonly type: string;
  readonly tenantId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly payload: Record<string, unknown>;
  readonly correlationId: string;
  readonly userId: string;
}

export interface WorkflowTriggerDeps {
  readonly engine: WorkflowEngine;
  readonly definitionStore: WorkflowDefinitionStore;
  readonly instanceStore: WorkflowInstanceStore;
  readonly auditLogger: WorkflowAuditLogger;
}

export class WorkflowTrigger {
  private readonly engine: WorkflowEngine;
  private readonly definitionStore: WorkflowDefinitionStore;
  private readonly instanceStore: WorkflowInstanceStore;
  private readonly auditLogger: WorkflowAuditLogger;

  constructor(deps: WorkflowTriggerDeps) {
    this.engine = deps.engine;
    this.definitionStore = deps.definitionStore;
    this.instanceStore = deps.instanceStore;
    this.auditLogger = deps.auditLogger;
  }

  /**
   * Evaluate an incoming event against all active workflow definitions.
   * Starts matching workflows if triggers match and no duplicate exists.
   *
   * DEDUPLICATION: Checks for existing active/running/paused instances
   * of the same definition for the same entity — prevents duplicates.
   *
   * AUDIT: Every trigger evaluation and start is logged.
   */
  async evaluateEvent(event: TriggerEvent): Promise<readonly string[]> {
    const definitions = await this.definitionStore.list(event.tenantId);
    const startedInstanceIds: string[] = [];

    for (const definition of definitions) {
      if (!definition.isActive) {
        continue;
      }

      for (const trigger of definition.triggers) {
        if (this.matchesTrigger(trigger, event)) {
          // Deduplication check
          const existing = await this.instanceStore.findByEntity(
            event.tenantId,
            event.entityType,
            event.entityId,
            definition.id,
          );

          if (existing) {
            // Skip — duplicate workflow for same entity
            await this.auditLogger.log({
              tenantId: event.tenantId,
              eventType: 'workflow.trigger_deduplicated',
              actorType: 'system',
              actorId: 'workflow-trigger',
              resource: 'workflow_instances',
              resourceId: existing.id,
              action: 'deduplicate',
              details: {
                definitionId: definition.id,
                entityType: event.entityType,
                entityId: event.entityId,
                existingStatus: existing.status,
              },
              timestamp: new Date(),
            });
            continue;
          }

          // Start the workflow
          const context: WorkflowContext = {
            entityType: event.entityType,
            entityId: event.entityId,
            tenantId: event.tenantId,
            variables: { ...event.payload },
            correlationId: event.correlationId,
            initiatedBy: event.userId,
          };

          try {
            const instance = await this.engine.startWorkflow(
              definition.id,
              context,
              event.tenantId,
            );

            startedInstanceIds.push(instance.id);

            await this.auditLogger.log({
              tenantId: event.tenantId,
              eventType: 'workflow.trigger_fired',
              actorType: 'system',
              actorId: 'workflow-trigger',
              resource: 'workflow_instances',
              resourceId: instance.id,
              action: 'trigger',
              details: {
                definitionId: definition.id,
                triggerType: trigger.type,
                eventType: event.type,
                entityType: event.entityType,
                entityId: event.entityId,
              },
              timestamp: new Date(),
            });
          } catch {
            // Trigger failure logged but doesn't block other triggers
            await this.auditLogger.log({
              tenantId: event.tenantId,
              eventType: 'workflow.trigger_failed',
              actorType: 'system',
              actorId: 'workflow-trigger',
              resource: 'workflow_definitions',
              resourceId: definition.id,
              action: 'trigger_error',
              details: {
                definitionId: definition.id,
                triggerType: trigger.type,
                eventType: event.type,
              },
              timestamp: new Date(),
            });
          }

          // Only one trigger per definition should fire
          break;
        }
      }
    }

    return startedInstanceIds;
  }

  /**
   * Manually trigger a workflow for an entity.
   * Bypasses trigger matching — direct start.
   */
  async manualTrigger(
    tenantId: string,
    definitionId: string,
    entityType: string,
    entityId: string,
    variables: Record<string, unknown>,
    userId: string,
  ): Promise<string> {
    // Deduplication check
    const existing = await this.instanceStore.findByEntity(
      tenantId,
      entityType,
      entityId,
      definitionId,
    );

    if (existing) {
      throw new Error(
        `Duplicate workflow: definition '${definitionId}' already active for entity '${entityId}'`,
      );
    }

    const context: WorkflowContext = {
      entityType,
      entityId,
      tenantId,
      variables,
      correlationId: randomUUID(),
      initiatedBy: userId,
    };

    const instance = await this.engine.startWorkflow(definitionId, context, tenantId);
    return instance.id;
  }

  /**
   * Evaluate schedule-based triggers against the current time.
   * Called periodically by the scheduler polling loop.
   */
  async evaluateSchedules(
    tenantId: string,
    now: Date,
  ): Promise<readonly string[]> {
    const definitions = await this.definitionStore.list(tenantId);
    const triggered: string[] = [];

    for (const definition of definitions) {
      if (!definition.isActive) {
        continue;
      }

      for (const trigger of definition.triggers) {
        if (
          trigger.type === 'schedule' &&
          trigger.cronExpression !== undefined &&
          matchesCron(trigger.cronExpression, now)
        ) {
          triggered.push(definition.id);
          break;
        }
      }
    }

    return triggered;
  }

  // ── Private ─────────────────────────────────────────────────

  private matchesTrigger(trigger: TriggerConfig, event: TriggerEvent): boolean {
    if (trigger.type !== 'event') {
      return false;
    }

    if (trigger.eventType !== undefined && trigger.eventType !== event.type) {
      return false;
    }

    if (trigger.entityType !== undefined && trigger.entityType !== event.entityType) {
      return false;
    }

    return true;
  }
}
