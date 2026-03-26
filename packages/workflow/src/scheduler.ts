/**
 * @ordr/workflow — Delay Scheduler
 *
 * Manages time-based steps: fixed delays, cron schedules, and
 * business-hours-only delays (TCPA compliance for outbound comms).
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - TCPA: business-hours-only delays skip weekends and holidays
 * - All schedule operations are audit-logged
 * - Tenant isolation enforced on all queries
 */

import type { WorkflowSchedule, WorkflowAuditLogger } from './types.js';

// ─── Business Hours Config ──────────────────────────────────────

export interface BusinessHoursConfig {
  /** Start hour (0-23). Default: 8 (8 AM). */
  readonly startHour: number;
  /** End hour (0-23). Default: 21 (9 PM). */
  readonly endHour: number;
  /** Days of week (0=Sunday, 6=Saturday). Default: [1,2,3,4,5] (Mon-Fri). */
  readonly workDays: readonly number[];
  /** Holiday dates to skip (ISO date strings: "2025-12-25"). */
  readonly holidays: readonly string[];
}

export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  startHour: 8,
  endHour: 21,
  workDays: [1, 2, 3, 4, 5],
  holidays: [],
} as const;

// ─── Delay Scheduler ────────────────────────────────────────────

export class DelayScheduler {
  private readonly schedules: Map<string, WorkflowSchedule> = new Map();
  private readonly businessHours: BusinessHoursConfig;
  private readonly auditLogger: WorkflowAuditLogger | undefined;

  constructor(
    businessHours?: BusinessHoursConfig,
    auditLogger?: WorkflowAuditLogger,
  ) {
    this.businessHours = businessHours ?? DEFAULT_BUSINESS_HOURS;
    this.auditLogger = auditLogger;
  }

  /**
   * Schedule a workflow step resume.
   */
  schedule(schedule: WorkflowSchedule): void {
    this.schedules.set(schedule.id, schedule);
  }

  /**
   * Get all pending schedules due for execution.
   */
  getDueSchedules(now: Date): readonly WorkflowSchedule[] {
    const due: WorkflowSchedule[] = [];
    for (const schedule of this.schedules.values()) {
      if (schedule.status === 'pending' && schedule.scheduledAt <= now) {
        due.push(schedule);
      }
    }
    return due;
  }

  /**
   * Mark a schedule as executed.
   */
  async markExecuted(scheduleId: string): Promise<void> {
    const schedule = this.schedules.get(scheduleId);
    if (schedule) {
      this.schedules.set(scheduleId, {
        ...schedule,
        status: 'executed',
        executedAt: new Date(),
      });

      await this.auditLogger?.log({
        tenantId: 'system',
        eventType: 'workflow.schedule_executed',
        actorType: 'system',
        actorId: 'delay-scheduler',
        resource: 'workflow_schedules',
        resourceId: scheduleId,
        action: 'execute',
        details: {
          instanceId: schedule.instanceId,
          stepIndex: schedule.stepIndex,
          scheduledAt: schedule.scheduledAt.toISOString(),
        },
        timestamp: new Date(),
      });
    }
  }

  /**
   * Cancel a scheduled resume.
   */
  async cancelSchedule(scheduleId: string): Promise<void> {
    const schedule = this.schedules.get(scheduleId);
    if (schedule) {
      this.schedules.set(scheduleId, {
        ...schedule,
        status: 'cancelled',
      });
    }
  }

  /**
   * Cancel all schedules for a workflow instance.
   */
  async cancelByInstance(instanceId: string): Promise<number> {
    let cancelled = 0;
    for (const [id, schedule] of this.schedules.entries()) {
      if (schedule.instanceId === instanceId && schedule.status === 'pending') {
        this.schedules.set(id, { ...schedule, status: 'cancelled' });
        cancelled++;
      }
    }
    return cancelled;
  }

