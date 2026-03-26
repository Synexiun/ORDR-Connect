/**
 * @ordr/scheduler — Job Scheduler
 *
 * SOC2 CC7.1 — Monitoring: automated compliance and health checks.
 * SOC2 CC7.2 — Monitoring: detection and alerting for system issues.
 * ISO 27001 A.12.4.1 — Event logging for all automated operations.
 * HIPAA §164.312(b) — Audit controls on system-level scheduled tasks.
 *
 * Features:
 * - Cron-based recurring job scheduling
 * - One-time job scheduling
 * - PostgreSQL advisory lock simulation (prevents duplicate execution)
 * - Exponential backoff retry with configurable policy
 * - Priority queue (critical jobs execute first)
 * - Dead letter queue for permanently failed jobs
 * - Graceful shutdown (finish running, stop polling)
 * - Full audit logging of all state changes
 */

import { randomUUID } from 'node:crypto';
import type {
  JobDefinition,
  JobInstance,
  JobStatus,
  JobResult,
  JobHandler,
  JobPriority,
  RetryPolicy,
  DeadLetterEntry,
  SchedulerConfig,
  SchedulerStatus,
  CronExpression,
} from './types.js';
import {
  DEFAULT_RETRY_POLICY,
  DEFAULT_SCHEDULER_CONFIG,
  PRIORITY_RANK,
} from './types.js';
import { parseCron, nextOccurrence } from './cron-parser.js';

// ─── Store Interface ─────────────────────────────────────────────

/**
 * Storage adapter for the scheduler.
 * Decouples persistence — implementations can use PostgreSQL, in-memory, etc.
 */
export interface SchedulerStore {
  /** Save or update a job definition. */
  saveDefinition(definition: JobDefinition): Promise<void>;
  /** Get a job definition by ID. */
  getDefinition(id: string): Promise<JobDefinition | null>;
  /** Get all active job definitions. */
  getActiveDefinitions(): Promise<JobDefinition[]>;
  /** List all job definitions. */
  listDefinitions(): Promise<JobDefinition[]>;
  /** Disable a job definition (set isActive = false). */
  disableDefinition(id: string): Promise<void>;

  /** Create a new job instance. */
  createInstance(instance: JobInstance): Promise<void>;
  /** Update an existing job instance. */
  updateInstance(instance: JobInstance): Promise<void>;
  /** Get a job instance by ID. */
  getInstance(id: string): Promise<JobInstance | null>;
  /** Get due instances (pending + due time, ordered by priority). */
  getDueInstances(now: Date): Promise<JobInstance[]>;
  /** Get instances with optional status filter. */
  listInstances(filter?: { readonly status?: JobStatus; readonly jobType?: string }): Promise<JobInstance[]>;
  /** Get retryable instances (status='retrying', nextRetryAt <= now). */
  getRetryableInstances(now: Date): Promise<JobInstance[]>;

  /**
   * Try to acquire an advisory lock for a job instance.
   * Returns true if this instance successfully locked the job.
   * MUST be atomic to prevent duplicate execution in multi-instance deployments.
   */
  tryLock(instanceId: string, lockedBy: string, now: Date): Promise<boolean>;
  /** Release a lock held by this scheduler instance. */
  releaseLock(instanceId: string, lockedBy: string): Promise<void>;

  /** Add a job to the dead letter queue. */
  addToDeadLetter(entry: DeadLetterEntry): Promise<void>;
  /** List dead letter entries. */
  listDeadLetter(): Promise<DeadLetterEntry[]>;
  /** Get a dead letter entry by ID. */
  getDeadLetterEntry(id: string): Promise<DeadLetterEntry | null>;
  /** Remove a dead letter entry (after retry). */
  removeDeadLetterEntry(id: string): Promise<void>;
}

// ─── Audit Callback ──────────────────────────────────────────────

/**
 * Audit logger callback for scheduler state changes.
 * Every state change MUST be logged for SOC2/ISO27001/HIPAA compliance.
 */
