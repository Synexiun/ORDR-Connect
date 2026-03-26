/**
 * Escalate tool — human agent escalation with full context transfer
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Human-in-the-loop MANDATORY for escalations
 * - Full context provided to human reviewer (no PHI in summary)
 * - Escalation creates a HITL item with audit trail
 * - Severity assessment is logged for incident classification
 *
 * COMPLIANCE:
 * - HIPAA §164.308(a)(6) — incident response procedures
 * - SOC2 CC7.3 — communication of security events
 * - ISO 27001 A.16.1 — information security incident management
 */

import { z } from 'zod';
import {
  type Result,
  ok,
  err,
  type AppError,
  ValidationError,
} from '@ordr/core';
import type { AgentTool, AgentContext } from '../types.js';

// ─── Tool Parameter Schema ──────────────────────────────────────

const escalateParamsSchema = z.object({
  reason: z.string().min(1).max(1000),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  conversationSummary: z.string().min(1).max(2000),
});

// ─── Escalation Result ──────────────────────────────────────────

export interface EscalationResult {
  readonly escalationId: string;
  readonly assignedTo: string;
  readonly severity: string;
  readonly createdAt: Date;
}

// ─── Dependency Interface ───────────────────────────────────────

export interface EscalateDeps {
  readonly createEscalation: (
    reason: string,
    severity: string,
    conversationSummary: string,
    customerId: string,
    tenantId: string,
    sessionId: string,
  ) => Promise<EscalationResult>;
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
 * Create the escalate-to-human tool with injected dependencies.
 *
 * SECURITY: Conversation summary MUST NOT contain raw PII/PHI —
 * only tokenized references and operational metadata. The summary
 * is what the human reviewer sees in their queue.
 */
export function createEscalateTool(deps: EscalateDeps): AgentTool {
  return {
    name: 'escalate_to_human',
    description: 'Escalate the current issue to a human agent. Creates an escalation ticket with severity, reason, and conversation summary for handoff.',
    parameters: escalateParamsSchema,
    execute: async (
      params: unknown,
      context: AgentContext,
    ): Promise<Result<unknown, AppError>> => {
      // ── Validate parameters ──
      const parsed = escalateParamsSchema.safeParse(params);
      if (!parsed.success) {
        return err(
          new ValidationError('Invalid escalation parameters', {
            params: parsed.error.errors.map((e) => e.message),
          }),
        );
      }

      const { reason, severity, conversationSummary } = parsed.data;

      // ── Create escalation ──
      const result = await deps.createEscalation(
        reason,
        severity,
        conversationSummary,
        context.customerId,
        context.tenantId,
        context.sessionId,
      );

      // ── Audit log — escalation metadata, no conversation content ──
      await deps.auditLog({
        tenantId: context.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: context.sessionId,
        resource: 'escalation',
        resourceId: result.escalationId,
        action: 'escalate_to_human',
        details: {
          severity,
          escalationId: result.escalationId,
          assignedTo: result.assignedTo,
          sessionId: context.sessionId,
          customerId: context.customerId,
        },
        timestamp: new Date(),
      });

      return ok({
        escalationId: result.escalationId,
        assignedTo: result.assignedTo,
        severity: result.severity,
        createdAt: result.createdAt,
      });
    },
  };
}