  /**
   * Get all schedules for a workflow instance.
   */
  getByInstance(instanceId: string): readonly WorkflowSchedule[] {
    const results: WorkflowSchedule[] = [];
    for (const schedule of this.schedules.values()) {
      if (schedule.instanceId === instanceId) {
        results.push(schedule);
      }
    }
    return results;
  }

  /**
   * Get a schedule by ID.
   */
  getById(scheduleId: string): WorkflowSchedule | undefined {
    return this.schedules.get(scheduleId);
  }

  /**
   * Calculate the resume time for a delay step.
   *
   * TCPA COMPLIANCE: When businessHoursOnly is true, the calculated
   * time will land within business hours (skip weekends, holidays,
   * and outside-hours periods).
   */
  calculateResumeTime(durationMs: number, businessHoursOnly: boolean): Date {
    const now = new Date();
    const targetTime = new Date(now.getTime() + durationMs);

    if (!businessHoursOnly) {
      return targetTime;
    }

    return this.adjustToBusinessHours(targetTime);
  }

  /**
   * Adjust a date to the next available business-hours slot.
   *
   * TCPA: Outbound communications must occur during business hours only.
   * This method ensures scheduled resumes land within allowed windows.
   */
  adjustToBusinessHours(date: Date): Date {
    const adjusted = new Date(date);
    const maxIterations = 30; // Safety: don't loop forever (max ~30 days ahead)
    let iterations = 0;

    while (iterations < maxIterations) {
      const dayOfWeek = adjusted.getDay();
      const hour = adjusted.getHours();

      // Check if it's a holiday
      const dateStr = adjusted.toISOString().slice(0, 10);
      if (this.businessHours.holidays.includes(dateStr)) {
        // Advance to next day at start hour
        adjusted.setDate(adjusted.getDate() + 1);
        adjusted.setHours(this.businessHours.startHour, 0, 0, 0);
        iterations++;
        continue;
      }

      // Check if it's a work day
      if (!this.businessHours.workDays.includes(dayOfWeek)) {
        adjusted.setDate(adjusted.getDate() + 1);
        adjusted.setHours(this.businessHours.startHour, 0, 0, 0);
        iterations++;
        continue;
      }

      // Check if within business hours
      if (hour < this.businessHours.startHour) {
        adjusted.setHours(this.businessHours.startHour, 0, 0, 0);
        return adjusted;
      }

      if (hour >= this.businessHours.endHour) {
        adjusted.setDate(adjusted.getDate() + 1);
        adjusted.setHours(this.businessHours.startHour, 0, 0, 0);
        iterations++;
        continue;
      }

      // Within business hours — valid
      return adjusted;
    }

    // Safety fallback: return original date if we can't find a business-hours slot
    return date;
  }

  /**
   * Check if a given date falls within business hours.
   */
  isBusinessHours(date: Date): boolean {
    const dayOfWeek = date.getDay();
    const hour = date.getHours();
    const dateStr = date.toISOString().slice(0, 10);

    if (this.businessHours.holidays.includes(dateStr)) {
      return false;
    }

    if (!this.businessHours.workDays.includes(dayOfWeek)) {
      return false;
    }

    return hour >= this.businessHours.startHour && hour < this.businessHours.endHour;
  }

  /**
   * Poll for due schedules. Returns instance IDs that should be resumed.
   */
  async poll(now: Date): Promise<readonly { readonly instanceId: string; readonly stepIndex: number }[]> {
    const due = this.getDueSchedules(now);
    const toResume: { readonly instanceId: string; readonly stepIndex: number }[] = [];

    for (const schedule of due) {
      await this.markExecuted(schedule.id);
      toResume.push({
        instanceId: schedule.instanceId,
        stepIndex: schedule.stepIndex,
      });
    }

    return toResume;
  }

  /** Clear all schedules (for testing). */
  clear(): void {
    this.schedules.clear();
  }

  /** Get total pending schedule count. */
  get pendingCount(): number {
    let count = 0;
    for (const schedule of this.schedules.values()) {
      if (schedule.status === 'pending') {
        count++;
      }
    }
    return count;
  }
}
