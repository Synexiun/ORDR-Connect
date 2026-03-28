/**
 * @ordr/workflow — Drizzle-backed persistence stores
 *
 * Implements WorkflowDefinitionStore, WorkflowInstanceStore, and
 * StepResultStore against PostgreSQL via Drizzle ORM.
 *
 * SOC2 CC7.2 — Workflow state persisted durably in PostgreSQL.
 * ISO 27001 A.12.4.1 — All workflow transitions recorded.
 * HIPAA §164.312(b) — context column is encrypted before write.
 *
 * SECURITY:
 * - context stored as-is; caller MUST encrypt before passing to save()
 * - tenant_id taken from the WorkflowInstance/Definition — NEVER from client
 * - RLS provides database-layer isolation (set via app.tenant_id session var)
 */

import { eq, and, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ordr/db';
import type { WorkflowDefinition, WorkflowInstance, StepResult, WorkflowStatus } from './types.js';
import type { WorkflowDefinitionStore } from './definitions.js';
import type { WorkflowInstanceStore, StepResultStore } from './engine.js';
import type { TriggerConfig, WorkflowStep } from './types.js';

type Db = PostgresJsDatabase<typeof schema>;

// ─── helpers ─────────────────────────────────────────────────────

function rowToDefinition(row: typeof schema.workflowDefinitions.$inferSelect): WorkflowDefinition {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    version: row.version,
    steps: row.steps as readonly WorkflowStep[],
    triggers: row.triggers as readonly TriggerConfig[],
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToInstance(row: typeof schema.workflowInstances.$inferSelect): WorkflowInstance {
  return {
    id: row.id,
    tenantId: row.tenantId,
    definitionId: row.definitionId,
    entityType: row.entityType,
    entityId: row.entityId,
    status: row.status,
    currentStepIndex: row.currentStepIndex,
    context: row.context as WorkflowInstance['context'],
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
    error: row.error ?? null,
  };
}

function rowToStepResult(row: typeof schema.workflowStepResults.$inferSelect): StepResult {
  return {
    id: row.id,
    instanceId: row.instanceId,
    stepIndex: row.stepIndex,
    stepType: row.stepType,
    status: row.status,
    input: row.input as Record<string, unknown>,
    output: row.output as Record<string, unknown>,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
    error: row.error ?? null,
    retryCount: row.retryCount,
  };
}

// ─── DrizzleDefinitionStore ──────────────────────────────────────

export class DrizzleDefinitionStore implements WorkflowDefinitionStore {
  constructor(private readonly db: Db) {}

  async create(
    tenantId: string,
    name: string,
    description: string,
    steps: readonly WorkflowStep[],
    triggers: readonly TriggerConfig[],
  ): Promise<WorkflowDefinition> {
    const [row] = await this.db
      .insert(schema.workflowDefinitions)
      .values({
        tenantId,
        name,
        description,
        steps: steps as unknown as Record<string, unknown>[],
        triggers: triggers as unknown as Record<string, unknown>[],
      })
      .returning();
    if (row === undefined) throw new Error('Insert returned no rows');
    return rowToDefinition(row);
  }

  async getById(tenantId: string, id: string): Promise<WorkflowDefinition | undefined> {
    const rows = await this.db
      .select()
      .from(schema.workflowDefinitions)
      .where(
        and(
          eq(schema.workflowDefinitions.id, id),
          eq(schema.workflowDefinitions.tenantId, tenantId),
        ),
      )
      .limit(1);
    return rows[0] !== undefined ? rowToDefinition(rows[0]) : undefined;
  }

  async list(tenantId: string): Promise<readonly WorkflowDefinition[]> {
    const rows = await this.db
      .select()
      .from(schema.workflowDefinitions)
      .where(eq(schema.workflowDefinitions.tenantId, tenantId));
    return rows.map(rowToDefinition);
  }

  async update(
    tenantId: string,
    id: string,
    updates: {
      readonly name?: string;
      readonly description?: string;
      readonly steps?: readonly WorkflowStep[];
      readonly triggers?: readonly TriggerConfig[];
      readonly isActive?: boolean;
    },
  ): Promise<WorkflowDefinition | undefined> {
    const patch: Partial<typeof schema.workflowDefinitions.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.steps !== undefined)
      patch.steps = updates.steps as unknown as Record<string, unknown>[];
    if (updates.triggers !== undefined)
      patch.triggers = updates.triggers as unknown as Record<string, unknown>[];
    if (updates.isActive !== undefined) patch.isActive = updates.isActive;

    const rows = await this.db
      .update(schema.workflowDefinitions)
      .set(patch)
      .where(
        and(
          eq(schema.workflowDefinitions.id, id),
          eq(schema.workflowDefinitions.tenantId, tenantId),
        ),
      )
      .returning();
    return rows[0] !== undefined ? rowToDefinition(rows[0]) : undefined;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.workflowDefinitions)
      .where(
        and(
          eq(schema.workflowDefinitions.id, id),
          eq(schema.workflowDefinitions.tenantId, tenantId),
        ),
      )
      .returning({ id: schema.workflowDefinitions.id });
    return rows.length > 0;
  }
}