export type SchedulerAuditLogger = (entry: {
  readonly eventType: string;
  readonly resource: string;
  readonly resourceId: string;
  readonly action: string;
  readonly details: Record<string, unknown>;
  readonly timestamp: Date;
}) => Promise<void>;

// ─── Alert Callback ──────────────────────────────────────────────

/**
 * Alert callback for critical job failures.
 * Dead-lettered critical jobs trigger P1 alerts.
 */
export type SchedulerAlertCallback = (alert: {
  readonly severity: 'p1' | 'p2' | 'p3';
  readonly jobType: string;
  readonly instanceId: string;
  readonly error: string;
  readonly timestamp: Date;
}) => Promise<void>;

// ─── In-Memory Store (for testing) ───────────────────────────────

export class InMemorySchedulerStore implements SchedulerStore {
  private readonly definitions = new Map<string, JobDefinition>();
  private readonly instances = new Map<string, JobInstance>();
  private readonly deadLetter = new Map<string, DeadLetterEntry>();
  private readonly locks = new Map<string, string>(); // instanceId -> lockedBy

  async saveDefinition(definition: JobDefinition): Promise<void> {
    this.definitions.set(definition.id, definition);
  }

  async getDefinition(id: string): Promise<JobDefinition | null> {
    return this.definitions.get(id) ?? null;
  }

  async getActiveDefinitions(): Promise<JobDefinition[]> {
    return [...this.definitions.values()].filter((d) => d.isActive);
  }

  async listDefinitions(): Promise<JobDefinition[]> {
    return [...this.definitions.values()];
  }

  async disableDefinition(id: string): Promise<void> {
    const def = this.definitions.get(id);
    if (def) {
      this.definitions.set(id, { ...def, isActive: false, updatedAt: new Date() });
    }
  }

  async createInstance(instance: JobInstance): Promise<void> {
    this.instances.set(instance.id, instance);
  }

  async updateInstance(instance: JobInstance): Promise<void> {
    this.instances.set(instance.id, instance);
  }

  async getInstance(id: string): Promise<JobInstance | null> {
    return this.instances.get(id) ?? null;
  }

