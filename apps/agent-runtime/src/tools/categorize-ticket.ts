/**
 * Categorize ticket tool — support issue classification engine
 *
 * SECURITY (CLAUDE.md Rules 4, 6, 9):
 * - Input validated with strict Zod schema before processing
 * - NO PII/PHI in categorization output — only category metadata
 * - Audit log records classification decision (no customer content)
 *
 * COMPLIANCE:
 * - Classification decisions are audit-logged for SOC2 CC7.2
 * - Suggested agent routing respects tenant configuration
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

const categorizeTicketParamsSchema = z.object({
  description: z.string().min(1).max(2000),
  customerContext: z.record(z.unknown()).optional().default({}),
});

// ─── Category Taxonomy ──────────────────────────────────────────

export const TICKET_CATEGORIES = [
  'billing',
  'technical',
  'account',
  'compliance',
  'general',
  'escalation',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_SUBCATEGORIES: Readonly<Record<TicketCategory, readonly string[]>> = {
  billing: ['payment_issue', 'refund_request', 'invoice_query', 'plan_change'],
  technical: ['bug_report', 'feature_request', 'integration_issue', 'performance'],
  account: ['access_issue', 'profile_update', 'deactivation', 'data_request'],
  compliance: ['data_deletion', 'privacy_inquiry', 'audit_request', 'consent_management'],
  general: ['information', 'feedback', 'other'],
  escalation: ['complaint', 'legal', 'executive_request', 'sla_breach'],
} as const;

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

// ─── Categorization Result ──────────────────────────────────────

export interface CategorizeResult {
  readonly category: TicketCategory;
  readonly subcategory: string;
  readonly priority: TicketPriority;
  readonly suggestedAgent: string;
  readonly confidence: number;
}

// ─── Dependency Interface ───────────────────────────────────────

export interface CategorizeTicketDeps {
  readonly classify: (
    description: string,
    tenantId: string,
    customerContext: Record<string, unknown>,
  ) => Promise<CategorizeResult>;
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
 * Create the categorize-ticket tool with injected dependencies.
 *
 * SECURITY: Description is validated for length. Classification
 * uses predefined taxonomy — no arbitrary category creation.
 */
export function createCategorizeTicketTool(deps: CategorizeTicketDeps): AgentTool {
  return {
    name: 'categorize_ticket',
    description: 'Classify a support issue into category, subcategory, and priority. Suggests the appropriate agent or team for handling.',
    parameters: categorizeTicketParamsSchema,
    execute: async (
      params: unknown,
      context: AgentContext,
    ): Promise<Result<unknown, AppError>> => {
      // ── Validate parameters ──
      const parsed = categorizeTicketParamsSchema.safeParse(params);
      if (!parsed.success) {
        return err(
          new ValidationError('Invalid categorization parameters', {
            params: parsed.error.errors.map((e) => e.message),
          }),
        );
      }

      const { description, customerContext } = parsed.data;

      // ── Classify the ticket ──
      const result = await deps.classify(description, context.tenantId, customerContext);

      // ── Audit log — classification metadata only, no ticket content ──
      await deps.auditLog({
        tenantId: context.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: context.sessionId,
        resource: 'support_ticket',
        resourceId: context.sessionId,
        action: 'categorize_ticket',
        details: {
          category: result.category,
          subcategory: result.subcategory,
          priority: result.priority,
          suggestedAgent: result.suggestedAgent,
          confidence: result.confidence,
          sessionId: context.sessionId,
        },
        timestamp: new Date(),
      });

      return ok({
        category: result.category,
        subcategory: result.subcategory,
        priority: result.priority,
        suggestedAgent: result.suggestedAgent,
        confidence: result.confidence,
      });
    },
  };
}
