/**
 * Send Health Reminder tool — HIPAA + TCPA compliant health reminder delivery
 *
 * SECURITY (CLAUDE.md Rules 3, 4, 6, 9):
 * - TCPA consent MUST be verified before every communication
 * - HIPAA consent (authorization) MUST be verified for health-related messages
 * - Message content is NEVER logged — only delivery metadata
 * - Patient referenced by token only — no raw PHI
 * - All delivery attempts are audit-logged to WORM
 *
 * COMPLIANCE:
 * - HIPAA §164.508 — authorization required for certain uses/disclosures
 * - HIPAA §164.312(b) — audit controls
 * - TCPA — prior express consent required for automated messages
 * - SOC2 CC6.1 — logical access controls
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
import type { AgentTool, AgentContext } from '../../types.js';

// ─── Tool Parameter Schema ──────────────────────────────────────

const sendHealthReminderParamsSchema = z.object({
  patientToken: z.string().min(1, 'Patient token is required'),
  reminderType: z.enum([
    'appointment_reminder',
    'medication_reminder',
    'follow_up_reminder',
    'wellness_check',
    'lab_results_ready',
    'annual_screening',
  ]),
  channelPreference: z.enum(['sms', 'email', 'voice']),
});

// ─── Dependency Interface ───────────────────────────────────────

export interface SendHealthReminderDeps {
  readonly checkTcpaConsent: (patientToken: string, channel: string, tenantId: string) => Promise<boolean>;
  readonly checkHipaaConsent: (patientToken: string, reminderType: string, tenantId: string) => Promise<boolean>;
  readonly sendReminder: (data: {
    readonly patientToken: string;
    readonly reminderType: string;
    readonly channel: string;
    readonly tenantId: string;
  }) => Promise<Result<{ readonly deliveryId: string; readonly status: string }, AppError>>;
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

// ─── Tool Factory ───────────────────────────────────────────────

/**
 * Create the send-health-reminder tool with injected dependencies.
 */
export function createSendHealthReminderTool(deps: SendHealthReminderDeps): AgentTool {
  return {
    name: 'send_health_reminder',
    description: 'Send a health-related reminder to a patient via their preferred channel. Requires both TCPA and HIPAA consent verification before delivery. No PHI in message metadata.',
    parameters: sendHealthReminderParamsSchema,
    execute: async (
      params: unknown,
      context: AgentContext,
    ): Promise<Result<unknown, AppError>> => {
      // ── Validate parameters ──
      const parsed = sendHealthReminderParamsSchema.safeParse(params);
      if (!parsed.success) {
        return err(
          new ValidationError('Invalid health reminder parameters', {
            params: parsed.error.errors.map((e) => e.message),
          }),
        );
      }

      const { patientToken, reminderType, channelPreference } = parsed.data;

      // ── TCPA consent check — MANDATORY before any automated communication ──
      const hasTcpaConsent = await deps.checkTcpaConsent(
        patientToken,
        channelPreference,
        context.tenantId,
      );

      if (!hasTcpaConsent) {
        await deps.auditLog({
          tenantId: context.tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: context.sessionId,
          resource: 'health_reminder',
          resourceId: patientToken,
          action: 'send_health_reminder_blocked_tcpa',
          details: {
            reason: 'TCPA consent not verified',
            channel: channelPreference,
            reminderType,
            sessionId: context.sessionId,
          },
          timestamp: new Date(),
        });

        return err(
          new ComplianceViolationError(
            'Health reminder blocked — TCPA consent not verified for this patient and channel',
            'TCPA',
          ),
        );
      }

      // ── HIPAA consent check — MANDATORY for health-related communications ──
      const hasHipaaConsent = await deps.checkHipaaConsent(
        patientToken,
        reminderType,
        context.tenantId,
      );

      if (!hasHipaaConsent) {
        await deps.auditLog({
          tenantId: context.tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: context.sessionId,
          resource: 'health_reminder',
          resourceId: patientToken,
          action: 'send_health_reminder_blocked_hipaa',
          details: {
            reason: 'HIPAA authorization not verified',
            reminderType,
            sessionId: context.sessionId,
          },
          timestamp: new Date(),
        });

        return err(
          new ComplianceViolationError(
            'Health reminder blocked — HIPAA authorization not verified for this reminder type',
            'HIPAA',
          ),
        );
      }

      // ── Send the reminder via channel provider ──
      const sendResult = await deps.sendReminder({
        patientToken,
        reminderType,
        channel: channelPreference,
        tenantId: context.tenantId,
      });

      // ── Audit log the delivery attempt — NO message content, only metadata ──
      await deps.auditLog({
        tenantId: context.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: context.sessionId,
        resource: 'health_reminder',
        resourceId: patientToken,
        action: sendResult.success ? 'send_health_reminder_success' : 'send_health_reminder_failed',
        details: {
          deliveryId: sendResult.success ? sendResult.data.deliveryId : 'N/A',
          status: sendResult.success ? sendResult.data.status : 'failed',
          channel: channelPreference,
          reminderType,
          sessionId: context.sessionId,
        },
        timestamp: new Date(),
      });

      if (!sendResult.success) {
        return sendResult;
      }

      return ok({
        deliveryId: sendResult.data.deliveryId,
        status: sendResult.data.status,
        channel: channelPreference,
        reminderType,
      });
    },
  };
}
