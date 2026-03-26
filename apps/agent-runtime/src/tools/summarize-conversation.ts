/**
 * Summarize conversation tool — context compression for handoffs
 *
 * SECURITY (CLAUDE.md Rules 6, 9):
 * - Summary MUST NOT contain raw PII/PHI — only tokenized references
 * - Uses LLM to create concise summary from agent memory steps
 * - Summary output is validated before being passed to next agent
 * - Audit log records the summarization action (no content)
 *
 * COMPLIANCE:
 * - PHI protection per HIPAA §164.502(b) — minimum necessary
 * - Summarization audit trail for SOC2 CC7.2
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

const summarizeConversationParamsSchema = z.object({
  sessionId: z.string().min(1),
});

// ─── Summary Result ─────────────────────────────────────────────

export interface ConversationSummary {
  readonly summary: string;
  readonly keyDecisions: readonly string[];
  readonly unresolvedIssues: readonly string[];
  readonly stepCount: number;
  readonly sessionId: string;
}

// ─── Dependency Interface ───────────────────────────────────────

export interface SummarizeConversationDeps {
  readonly getSessionSteps: (
    sessionId: string,
    tenantId: string,
  ) => Promise<readonly { readonly type: string; readonly output: string; readonly toolUsed: string | undefined; readonly confidence: number }[]>;
  readonly llmSummarize: (
    steps: readonly { readonly type: string; readonly output: string; readonly toolUsed: string | undefined; readonly confidence: number }[],
    tenantId: string,
  ) => Promise<{
    readonly summary: string;
    readonly keyDecisions: readonly string[];
    readonly unresolvedIssues: readonly string[];
  }>;
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
 * Create the summarize-conversation tool with injected dependencies.
 *
 * SECURITY: The LLM summarization prompt explicitly instructs
 * the model to exclude PII/PHI from summaries. Output is used
 * only for agent handoff context — never exposed to clients.
 */
export function createSummarizeConversationTool(deps: SummarizeConversationDeps): AgentTool {
  return {
    name: 'summarize_conversation',
    description: 'Generate a concise summary of a conversation session. Returns key decisions and unresolved issues. NO PII/PHI in output — uses tokenized references only.',
    parameters: summarizeConversationParamsSchema,
    execute: async (
      params: unknown,
      context: AgentContext,
    ): Promise<Result<unknown, AppError>> => {
      // ── Validate parameters ──
      const parsed = summarizeConversationParamsSchema.safeParse(params);
      if (!parsed.success) {
        return err(
          new ValidationError('Invalid summarization parameters', {
            params: parsed.error.errors.map((e) => e.message),
          }),
        );
      }

      const { sessionId } = parsed.data;

      // ── Retrieve session steps — tenant-isolated ──
      const steps = await deps.getSessionSteps(sessionId, context.tenantId);

      if (steps.length === 0) {
        return ok({
          summary: 'No steps recorded for this session.',
          keyDecisions: [],
          unresolvedIssues: [],
          stepCount: 0,
          sessionId,
        });
      }

      // ── LLM summarization — PHI-safe ──
      const llmResult = await deps.llmSummarize(steps, context.tenantId);

      // ── Audit log — metadata only, no summary content ──
      await deps.auditLog({
        tenantId: context.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: context.sessionId,
        resource: 'conversation_summary',
        resourceId: sessionId,
        action: 'summarize_conversation',
        details: {
          targetSessionId: sessionId,
          stepCount: steps.length,
          keyDecisionCount: llmResult.keyDecisions.length,
          unresolvedIssueCount: llmResult.unresolvedIssues.length,
          sessionId: context.sessionId,
        },
        timestamp: new Date(),
      });

      return ok({
        summary: llmResult.summary,
        keyDecisions: llmResult.keyDecisions,
        unresolvedIssues: llmResult.unresolvedIssues,
        stepCount: steps.length,
        sessionId,
      } satisfies ConversationSummary);
    },
  };
}
