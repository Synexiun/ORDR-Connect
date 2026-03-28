/**
 * @ordr/scheduler — Drizzle-backed SchedulerStore
 *
 * Implements the full SchedulerStore interface against PostgreSQL.
 * tryLock uses an atomic UPDATE WHERE locked_by IS NULL to prevent
 * duplicate execution across multiple scheduler instances.
 *
 * SOC2 CC7.1 — Durable job state survives process restarts.
 * ISO 27001 A.12.4.1 — All job state transitions recorded in DB.
 * HIPAA §164.312(b) — Payloads MUST NOT contain PHI (caller responsibility).
 *
 * SECURITY:
 * - tryLock is atomic: only one scheduler can acquire the lock per instance
 * - Stale locks (lockedAt > staleLockTimeoutMs ago) are released by the caller
 * - No PHI stored — payloads are operational metadata only
 */

import { eq, and, isNull, lte, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ordr/db';
import type {
  JobDefinition,
  JobInstance,
  JobStatus,
  DeadLetterEntry,
  JobPriority,
  RetryPolicy,
} from './types.js';
import type { SchedulerStore } from './scheduler.js';

type Db = PostgresJsDatabase<typeof schema>;

// ─── Priority rank for ORDER BY ──────────────────────────────────

const PRIORITY_ORDER: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// ─── Row mappers ─────────────────────────────────────────────────

function rowToDefinition(row: typeof schema.jobDefinitions.$inferSelect): JobDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    cronExpression: row.cronExpression as JobDefinition['cronExpression'],
    jobType: row.jobType,
    payloadTemplate: row.payloadTemplate as Record<string, unknown>,
    isActive: row.isActive,
    priority: row.priority,
    retryPolicy: row.retryPolicy as RetryPolicy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToInstance(row: typeof schema.jobInstances.$inferSelect): JobInstance {
  return {
    id: row.id,
    definitionId: row.definitionId,
    tenantId: row.tenantId ?? null,
    status: row.status,
    payload: row.payload as Record<string, unknown>,
    result: row.result !== null ? (row.result as Record<string, unknown>) : null,
    error: row.error ?? null,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    nextRetryAt: row.nextRetryAt ?? null,
    retryCount: row.retryCount,
    lockedBy: row.lockedBy ?? null,
    lockedAt: row.lockedAt ?? null,
    createdAt: row.createdAt,
  };
}

function rowToDeadLetter(row: typeof schema.jobDeadLetters.$inferSelect): DeadLetterEntry {
  return {
    id: row.id,
    jobInstanceId: row.jobInstanceId,
    definitionId: row.definitionId,
    error: row.error,
    payload: row.payload as Record<string, unknown>,
    failedAt: row.failedAt,
  };
}

// ─── DrizzleSchedulerStore ───────────────────────────────────────

export class DrizzleSchedulerStore implements SchedulerStore {
  constructor(private readonly db: Db) {}

  // ── Definitions ──────────────────────────────────────────────

  async saveDefinition(definition: JobDefinition): Promise<void> {
    await this.db
      .insert(schema.jobDefinitions)
      .values({
        id: definition.id,
        name: definition.name,
        description: definition.description,
        cronExpression: definition.cronExpression,
        jobType: definition.jobType,
        payloadTemplate: definition.payloadTemplate,
        isActive: definition.isActive,
        priority: definition.priority,
        retryPolicy: definition.retryPolicy as unknown as Record<string, unknown>,
        createdAt: definition.createdAt,
        updatedAt: definition.updatedAt,
      })
      .onConflictDoUpdate({
        target: schema.jobDefinitions.id,
        set: {
          name: definition.name,
          description: definition.description,
          cronExpression: definition.cronExpression,
          jobType: definition.jobType,
          payloadTemplate: definition.payloadTemplate,
          isActive: definition.isActive,
          priority: definition.priority,
          retryPolicy: definition.retryPolicy as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });
  }

  async getDefinition(id: string): Promise<JobDefinition | null> {
    const rows = await this.db
      .select()
      .from(schema.jobDefinitions)
      .where(eq(schema.jobDefinitions.id, id))
      .limit(1);
    return rows[0] !== undefined ? rowToDefinition(rows[0]) : null;
  }

  async getActiveDefinitions(): Promise<JobDefinition[]> {
    const rows = await this.db
      .select()
      .from(schema.jobDefinitions)
      .where(eq(schema.jobDefinitions.isActive, true));
    return rows.map(rowToDefinition);
  }

  async listDefinitions(): Promise<JobDefinition[]> {
    const rows = await this.db.select().from(schema.jobDefinitions);
    return rows.map(rowToDefinition);
  }

  async disableDefinition(id: string): Promise<void> {
    await this.db
      .update(schema.jobDefinitions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(schema.jobDefinitions.id, id));
  }

  // ── Instances ────────────────────────────────────────────────

  async createInstance(instance: JobInstance): Promise<void> {
    await this.db.insert(schema.jobInstances).values({
      id: instance.id,
      definitionId: instance.definitionId,
      tenantId: instance.tenantId,
      status: instance.status,
      payload: instance.payload,
      result: instance.result,
      error: instance.error,
      startedAt: instance.startedAt,
      completedAt: instance.completedAt,
      nextRetryAt: instance.nextRetryAt,
      retryCount: instance.retryCount,
      lockedBy: instance.lockedBy,
      lockedAt: instance.lockedAt,
      createdAt: instance.createdAt,
    });
  }

  async updateInstance(instance: JobInstance): Promise<void> {
    await this.db
      .update(schema.jobInstances)
      .set({
        status: instance.status,
        result: instance.result,
        error: instance.error,
        startedAt: instance.startedAt,
        completedAt: instance.completedAt,
        nextRetryAt: instance.nextRetryAt,
        retryCount: instance.retryCount,
        lockedBy: instance.lockedBy,
        lockedAt: instance.lockedAt,
      })
      .where(eq(schema.jobInstances.id, instance.id));
  }

  async getInstance(id: string): Promise<JobInstance | null> {
    const rows = await this.db
      .select()
      .from(schema.jobInstances)
      .where(eq(schema.jobInstances.id, id))
      .limit(1);
    return rows[0] !== undefined ? rowToInstance(rows[0]) : null;
  }

  async getDueInstances(now: Date): Promise<JobInstance[]> {
    // Due = pending + not locked + createdAt <= now
    // Returns all candidates; caller uses tryLock to acquire exclusive access.
    const rows = await this.db
      .select()
      .from(schema.jobInstances)
      .where(
        and(
          eq(schema.jobInstances.status, 'pending'),
          isNull(schema.jobInstances.lockedBy),
          lte(schema.jobInstances.createdAt, now),
        ),
      );

    // Sort by priority rank in-process (avoids JOIN to definitions table)
    const mapped = rows.map(rowToInstance);
    mapped.sort((a: JobInstance, b: JobInstance) => {
      const aDef = a.payload['__priority'] as JobPriority | undefined;
      const bDef = b.payload['__priority'] as JobPriority | undefined;
      const aRank = PRIORITY_ORDER[aDef ?? 'normal'];
      const bRank = PRIORITY_ORDER[bDef ?? 'normal'];
      return aRank - bRank;
    });
    return mapped;
  }

  async listInstances(filter?: {
    readonly status?: JobStatus;
    readonly jobType?: string;
  }): Promise<JobInstance[]> {
    const conditions: SQL[] = [];
    if (filter?.status !== undefined)
      conditions.push(eq(schema.jobInstances.status, filter.status));

    const rows =
      conditions.length > 0
        ? await this.db
            .select()
            .from(schema.jobInstances)
            .where(and(...conditions))
        : await this.db.select().from(schema.jobInstances);

    return rows.map(rowToInstance);
  }

  async getRetryableInstances(now: Date): Promise<JobInstance[]> {
    const rows = await this.db
      .select()
      .from(schema.jobInstances)
      .where(
        and(
          eq(schema.jobInstances.status, 'retrying'),
          lte(schema.jobInstances.nextRetryAt, now),
          isNull(schema.jobInstances.lockedBy),
        ),
      );
    return rows.map(rowToInstance);
  }

  // ── Advisory Locking ─────────────────────────────────────────

  /**
   * Atomically acquire the lock on a job instance.
   *
   * Uses UPDATE WHERE locked_by IS NULL — PostgreSQL evaluates this atomically
   * so only one scheduler instance wins the race. Returns true only if this
   * call made the UPDATE (rowCount = 1).
   */
  async tryLock(instanceId: string, lockedBy: string, now: Date): Promise<boolean> {
    const result = await this.db
      .update(schema.jobInstances)
      .set({ lockedBy, lockedAt: now })
      .where(and(eq(schema.jobInstances.id, instanceId), isNull(schema.jobInstances.lockedBy)))
      .returning({ id: schema.jobInstances.id });
    return result.length > 0;
  }

  async releaseLock(instanceId: string, lockedBy: string): Promise<void> {
    await this.db
      .update(schema.jobInstances)
      .set({ lockedBy: null, lockedAt: null })
      .where(
        and(eq(schema.jobInstances.id, instanceId), eq(schema.jobInstances.lockedBy, lockedBy)),
      );
  }

  // ── Dead Letters ─────────────────────────────────────────────

  async addToDeadLetter(entry: DeadLetterEntry): Promise<void> {
    await this.db.insert(schema.jobDeadLetters).values({
      id: entry.id,
      jobInstanceId: entry.jobInstanceId,
      definitionId: entry.definitionId,
      error: entry.error,
      payload: entry.payload,
      failedAt: entry.failedAt,
    });
  }

  async listDeadLetter(): Promise<DeadLetterEntry[]> {
    const rows = await this.db.select().from(schema.jobDeadLetters);
    return rows.map(rowToDeadLetter);
  }

  async getDeadLetterEntry(id: string): Promise<DeadLetterEntry | null> {
    const rows = await this.db
      .select()
      .from(schema.jobDeadLetters)
      .where(eq(schema.jobDeadLetters.id, id))
      .limit(1);
    return rows[0] !== undefined ? rowToDeadLetter(rows[0]) : null;
  }

  async removeDeadLetterEntry(id: string): Promise<void> {
    await this.db.delete(schema.jobDeadLetters).where(eq(schema.jobDeadLetters.id, id));
  }
}