  async getDueInstances(now: Date): Promise<JobInstance[]> {
    return [...this.instances.values()]
      .filter((i) => i.status === 'pending' && i.createdAt.getTime() <= now.getTime())
      .sort((a, b) => {
        // Sort by priority (lower rank = higher priority)
        const aDef = this.definitions.get(a.definitionId);
        const bDef = this.definitions.get(b.definitionId);
        const aPriority = aDef ? PRIORITY_RANK[aDef.priority] : PRIORITY_RANK.normal;
        const bPriority = bDef ? PRIORITY_RANK[bDef.priority] : PRIORITY_RANK.normal;
        if (aPriority !== bPriority) return aPriority - bPriority;
        // Then by creation time (oldest first)
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
  }

  async listInstances(filter?: { readonly status?: JobStatus; readonly jobType?: string }): Promise<JobInstance[]> {
    let results = [...this.instances.values()];
    if (filter?.status) {
      results = results.filter((i) => i.status === filter.status);
    }
    if (filter?.jobType) {
      const defsOfType = [...this.definitions.values()].filter((d) => d.jobType === filter.jobType);
      const defIds = new Set(defsOfType.map((d) => d.id));
      results = results.filter((i) => defIds.has(i.definitionId));
    }
    return results;
  }

  async getRetryableInstances(now: Date): Promise<JobInstance[]> {
    return [...this.instances.values()].filter(
      (i) =>
        i.status === 'retrying' &&
        i.nextRetryAt !== null &&
        i.nextRetryAt.getTime() <= now.getTime(),
    );
  }

  async tryLock(instanceId: string, lockedBy: string, _now: Date): Promise<boolean> {
    const existing = this.locks.get(instanceId);
    if (existing !== undefined) return false;
    this.locks.set(instanceId, lockedBy);
    const instance = this.instances.get(instanceId);
    if (instance) {
      this.instances.set(instanceId, { ...instance, lockedBy, lockedAt: new Date() });
    }
    return true;
  }

  async releaseLock(instanceId: string, lockedBy: string): Promise<void> {
    const existing = this.locks.get(instanceId);
    if (existing === lockedBy) {
      this.locks.delete(instanceId);
      const instance = this.instances.get(instanceId);
      if (instance) {
        this.instances.set(instanceId, { ...instance, lockedBy: null, lockedAt: null });
      }
    }
  }

  async addToDeadLetter(entry: DeadLetterEntry): Promise<void> {
    this.deadLetter.set(entry.id, entry);
  }

  async listDeadLetter(): Promise<DeadLetterEntry[]> {
    return [...this.deadLetter.values()];
  }

  async getDeadLetterEntry(id: string): Promise<DeadLetterEntry | null> {
    return this.deadLetter.get(id) ?? null;
  }

  async removeDeadLetterEntry(id: string): Promise<void> {
    this.deadLetter.delete(id);
  }
}

// ─── Job Scheduler ───────────────────────────────────────────────

export class JobScheduler {
  private readonly store: SchedulerStore;
  private readonly config: SchedulerConfig;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly auditLog: SchedulerAuditLogger;
  private readonly alert: SchedulerAlertCallback;

  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private activeJobs = 0;
  private startedAt: Date | null = null;
  private lastPollAt: Date | null = null;

  constructor(
    store: SchedulerStore,
    auditLog: SchedulerAuditLogger,
    alert: SchedulerAlertCallback,
    config?: Partial<SchedulerConfig>,
  ) {
    this.store = store;
    this.auditLog = auditLog;
    this.alert = alert;
    this.config = {
      ...DEFAULT_SCHEDULER_CONFIG,
      ...config,
    };
  }

  // ─── Job Registration ──────────────────────────────────────────

  /**
   * Register a job handler with a cron schedule.
   * Creates the job definition in the store and registers the handler function.
   */
  async registerJob(definition: Omit<JobDefinition, 'createdAt' | 'updatedAt'>, handler: JobHandler): Promise<void> {
    const now = new Date();
    const fullDef: JobDefinition = {
      ...definition,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.saveDefinition(fullDef);
    this.handlers.set(definition.jobType, handler);

    await this.auditLog({
      eventType: 'system.config_change',
      resource: 'job_definition',
      resourceId: definition.id,
      action: 'register',
      details: {
        jobType: definition.jobType,
        cronExpression: definition.cronExpression,
        priority: definition.priority,
      },
      timestamp: now,
    });
  }

  /**
   * Schedule a one-time job for a specific time.
   */
  async scheduleOnce(
    jobType: string,
    payload: Record<string, unknown>,
    runAt: Date,
    options?: { readonly tenantId?: string; readonly priority?: JobPriority },
  ): Promise<string> {
    const now = new Date();
    const instanceId = randomUUID();

    // Find or create a definition for this job type
    const definitions = await this.store.listDefinitions();
    let definition = definitions.find((d) => d.jobType === jobType);

    if (!definition) {
      // Create an ad-hoc definition for one-time jobs
      definition = {
        id: `adhoc-${randomUUID()}`,
        name: `Ad-hoc ${jobType}`,
        description: `One-time scheduled ${jobType} job`,
        cronExpression: null,
        jobType,
        payloadTemplate: {},
        isActive: true,
        priority: options?.priority ?? 'normal',
        retryPolicy: DEFAULT_RETRY_POLICY,
        createdAt: now,
        updatedAt: now,
      };
      await this.store.saveDefinition(definition);
    }

    const instance: JobInstance = {
      id: instanceId,
      definitionId: definition.id,
      tenantId: options?.tenantId ?? null,
      status: 'pending',
      payload,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      nextRetryAt: null,
      retryCount: 0,
      lockedBy: null,
      lockedAt: null,
      createdAt: runAt,
    };

    await this.store.createInstance(instance);

    await this.auditLog({
      eventType: 'system.config_change',
      resource: 'job_instance',
      resourceId: instanceId,
      action: 'schedule_once',
      details: {
        jobType,
        runAt: runAt.toISOString(),
        tenantId: options?.tenantId ?? 'system',
      },
      timestamp: now,
    });

    return instanceId;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────

  /**
   * Start the scheduler polling loop.
   * Checks for due jobs every `pollIntervalMs`.
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.startedAt = new Date();

    await this.auditLog({
      eventType: 'system.config_change',
      resource: 'scheduler',
      resourceId: this.config.instanceId,
      action: 'start',
      details: {
        pollIntervalMs: this.config.pollIntervalMs,
        maxConcurrentJobs: this.config.maxConcurrentJobs,
      },
      timestamp: this.startedAt,
    });

    // Create initial instances for cron jobs
    await this.scheduleCronJobs();

    // Start polling
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.config.pollIntervalMs);

    // Run first poll immediately
    await this.poll();
  }

  /**
   * Graceful shutdown — stop polling, wait for running jobs to finish.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for active jobs to complete (with timeout)
    const maxWait = 30_000; // 30 seconds
    const start = Date.now();
    while (this.activeJobs > 0 && Date.now() - start < maxWait) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }

    await this.auditLog({
      eventType: 'system.config_change',
      resource: 'scheduler',
      resourceId: this.config.instanceId,
      action: 'stop',
      details: {
        activeJobsAtShutdown: this.activeJobs,
        uptime: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
      },
      timestamp: new Date(),
    });
  }

  // ─── Status ────────────────────────────────────────────────────

  /**
   * Get current scheduler status.
   */
  async getStatus(): Promise<SchedulerStatus> {
    const definitions = await this.store.getActiveDefinitions();
    const now = new Date();

    const nextScheduled: Array<{
      readonly definitionId: string;
      readonly jobType: string;
      readonly nextRunAt: Date;
    }> = [];

    for (const def of definitions) {
      if (def.cronExpression !== null) {
        const parsed = parseCron(def.cronExpression);
        const next = nextOccurrence(parsed, now);
        if (next !== null) {
          nextScheduled.push({
            definitionId: def.id,
            jobType: def.jobType,
            nextRunAt: next,
          });
        }
      }
    }

    // Sort by next run time
    nextScheduled.sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime());

    return {
      running: this.running,
      instanceId: this.config.instanceId,
      runningJobs: this.activeJobs,
      registeredHandlers: this.handlers.size,
      uptime: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
      lastPollAt: this.lastPollAt,
      nextScheduled,
    };
  }

  // ─── Manual Trigger ────────────────────────────────────────────

  /**
   * Manually trigger a job definition immediately.
   */
  async triggerJob(definitionId: string, tenantId?: string): Promise<string> {
    const definition = await this.store.getDefinition(definitionId);
    if (!definition) {
      throw new Error(`Job definition "${definitionId}" not found`);
    }

    const now = new Date();
    const instanceId = randomUUID();

    const instance: JobInstance = {
      id: instanceId,
      definitionId: definition.id,
      tenantId: tenantId ?? null,
      status: 'pending',
      payload: { ...definition.payloadTemplate },
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      nextRetryAt: null,
      retryCount: 0,
      lockedBy: null,
      lockedAt: null,
      createdAt: now,
    };

    await this.store.createInstance(instance);

    await this.auditLog({
      eventType: 'system.config_change',
      resource: 'job_instance',
      resourceId: instanceId,
      action: 'manual_trigger',
      details: {
        definitionId,
        jobType: definition.jobType,
        tenantId: tenantId ?? 'system',
      },
      timestamp: now,
    });

    // Execute immediately if scheduler is running
    if (this.running) {
      void this.executeInstance(instance, definition);
    }

    return instanceId;
  }

  // ─── Dead Letter Retry ─────────────────────────────────────────

  /**
   * Retry a dead-lettered job by creating a new pending instance.
   */
  async retryDeadLetter(deadLetterId: string): Promise<string> {
    const entry = await this.store.getDeadLetterEntry(deadLetterId);
    if (!entry) {
      throw new Error(`Dead letter entry "${deadLetterId}" not found`);
    }

    const definition = await this.store.getDefinition(entry.definitionId);
    if (!definition) {
      throw new Error(`Job definition "${entry.definitionId}" not found for dead letter entry`);
    }

    const now = new Date();
    const instanceId = randomUUID();

    const instance: JobInstance = {
      id: instanceId,
      definitionId: entry.definitionId,
      tenantId: null,
      status: 'pending',
      payload: { ...entry.payload },
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      nextRetryAt: null,
      retryCount: 0,
      lockedBy: null,
      lockedAt: null,
      createdAt: now,
    };

    await this.store.createInstance(instance);
    await this.store.removeDeadLetterEntry(deadLetterId);

    await this.auditLog({
      eventType: 'system.config_change',
      resource: 'job_instance',
      resourceId: instanceId,
      action: 'retry_dead_letter',
      details: {
        originalDeadLetterId: deadLetterId,
        originalInstanceId: entry.jobInstanceId,
        jobType: definition.jobType,
      },
      timestamp: now,
    });

    return instanceId;
  }

  // ─── Internal: Polling ─────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.running) return;

    const now = new Date();
    this.lastPollAt = now;

    try {
      // Schedule any cron jobs that are due
      await this.scheduleCronJobs();

      // Process due jobs
      const dueInstances = await this.store.getDueInstances(now);
      const retryableInstances = await this.store.getRetryableInstances(now);

      const allDue = [...dueInstances, ...retryableInstances];

      for (const instance of allDue) {
        if (this.activeJobs >= this.config.maxConcurrentJobs) break;
        if (!this.running) break;

        const definition = await this.store.getDefinition(instance.definitionId);
        if (!definition) continue;

        // Try to acquire lock
        const locked = await this.store.tryLock(instance.id, this.config.instanceId, now);
        if (!locked) continue; // Another instance got it

        void this.executeInstance(instance, definition);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown poll error';
      console.error(`[ORDR:SCHEDULER] Poll error: ${message}`);
    }
  }

  // ─── Internal: Cron Scheduling ─────────────────────────────────

  private async scheduleCronJobs(): Promise<void> {
    const definitions = await this.store.getActiveDefinitions();
    const now = new Date();

    for (const def of definitions) {
      if (def.cronExpression === null) continue;

      // Check if there's already a pending instance for this definition
      const instances = await this.store.listInstances({ status: 'pending' });
      const hasPending = instances.some((i) => i.definitionId === def.id);
      if (hasPending) continue;

      // Check if there's a running instance
      const runningInstances = await this.store.listInstances({ status: 'running' });
      const hasRunning = runningInstances.some((i) => i.definitionId === def.id);
      if (hasRunning) continue;

      // Calculate next occurrence
      const parsed = parseCron(def.cronExpression);
      const next = nextOccurrence(parsed, now);

      if (next !== null) {
        const instanceId = randomUUID();
        const instance: JobInstance = {
          id: instanceId,
          definitionId: def.id,
          tenantId: null,
          status: 'pending',
          payload: { ...def.payloadTemplate },
          result: null,
          error: null,
          startedAt: null,
          completedAt: null,
          nextRetryAt: null,
          retryCount: 0,
          lockedBy: null,
          lockedAt: null,
          createdAt: next,
        };

        await this.store.createInstance(instance);
      }
    }
  }

  // ─── Internal: Execution ───────────────────────────────────────

  private async executeInstance(instance: JobInstance, definition: JobDefinition): Promise<void> {
    const handler = this.handlers.get(definition.jobType);
    if (!handler) {
      console.error(`[ORDR:SCHEDULER] No handler registered for job type "${definition.jobType}"`);
      await this.store.releaseLock(instance.id, this.config.instanceId);
      return;
    }

    this.activeJobs++;
    const startTime = Date.now();

    try {
      // Mark as running
      const runningInstance: JobInstance = {
        ...instance,
        status: 'running',
        startedAt: new Date(),
        lockedBy: this.config.instanceId,
        lockedAt: new Date(),
      };
      await this.store.updateInstance(runningInstance);

      await this.auditLog({
        eventType: 'system.config_change',
        resource: 'job_instance',
        resourceId: instance.id,
        action: 'execute_start',
        details: {
          jobType: definition.jobType,
          definitionId: definition.id,
          retryCount: instance.retryCount,
        },
        timestamp: runningInstance.startedAt!,
      });

      // Execute the handler
      const result = await handler(instance.payload);

      if (result.success) {
        // Job completed successfully
        const completedInstance: JobInstance = {
          ...runningInstance,
          status: 'completed',
          result: result.data,
          completedAt: new Date(),
          lockedBy: null,
          lockedAt: null,
        };
        await this.store.updateInstance(completedInstance);
        await this.store.releaseLock(instance.id, this.config.instanceId);

        await this.auditLog({
          eventType: 'system.config_change',
          resource: 'job_instance',
          resourceId: instance.id,
          action: 'execute_complete',
          details: {
            jobType: definition.jobType,
            durationMs: Date.now() - startTime,
            success: true,
          },
          timestamp: completedInstance.completedAt!,
        });
      } else {
        // Job failed
        await this.handleJobFailure(runningInstance, definition, result.error ?? 'Unknown error', startTime);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unhandled execution error';
      await this.handleJobFailure(
        { ...instance, status: 'running', startedAt: new Date() },
        definition,
        message,
        startTime,
      );
    } finally {
      this.activeJobs--;
    }
  }

  private async handleJobFailure(
    instance: JobInstance,
    definition: JobDefinition,
    errorMessage: string,
    startTime: number,
  ): Promise<void> {
    const retryPolicy = definition.retryPolicy;
    const now = new Date();

    if (instance.retryCount < retryPolicy.maxRetries) {
      // Schedule retry with exponential backoff
      const delay = Math.min(
        retryPolicy.baseDelayMs * Math.pow(2, instance.retryCount),
        retryPolicy.maxDelayMs,
      );
      const nextRetryAt = new Date(now.getTime() + delay);

      const retryingInstance: JobInstance = {
        ...instance,
        status: 'retrying',
        error: errorMessage,
        retryCount: instance.retryCount + 1,
        nextRetryAt,
        completedAt: null,
        lockedBy: null,
        lockedAt: null,
      };

      await this.store.updateInstance(retryingInstance);
      await this.store.releaseLock(instance.id, this.config.instanceId);

      await this.auditLog({
        eventType: 'system.config_change',
        resource: 'job_instance',
        resourceId: instance.id,
        action: 'execute_retry_scheduled',
        details: {
          jobType: definition.jobType,
          error: errorMessage,
          retryCount: retryingInstance.retryCount,
          maxRetries: retryPolicy.maxRetries,
          nextRetryAt: nextRetryAt.toISOString(),
          durationMs: Date.now() - startTime,
        },
        timestamp: now,
      });
    } else {
      // Max retries exhausted — move to dead letter queue
      const failedInstance: JobInstance = {
        ...instance,
        status: 'failed',
        error: errorMessage,
        completedAt: now,
        lockedBy: null,
        lockedAt: null,
      };

      await this.store.updateInstance(failedInstance);
      await this.store.releaseLock(instance.id, this.config.instanceId);

      const deadLetterEntry: DeadLetterEntry = {
        id: randomUUID(),
        jobInstanceId: instance.id,
        definitionId: definition.id,
        error: errorMessage,
        payload: instance.payload,
        failedAt: now,
      };

      await this.store.addToDeadLetter(deadLetterEntry);

      await this.auditLog({
        eventType: 'system.config_change',
        resource: 'job_instance',
        resourceId: instance.id,
        action: 'dead_lettered',
        details: {
          jobType: definition.jobType,
          error: errorMessage,
          retryCount: instance.retryCount,
          deadLetterId: deadLetterEntry.id,
          durationMs: Date.now() - startTime,
        },
        timestamp: now,
      });

      // Alert for critical job failures
      const severity = definition.priority === 'critical' ? 'p1'
        : definition.priority === 'high' ? 'p2'
          : 'p3';

      await this.alert({
        severity,
        jobType: definition.jobType,
        instanceId: instance.id,
        error: errorMessage,
        timestamp: now,
      }).catch((alertErr: unknown) => {
        console.error('[ORDR:SCHEDULER] Failed to send alert:', alertErr);
      });
    }
  }
}
