/**
 * DSR Deadline Check — daily compliance enforcement job
 *
 * Scans all tenants for DSRs approaching or past their 30-day GDPR Art. 12
 * deadline. Emits compliance.violation audit events and in-app notifications
 * for any DSR where deadline_at < now + 3 days and status is not terminal.
 *
 * SOC2 CC7.1 — Monitoring: automated compliance checks.
 * GDPR Art. 12 — Inform data subjects of progress within one month.
 *
 * Schedule: 0 9 * * * (daily at 09:00 UTC)
 * DB access: BYPASSRLS service account — scans all tenants.
 * Alert level: compliance.violation per overdue DSR.
 */

import type { JobDefinition, JobHandler } from '../types.js';
import { createCronExpression } from '../cron-parser.js';

// ── Job Definition ────────────────────────────────────────────────

export const DSR_DEADLINE_CHECK_JOB_ID = 'dsr-deadline-check';
export const DSR_DEADLINE_CHECK_CRON = '0 9 * * *';

export function createDsrDeadlineCheckDefinition(): Omit<JobDefinition, 'createdAt' | 'updatedAt'> {
  return {
    id: DSR_DEADLINE_CHECK_JOB_ID,
    name: 'DSR Deadline Check',
    description: 'Daily scan for GDPR DSRs approaching or past the 30-day Art. 12 deadline.',
    cronExpression: createCronExpression(DSR_DEADLINE_CHECK_CRON),
    jobType: 'dsr-deadline-check',
    payloadTemplate: {},
    isActive: true,
    priority: 'high',
    retryPolicy: {
      maxRetries: 3,
      baseDelayMs: 30_000,
      maxDelayMs: 600_000, // 10 min max
    },
  };
}

// ── Dependency Types ──────────────────────────────────────────────

export interface DsrDeadlineCheckDeps {
  /** Query overdue/approaching DSRs across all tenants (BYPASSRLS role). */
  readonly findApproachingDeadlines: (params: { withinDays: number }) => Promise<
    ReadonlyArray<{
      readonly id: string;
      readonly tenantId: string;
      readonly deadlineAt: Date;
      readonly status: string;
    }>
  >;

  readonly auditLogger: {
    log: (event: {
      tenantId: string;
      eventType: string;
      actorType: string;
      actorId: string;
      resource: string;
      resourceId: string;
      action: string;
      details: Record<string, unknown>;
      timestamp: Date;
    }) => Promise<void>;
  };

  readonly notifyTenantAdmin: (params: {
    tenantId: string;
    message: string;
    dsrId: string;
  }) => Promise<void>;
}

// ── Handler Factory ───────────────────────────────────────────────

export function createDsrDeadlineCheckHandler(deps: DsrDeadlineCheckDeps): JobHandler {
  return async (): Promise<import('../types.js').JobResult> => {
    const startMs = Date.now();
    const approaching = await deps.findApproachingDeadlines({ withinDays: 3 });

    let processed = 0;

    for (const dsr of approaching) {
      const isOverdue = dsr.deadlineAt < new Date();
      const message = isOverdue
        ? `DSR ${dsr.id} is OVERDUE (deadline: ${dsr.deadlineAt.toISOString()}). Immediate action required.`
        : `DSR ${dsr.id} deadline in < 3 days (${dsr.deadlineAt.toISOString()}).`;

      await deps.auditLogger.log({
        tenantId: dsr.tenantId,
        eventType: 'compliance.violation',
        actorType: 'system',
        actorId: 'scheduler',
        resource: 'data_subject_request',
        resourceId: dsr.id,
        action: 'deadline_approaching',
        details: {
          deadline_at: dsr.deadlineAt.toISOString(),
          is_overdue: isOverdue,
          current_status: dsr.status,
        },
        timestamp: new Date(),
      });

      await deps.notifyTenantAdmin({
        tenantId: dsr.tenantId,
        dsrId: dsr.id,
        message,
      });

      processed++;
    }

    return {
      success: true,
      data: { processed },
      durationMs: Date.now() - startMs,
    };
  };
}
