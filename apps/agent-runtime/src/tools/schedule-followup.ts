/**
 * Schedule follow-up tool — FDCPA-compliant future message scheduling
 *
 * SECURITY (CLAUDE.md Rules 4, 9):
 * - Validates against FDCPA 7-in-7 contact frequency rule
 * - Validates contact timing (8AM-9PM local time)
 * - All scheduling is audit-logged (no content, just metadata)
 *
 * COMPLIANCE:
 * - FDCPA: Maximum 7 contact attempts per debt per 7-day rolling period
 * - FDCPA: No contact before 8AM or after 9PM in debtor's local time
 * - Scheduling respects cease-and-desist orders
 */

import { z } from 'zod';
import {
  type Result,
  ok,
  err,
  AppError,
  ComplianceViolationError,
  ValidationError,
} from '@ordr/core';
import { randomUUID } from 'node:crypto';
import type { AgentTool, AgentContext } from '../types.js';

// ─── Tool Parameter Schema ──────────────────────────────────────

const scheduleFollowupParamsSchema = z.object({
  customerId: z.string().min(1),
  channel: z.enum(['sms', 'email', 'voice']),
  scheduledAt: z.string().refine(
    (val) => !isNaN(Date.parse(val)),
    'Must be a valid ISO 8601 date string',
  ),
  timezone: z.string().min(1),
  messageType: z.string().min(1),
});

// ─── Dependency Interface ───────────────────────────────────────

export interface ScheduleFollowupDeps {
  readonly getContactAttempts: (
    customerId: string,
    tenantId: string,
    windowDays: number,
  ) => Promise<number>;
  readonly getCeaseAndDesist: (
    customerId: string,
    tenantId: string,
  ) => Promise<boolean>;
  readonly scheduleMessage: (params: {
    readonly customerId: string;
    readonly tenantId: string;
    readonly channel: string;
    readonly scheduledAt: Date;
    readonly messageType: string;
  }) => Promise<{ readonly id: string; readonly scheduledAt: Date }>;
  readonly auditLog: (input: {
    readonly tenantId: string;
    readonly eventType: 'agent.action';
    readonly actorType: 'agent';
    readonly actorId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly action: string;
    readonly details: Record<string, unknown>;
    readonly timestamp: Date;
  }) => Promise<void>;
}

// ─── Constants ──────────────────────────────────────────────────

/** FDCPA Regulation F: max 7 contact attempts per 7-day rolling window */
const FDCPA_MAX_CONTACTS_PER_WEEK = 7 as const;
const FDCPA_WINDOW_DAYS = 7 as const;

/** FDCPA contact hours: 8AM-9PM in debtor's local time */
const FDCPA_EARLIEST_HOUR = 8 as const;
const FDCPA_LATEST_HOUR = 21 as const; // 9PM in 24h

// ─── Tool Factory ───────────────────────────────────────────────

/**
 * Create the schedule-followup tool with injected dependencies.
 *
 * Validates FDCPA frequency and timing rules before scheduling.
 */
export function createScheduleFollowupTool(deps: ScheduleFollowupDeps): AgentTool {
  return {
    name: 'schedule_followup',
    description: 'Schedule a follow-up message for future delivery. Validates FDCPA 7-in-7 contact frequency and timing restrictions.',
    parameters: scheduleFollowupParamsSchema,
    execute: async (
      params: unknown,
      context: AgentContext,
    ): Promise<Result<unknown, AppError>> => {
      // ── Validate parameters ──
      const parsed = scheduleFollowupParamsSchema.safeParse(params);
      if (!parsed.success) {
        return err(
          new ValidationError('Invalid follow-up parameters', {
            params: parsed.error.errors.map((e) => e.message),
          }),
        );
      }

      const { customerId, channel, scheduledAt, timezone, messageType } = parsed.data;
      const scheduledDate = new Date(scheduledAt);

      // ── Check cease-and-desist ──
      const ceaseAndDesist = await deps.getCeaseAndDesist(customerId, context.tenantId);
      if (ceaseAndDesist) {
        await deps.auditLog({
          tenantId: context.tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: context.sessionId,
          resource: 'followup',
          resourceId: customerId,
          action: 'schedule_followup_blocked_cnd',
          details: {
            reason: 'Cease and desist on file',
            sessionId: context.sessionId,
          },
          timestamp: new Date(),
        });

        return err(
          new ComplianceViolationError(
            'Cannot schedule follow-up: cease-and-desist on file for this customer',
            'FDCPA',
          ),
        );
      }

      // ── FDCPA 7-in-7 frequency check ──
      const contactAttempts = await deps.getContactAttempts(
        customerId,
        context.tenantId,
        FDCPA_WINDOW_DAYS,
      );

      if (contactAttempts >= FDCPA_MAX_CONTACTS_PER_WEEK) {
        await deps.auditLog({
          tenantId: context.tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: context.sessionId,
          resource: 'followup',
          resourceId: customerId,
          action: 'schedule_followup_blocked_frequency',
          details: {
            reason: 'FDCPA 7-in-7 limit exceeded',
            contactAttempts,
            maxAllowed: FDCPA_MAX_CONTACTS_PER_WEEK,
            sessionId: context.sessionId,
          },
          timestamp: new Date(),
        });

        return err(
          new ComplianceViolationError(
            `Cannot schedule follow-up: ${String(contactAttempts)} contact attempts in last 7 days (max ${String(FDCPA_MAX_CONTACTS_PER_WEEK)})`,
            'FDCPA',
          ),
        );
      }

      // ── FDCPA contact timing check ──
      let scheduledHour: number;
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: 'numeric',
          hour12: false,
        });
        scheduledHour = Number(formatter.format(scheduledDate));
      } catch {
        // Invalid timezone — fail safe
        return err(
          new ValidationError('Invalid timezone', {
            timezone: ['Must be a valid IANA timezone identifier'],
          }),
        );
      }

      if (scheduledHour < FDCPA_EARLIEST_HOUR || scheduledHour >= FDCPA_LATEST_HOUR) {
        await deps.auditLog({
          tenantId: context.tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: context.sessionId,
          resource: 'followup',
          resourceId: customerId,
          action: 'schedule_followup_blocked_timing',
          details: {
            reason: 'FDCPA timing restriction',
            scheduledHour,
            allowedRange: `${String(FDCPA_EARLIEST_HOUR)}-${String(FDCPA_LATEST_HOUR)}`,
            sessionId: context.sessionId,
          },
          timestamp: new Date(),
        });

        return err(
          new ComplianceViolationError(
            `Cannot schedule follow-up at hour ${String(scheduledHour)} — must be between ${String(FDCPA_EARLIEST_HOUR)}:00 and ${String(FDCPA_LATEST_HOUR - 1)}:59 in customer's local time`,
            'FDCPA',
          ),
        );
      }

      // ── Schedule the message ──
      const scheduled = await deps.scheduleMessage({
        customerId,
        tenantId: context.tenantId,
        channel,
        scheduledAt: scheduledDate,
        messageType,
      });

      // ── Audit log — NO content ──
      await deps.auditLog({
        tenantId: context.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: context.sessionId,
        resource: 'followup',
        resourceId: customerId,
        action: 'schedule_followup_success',
        details: {
          scheduledMessageId: scheduled.id,
          channel,
          scheduledAt: scheduledDate.toISOString(),
          messageType,
          sessionId: context.sessionId,
        },
        timestamp: new Date(),
      });

      return ok({
        scheduledMessageId: scheduled.id,
        scheduledAt: scheduled.scheduledAt,
      });
    },
  };
}