// ─── DrizzleInstanceStore ────────────────────────────────────────

export class DrizzleInstanceStore implements WorkflowInstanceStore {
  constructor(private readonly db: Db) {}

  async save(instance: WorkflowInstance): Promise<void> {
    await this.db
      .insert(schema.workflowInstances)
      .values({
        id: instance.id,
        tenantId: instance.tenantId,
        definitionId: instance.definitionId,
        entityType: instance.entityType,
        entityId: instance.entityId,
        status: instance.status,
        currentStepIndex: instance.currentStepIndex,
        context: instance.context as unknown as Record<string, unknown>,
        startedAt: instance.startedAt,
        completedAt: instance.completedAt,
        error: instance.error,
      })
      .onConflictDoUpdate({
        target: schema.workflowInstances.id,
        set: {
          status: instance.status,
          currentStepIndex: instance.currentStepIndex,
          context: instance.context as unknown as Record<string, unknown>,
          completedAt: instance.completedAt,
          error: instance.error,
        },
      });
  }

  async getById(tenantId: string, id: string): Promise<WorkflowInstance | undefined> {
    const rows = await this.db
      .select()
      .from(schema.workflowInstances)
      .where(
        and(eq(schema.workflowInstances.id, id), eq(schema.workflowInstances.tenantId, tenantId)),
      )
      .limit(1);
    return rows[0] !== undefined ? rowToInstance(rows[0]) : undefined;
  }

  async list(
    tenantId: string,
    filters?: {
      readonly status?: WorkflowStatus;
      readonly entityType?: string;
      readonly entityId?: string;
      readonly definitionId?: string;
    },
  ): Promise<readonly WorkflowInstance[]> {
    const conditions: SQL[] = [eq(schema.workflowInstances.tenantId, tenantId)];
    if (filters?.status !== undefined)
      conditions.push(eq(schema.workflowInstances.status, filters.status));
    if (filters?.entityType !== undefined)
      conditions.push(eq(schema.workflowInstances.entityType, filters.entityType));
    if (filters?.entityId !== undefined)
      conditions.push(eq(schema.workflowInstances.entityId, filters.entityId));
    if (filters?.definitionId !== undefined)
      conditions.push(eq(schema.workflowInstances.definitionId, filters.definitionId));

    const rows = await this.db
      .select()
      .from(schema.workflowInstances)
      .where(and(...conditions));
    return rows.map(rowToInstance);
  }

  async findByEntity(
    tenantId: string,
    entityType: string,
    entityId: string,
    definitionId: string,
  ): Promise<WorkflowInstance | undefined> {
    const rows = await this.db
      .select()
      .from(schema.workflowInstances)
      .where(
        and(
          eq(schema.workflowInstances.tenantId, tenantId),
          eq(schema.workflowInstances.entityType, entityType),
          eq(schema.workflowInstances.entityId, entityId),
          eq(schema.workflowInstances.definitionId, definitionId),
        ),
      )
      .limit(1);
    return rows[0] !== undefined ? rowToInstance(rows[0]) : undefined;
  }
}

// ─── DrizzleStepResultStore ──────────────────────────────────────

export class DrizzleStepResultStore implements StepResultStore {
  constructor(private readonly db: Db) {}

  async save(result: StepResult): Promise<void> {
    await this.db
      .insert(schema.workflowStepResults)
      .values({
        id: result.id,
        instanceId: result.instanceId,
        stepIndex: result.stepIndex,
        stepType: result.stepType,
        status: result.status,
        input: result.input as unknown as Record<string, unknown>,
        output: result.output as unknown as Record<string, unknown>,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        error: result.error,
        retryCount: result.retryCount,
      })
      .onConflictDoUpdate({
        target: schema.workflowStepResults.id,
        set: {
          status: result.status,
          output: result.output as unknown as Record<string, unknown>,
          completedAt: result.completedAt,
          error: result.error,
          retryCount: result.retryCount,
        },
      });
  }

  async getByInstance(instanceId: string): Promise<readonly StepResult[]> {
    const rows = await this.db
      .select()
      .from(schema.workflowStepResults)
      .where(eq(schema.workflowStepResults.instanceId, instanceId));
    return rows.map(rowToStepResult);
  }
}
