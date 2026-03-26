/**
 * Agent runtime types — type-safe agent execution model for ORDR-Connect
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Every action gated by compliance check before execution
 * - Confidence < 0.7 triggers HITL review queue
 * - Budget enforcement is hard — session ends on exhaustion
 * - Kill switch terminates immediately with no cleanup delay
 * - Agent CANNOT modify its own permissions — tools fixed at session start
 * - All tool executions return Result<T, AppError> — no thrown exceptions
 */

import type { z } from 'zod';
import type { Result } from '@ordr/core';
import type { AppError, AgentRole, AutonomyLevel } from '@ordr/core';
import type { LLMMessage } from '@ordr/ai';

// ─── Constants ──────────────────────────────────────────────────

/** Confidence threshold — actions below this MUST go to HITL queue. */
export const CONFIDENCE_THRESHOLD = 0.7 as const;

/** Default max steps per agent loop to prevent runaway execution. */
export const DEFAULT_MAX_STEPS = 10 as const;

/** Step types in the agent observe-think-act-check loop. */
export const STEP_TYPES = ['observe', 'think', 'act', 'check'] as const;
export type StepType = (typeof STEP_TYPES)[number];

/** Possible outcomes of an agent session. */
export const SESSION_RESULTS = [
  'completed',
  'escalated',
  'failed',
  'timeout',
  'killed',
] as const;
export type SessionResult = (typeof SESSION_RESULTS)[number];

// ─── Agent Tool ─────────────────────────────────────────────────

/**
 * A tool available to the agent during execution.
 *
 * Parameters are validated via Zod schema before execution.
 * The execute function returns Result — never throws.
 */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: z.ZodType;
  readonly execute: (
    params: unknown,
    context: AgentContext,
  ) => Promise<Result<unknown, AppError>>;
}

// ─── Agent Budget ───────────────────────────────────────────────

/**
 * Budget constraints for an agent session.
 * Enforcement is hard — exceeding any limit ends the session.
 */
export interface AgentBudget {
  readonly maxTokens: number;
  readonly maxCostCents: number;
  readonly maxActions: number;
  usedTokens: number;
  usedCostCents: number;
  usedActions: number;
}

// ─── Kill Switch ────────────────────────────────────────────────

/**
 * Kill switch state. When active, the agent loop terminates immediately.
 */
export interface KillSwitch {
  active: boolean;
  reason: string;
  killedAt: Date | null;
}

// ─── Agent Context ──────────────────────────────────────────────

/**
 * Full execution context for an agent session.
 * Created at session start, immutable tool set, mutable budget/memory.
 */
export interface AgentContext {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly agentRole: AgentRole;
  readonly autonomyLevel: AutonomyLevel;
  readonly tools: ReadonlyMap<string, AgentTool>;
  readonly memory: AgentMemoryState;
  readonly budget: AgentBudget;
  readonly killSwitch: KillSwitch;
  readonly triggerEventId: string;
  readonly startedAt: Date;
}

// ─── Agent Memory State ─────────────────────────────────────────

/**
 * In-memory working state for agent observations and step history.
 */
export interface AgentMemoryState {
  readonly observations: ReadonlyMap<string, unknown>;
  readonly steps: readonly AgentStep[];
}

// ─── Agent Step ─────────────────────────────────────────────────

/**
 * A single step in the agent's observe-think-act-check loop.
 * Every step is recorded for the full audit trail.
 */
export interface AgentStep {
  readonly type: StepType;
  readonly input: string;
  readonly output: string;
  readonly confidence: number;
  readonly durationMs: number;
  readonly toolUsed: string | undefined;
  readonly timestamp: Date;
}

// ─── Agent Decision ─────────────────────────────────────────────

/**
 * A structured decision produced by the LLM during the 'think' phase.
 * If confidence < CONFIDENCE_THRESHOLD, requiresApproval MUST be true.
 */
export interface AgentDecision {
  readonly action: string;
  readonly parameters: Record<string, unknown>;
  readonly reasoning: string;
  readonly confidence: number;
  readonly requiresApproval: boolean;
}

// ─── Agent Outcome ──────────────────────────────────────────────

/**
 * Final outcome of an agent session. Recorded in audit log.
 */
export interface AgentOutcome {
  readonly sessionId: string;
  readonly result: SessionResult;
  readonly totalSteps: number;
  readonly totalCost: number;
  readonly totalTokens: number;
  readonly description: string;
}

// ─── HITL Item ──────────────────────────────────────────────────

/**
 * An item in the human-in-the-loop review queue.
 */
export interface HitlItem {
  readonly id: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly decision: AgentDecision;
  readonly context: Pick<AgentContext, 'sessionId' | 'tenantId' | 'customerId' | 'agentRole'>;
  readonly createdAt: Date;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly reviewedBy: string | undefined;
  readonly reviewedAt: Date | undefined;
  readonly rejectionReason: string | undefined;
}

// ─── LLM Parsed Response ────────────────────────────────────────

/**
 * The structured JSON response expected from the LLM.
 * Used to parse the raw LLM output into a typed decision.
 */
export interface LLMParsedResponse {
  readonly action: string;
  readonly parameters: Record<string, unknown>;
  readonly reasoning: string;
  readonly confidence: number;
  readonly requiresApproval: boolean;
}

// ─── Engine Dependencies ────────────────────────────────────────

/**
 * Dependency injection interface for the AgentEngine.
 * All external services are injected, never directly imported.
 */
export interface AgentEngineDeps {
  readonly llmComplete: (messages: readonly LLMMessage[], systemPrompt: string, metadata: {
    readonly tenant_id: string;
    readonly correlation_id: string;
    readonly agent_id: string;
  }) => Promise<Result<{ readonly content: string; readonly tokenUsage: { readonly total: number }; readonly costCents: number }, AppError>>;
  readonly complianceCheck: (action: string, context: {
    readonly tenantId: string;
    readonly customerId?: string | undefined;
    readonly channel?: string | undefined;
    readonly data: Record<string, unknown>;
    readonly timestamp: Date;
  }) => { readonly allowed: boolean; readonly violations: readonly { readonly violation?: { readonly message: string } | undefined }[] };
  readonly auditLog: (input: {
    readonly tenantId: string;
    readonly eventType: 'agent.action' | 'agent.decision' | 'agent.killed';
    readonly actorType: 'agent';
    readonly actorId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly action: string;
    readonly details: Record<string, unknown>;
    readonly timestamp: Date;
  }) => Promise<void>;
  readonly tools: ReadonlyMap<string, AgentTool>;
}
