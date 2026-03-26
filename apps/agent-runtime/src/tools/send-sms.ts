/**
 * Send SMS tool — TCPA-compliant outbound SMS for agent runtime
 *
 * SECURITY (CLAUDE.md Rules 4, 6, 9):
 * - TCPA consent MUST be verified before every SMS — no exceptions
 * - Compliance gate MUST pass before sending — no exceptions
 * - Message content is NEVER logged — only metadata (messageId, status)
 * - Phone numbers are validated to E.164 format
 * - All send attempts are audit-logged (no content, just metadata)
 *
 * COMPLIANCE:
 * - ConsentManager.verifyConsentForSend() is called BEFORE SmsProvider.send()
 * - ComplianceGate.checkForChannel('sms', ...) is called BEFORE send
 * - Audit log records the attempt with actor=agent, resource=sms, no PHI
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
import type { AgentTool, AgentContext } from '../types.js';

// ─── Tool Parameter Schema ──────────────────────────────────────

const sendSmsParamsSchema = z.object({
  to: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format'),
  body: z.string().min(1).max(1600),
});

// ─── Dependency Interface ───────────────────────────────────────

export interface SendSmsDeps {
  readonly smsProviderSend: (to: string, body: string) => Promise<Result<{ readonly messageId: string; readonly status: string }, AppError>>;
  readonly consentCheck: (customerId: string, channel: 'sms') => Promise<Result<true, ComplianceViolationError>>;
  readonly complianceCheck: (action: string, context: {
    readonly tenantId: string;
    readonly customerId?: string | undefined;
    readonly channel?: string | undefined;
    readonly data: Record<string, unknown>;
    readonly timestamp: Date;
  }) => { readonly allowed: boolean; readonly violations: readonly { readonly violation?: { readonly message: string } | undefined }[] };
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
 * Create the send-sms tool with injected dependencies.
 */
export function createSendSmsTool(deps: SendSmsDeps): AgentTool {
  return {
    name: 'send_sms',
    description: 'Send an SMS message to a customer. Requires TCPA consent. Message content must comply with FDCPA.',
    parameters: sendSmsParamsSchema,
    execute: async (
      params: unknown,
      context: AgentContext,
    ): Promise<Result<unknown, AppError>> => {
      // ── Validate parameters ──
      const parsed = sendSmsParamsSchema.safeParse(params);
      if (!parsed.success) {
        return err(
          new ValidationError('Invalid SMS parameters', {
            params: parsed.error.errors.map((e) => e.message),
          }),
        );
      }

      const { to, body } = parsed.data;

      // ── TCPA consent check — MANDATORY before every SMS ──
      const consentResult = await deps.consentCheck(context.customerId, 'sms');
      if (!consentResult.success) {
        // Audit the blocked attempt (no content logged)
        await deps.auditLog({
          tenantId: context.tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: context.sessionId,
          resource: 'sms',
          resourceId: context.customerId,
          action: 'send_sms_blocked_consent',
          details: {
            reason: 'TCPA consent not verified',
            sessionId: context.sessionId,
          },
          timestamp: new Date(),
        });
        return consentResult;
      }

      // ── Compliance gate — MANDATORY before customer-facing action ──
      const complianceResult = deps.complianceCheck('send_sms', {
        tenantId: context.tenantId,
        customerId: context.customerId,
        channel: 'sms',
        data: { miniMirandaIncluded: body.includes('attempt to collect a debt') },
        timestamp: new Date(),
      });

      if (!complianceResult.allowed) {
        const violationMessages = complianceResult.violations
          .map((v) => v.violation?.message ?? 'Unknown violation')
          .join('; ');

        // Audit the blocked attempt (no content logged)
        await deps.auditLog({
          tenantId: context.tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: context.sessionId,
          resource: 'sms',
          resourceId: context.customerId,
          action: 'send_sms_blocked_compliance',
          details: {
            reason: 'Compliance gate rejected',
            violationCount: complianceResult.violations.length,
            sessionId: context.sessionId,
          },
          timestamp: new Date(),
        });

        return err(
          new ComplianceViolationError(
            `SMS blocked by compliance gate: ${violationMessages}`,
            'TCPA',
          ),
        );
      }

      // ── Send the SMS ──
      const sendResult = await deps.smsProviderSend(to, body);

      // ── Audit log the send attempt — NO content, only metadata ──
      await deps.auditLog({
        tenantId: context.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: context.sessionId,
        resource: 'sms',
        resourceId: context.customerId,
        action: sendResult.success ? 'send_sms_success' : 'send_sms_failed',
        details: {
          messageId: sendResult.success ? sendResult.data.messageId : 'N/A',
          status: sendResult.success ? sendResult.data.status : 'failed',
          sessionId: context.sessionId,
        },
        timestamp: new Date(),
      });

      if (!sendResult.success) {
        return sendResult;
      }

      return ok({
        messageId: sendResult.data.messageId,
        status: sendResult.data.status,
      });
    },
  };
}
