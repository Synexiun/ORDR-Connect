/**
 * Agent execution engine — the core of the ORDR-Connect agent runtime
 *
 * Implements the stateful agent loop: Observe -> Think -> Act -> Check -> Repeat
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Compliance gate BEFORE every customer-facing action — no exceptions
 * - Confidence < 0.7 routes to HITL queue — agent MUST NOT auto-execute
 * - Kill switch terminates immediately — no cleanup delay
 * - Budget enforcement is hard — exceed budget = session ends
 * - Full audit trail: decision metadata -> action -> outcome (no content)
 * - Agent cannot modify its own permissions — tools fixed at session start
 * - NEVER log prompts/responses — may contain customer PHI
 *
 * COMPLIANCE:
 * - Every agent action is recorded in WORM audit log
 * - Agent decisions include confidence scores for SOC2 CC1.4
 * - Session lifecycle is fully traceable for ISO 27001 A.12.4
 */

import { randomUUID } from 'node:crypto';
import {
  type Result,
  ok,
  err,
  AppError,
  ComplianceViolationError,
  ValidationError,
} from '@ordr/core';
import type { AgentRole, AutonomyLevel } from '@ordr/core';
import type {
  AgentContext,
  AgentStep,
  AgentDecision,
  AgentOutcome,
  AgentEngineDeps,
} from './types.js';
import { CONFIDENCE_THRESHOLD, DEFAULT_MAX_STEPS } from './types.js';
import { AgentMemory } from './memory.js';
import {
  buildCollectionsPrompt,
  buildGenericPrompt,
  buildLeadQualifierPrompt,
  buildMeetingPrepPrompt,
  buildChurnDetectionPrompt,
  buildExecutiveBriefingPrompt,
} from './prompts.js';
import { HitlQueue } from './hitl.js';
import type { LLMMessage } from '@ordr/ai';

// ─── Prompt Builder Registry ─────────────────────────────────────
//
// Maps every WellKnownAgentRole to its domain-specific prompt builder.
// Falls back to buildGenericPrompt for custom/SDK-registered roles.

type PromptBuilderFn = (context: AgentContext, memory: AgentMemory) => LLMMessage[];

const ROLE_PROMPT_BUILDERS: ReadonlyMap<string, PromptBuilderFn> = new Map<string, PromptBuilderFn>(
  [
    ['collections', buildCollectionsPrompt],
    ['follow_up', buildCollectionsPrompt], // follow_up uses FDCPA/TCPA blocks
    ['lead_qualifier', buildLeadQualifierPrompt],
    ['meeting_prep', buildMeetingPrepPrompt],
    ['churn_detection', buildChurnDetectionPrompt],
    ['executive_briefing', buildExecutiveBriefingPrompt],
    ['support_triage', buildGenericPrompt],
    ['escalation', buildGenericPrompt],
  ],
);

const TERMINAL_ACTIONS: ReadonlySet<string> = new Set(['complete', 'escalate']);

// ─── AgentEngine ────────────────────────────────────────────────

export class AgentEngine {
  private readonly deps: AgentEngineDeps;
  private readonly hitlQueue: HitlQueue;
  private readonly activeSessions: Map<
    string,
    { readonly killSwitch: AgentContext['killSwitch'] }
  > = new Map();

  constructor(deps: AgentEngineDeps, hitlQueue?: HitlQueue) {
    this.deps = deps;
    this.hitlQueue = hitlQueue ?? new HitlQueue();
  }

  /**
   * Start a new agent session.
   *
   * Creates the execution context with:
   * - Unique session ID
   * - Tenant isolation
   * - Fixed tool set (cannot be modified by agent)
   * - Budget constraints
   * - Kill switch (initially inactive)
   */
  async startSession(
    tenantId: string,
    customerId: string,
    agentRole: AgentRole,
    triggerEventId: string,
    autonomyLevel: AutonomyLevel = 'supervised',
    budget?: Partial<{
      readonly maxTokens: number;
      readonly maxCostCents: number;
      readonly maxActions: number;
    }>,
  ): Promise<Result<AgentContext>> {
    const sessionId = randomUUID();
    const memory = new AgentMemory();

    const killSwitch = {
      active: false,
      reason: '',
      killedAt: null as Date | null,
    };

    const context: AgentContext = {
      sessionId,
      tenantId,
      customerId,
      agentRole,
      autonomyLevel,
      tools: this.deps.tools,
      memory: memory.toState(),
      budget: {
        maxTokens: budget?.maxTokens ?? 100_000,
        maxCostCents: budget?.maxCostCents ?? 500,
        maxActions: budget?.maxActions ?? 20,
        usedTokens: 0,
        usedCostCents: 0,
        usedActions: 0,
      },
      killSwitch,
      triggerEventId,
      startedAt: new Date(),
    };

    this.activeSessions.set(sessionId, { killSwitch });

    // Audit log session start
    await this.deps.auditLog({
      tenantId,
      eventType: 'agent.action',
      actorType: 'agent',
      actorId: sessionId,
      resource: 'agent_session',
      resourceId: sessionId,
      action: 'session_started',
      details: {
        agentRole,
        autonomyLevel,
        customerId,
        triggerEventId,
        budgetMaxTokens: context.budget.maxTokens,
        budgetMaxCostCents: context.budget.maxCostCents,
        budgetMaxActions: context.budget.maxActions,
      },
      timestamp: new Date(),
    });

    return ok(context);
  }

  /**
   * Execute a single step in the agent loop.
   *
   * 1. Check kill switch and budget
   * 2. Build prompt from context + memory + history
   * 3. Call LLM
   * 4. Parse structured response
   * 5. If action: validate confidence -> compliance gate -> execute tool -> audit
   * 6. If confidence < 0.7: route to HITL queue
   * 7. Update budget tracking
   */
  async runStep(context: AgentContext): Promise<Result<AgentStep>> {
    const startTime = performance.now();

    // ── Check kill switch ──
    if (context.killSwitch.active) {
      return err(
        new AppError(
          `Session killed: ${context.killSwitch.reason}`,
          'AGENT_SAFETY_BLOCK',
          403,
          true,
        ),
      );
    }

    // ── Check budget ──
    const budgetCheck = this.checkBudget(context);
    if (!budgetCheck.success) {
      return budgetCheck;
    }

    // ── Build prompt — NEVER logged (may contain PHI) ──
    const memory = AgentMemory.fromState(context.memory);
    const promptBuilder = ROLE_PROMPT_BUILDERS.get(context.agentRole) ?? buildGenericPrompt;
    const messages = promptBuilder(context, memory);

    // ── Extract system prompt from messages ──
    const systemMessage = messages.find((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    // ── Call LLM ──
    const llmResult = await this.deps.llmComplete(
      conversationMessages,
      systemMessage?.content ?? '',
      {
        tenant_id: context.tenantId,
        correlation_id: context.sessionId,
        agent_id: context.sessionId,
      },
    );

    if (!llmResult.success) {
      const durationMs = Math.round(performance.now() - startTime);
      const errorStep: AgentStep = {
        type: 'think',
        input: 'LLM request',
        output: 'LLM call failed',
        confidence: 0,
        durationMs,
        toolUsed: undefined,
        timestamp: new Date(),
      };
      memory.addStep(errorStep);
      // Update context memory in place
      this.updateContextMemory(context, memory);
      return err(llmResult.error);
    }

    const llmResponse = llmResult.data;

    // ── Update budget with token usage ──
    context.budget.usedTokens += llmResponse.tokenUsage.total;
    context.budget.usedCostCents += llmResponse.costCents;

    // ── Parse the LLM response ──
    const parseResult = this.parseLLMResponse(llmResponse.content);

    if (!parseResult.success) {
      const durationMs = Math.round(performance.now() - startTime);
      const parseErrorStep: AgentStep = {
        type: 'think',
        input: 'LLM response parsing',
        output: 'Failed to parse structured response from LLM',
        confidence: 0,
        durationMs,
        toolUsed: undefined,
        timestamp: new Date(),
      };
      memory.addStep(parseErrorStep);
      this.updateContextMemory(context, memory);
      return err(parseResult.error);
    }

    const decision = parseResult.data;

    // ── Record the think step ──
    const thinkStep: AgentStep = {
      type: 'think',
      input: 'Agent reasoning',
      output: `Decision: ${decision.action} (confidence: ${String(decision.confidence)})`,
      confidence: decision.confidence,
      durationMs: Math.round(performance.now() - startTime),
      toolUsed: undefined,
      timestamp: new Date(),
    };
    memory.addStep(thinkStep);

    // ── Audit log the decision — NO content, only metadata ──
    await this.deps.auditLog({
      tenantId: context.tenantId,
      eventType: 'agent.decision',
      actorType: 'agent',
      actorId: context.sessionId,
      resource: 'agent_decision',
      resourceId: context.sessionId,
      action: decision.action,
      details: {
        confidence: decision.confidence,
        requiresApproval: decision.requiresApproval,
        sessionId: context.sessionId,
        tokensUsed: llmResponse.tokenUsage.total,
        costCents: llmResponse.costCents,
      },
      timestamp: new Date(),
    });

    // ── Check confidence threshold ──
    if (decision.confidence < CONFIDENCE_THRESHOLD || decision.requiresApproval) {
      // Route to HITL queue
      const hitlItemId = this.hitlQueue.enqueue(context.sessionId, decision, context);

      const hitlStep: AgentStep = {
        type: 'check',
        input: `Decision: ${decision.action}`,
        output: `Routed to HITL queue (confidence: ${String(decision.confidence)}, item: ${hitlItemId})`,
        confidence: decision.confidence,
        durationMs: Math.round(performance.now() - startTime),
        toolUsed: undefined,
        timestamp: new Date(),
      };
      memory.addStep(hitlStep);
      this.updateContextMemory(context, memory);

      return ok(hitlStep);
    }

    // ── Terminal actions ──
    if (TERMINAL_ACTIONS.has(decision.action)) {
      const terminalStep: AgentStep = {
        type: 'act',
        input: `Action: ${decision.action}`,
        output: decision.reasoning,
        confidence: decision.confidence,
        durationMs: Math.round(performance.now() - startTime),
        toolUsed: decision.action,
        timestamp: new Date(),
      };
      memory.addStep(terminalStep);
      this.updateContextMemory(context, memory);
      return ok(terminalStep);
    }

    // ── "respond" pseudo-action (observation/message, no tool needed) ──
    if (decision.action === 'respond') {
      const respondStep: AgentStep = {
        type: 'observe',
        input: 'Agent response',
        output: 'Agent provided a response',
        confidence: decision.confidence,
        durationMs: Math.round(performance.now() - startTime),
        toolUsed: undefined,
        timestamp: new Date(),
      };
      memory.addStep(respondStep);
      this.updateContextMemory(context, memory);
      return ok(respondStep);
    }

    // ── Execute tool action ──
    const tool = context.tools.get(decision.action);
    if (tool === undefined) {
      const unknownToolStep: AgentStep = {
        type: 'check',
        input: `Action: ${decision.action}`,
        output: `Unknown tool: ${decision.action}`,
        confidence: 0,
        durationMs: Math.round(performance.now() - startTime),
        toolUsed: decision.action,
        timestamp: new Date(),
      };
      memory.addStep(unknownToolStep);
      this.updateContextMemory(context, memory);
      return err(
        new ValidationError(`Agent requested unknown tool: ${decision.action}`, {
          action: ['Tool not available in agent tool set'],
        }),
      );
    }

    // ── Compliance gate BEFORE action ──
    const complianceResult = this.deps.complianceCheck(decision.action, {
      tenantId: context.tenantId,
      customerId: context.customerId,
      data: decision.parameters,
      timestamp: new Date(),
    });

    if (!complianceResult.allowed) {
      const violationMessages = complianceResult.violations
        .map((v) => v.violation?.message ?? 'Unknown violation')
        .join('; ');

      const blockedStep: AgentStep = {
        type: 'check',
        input: `Action: ${decision.action}`,
        output: `Blocked by compliance: ${violationMessages}`,
        confidence: decision.confidence,
        durationMs: Math.round(performance.now() - startTime),
        toolUsed: decision.action,
        timestamp: new Date(),
      };
      memory.addStep(blockedStep);
      this.updateContextMemory(context, memory);

      return err(
        new ComplianceViolationError(
          `Action ${decision.action} blocked by compliance gate: ${violationMessages}`,
          'SOC2',
        ),
      );
    }

    // ── Execute the tool ──
    const toolResult = await tool.execute(decision.parameters, context);

    // ── Update action budget ──
    context.budget.usedActions += 1;

    const durationMs = Math.round(performance.now() - startTime);
    const actionStep: AgentStep = {
      type: 'act',
      input: `Action: ${decision.action}`,
      output: toolResult.success
        ? `Tool ${decision.action} executed successfully`
        : `Tool ${decision.action} failed`,
      confidence: decision.confidence,
      durationMs,
      toolUsed: decision.action,
      timestamp: new Date(),
    };
    memory.addStep(actionStep);
    this.updateContextMemory(context, memory);

    // ── Audit log the action result ──
    await this.deps.auditLog({
      tenantId: context.tenantId,
      eventType: 'agent.action',
      actorType: 'agent',
      actorId: context.sessionId,
      resource: decision.action,
      resourceId: context.customerId,
      action: toolResult.success ? `${decision.action}_success` : `${decision.action}_failed`,
      details: {
        confidence: decision.confidence,
        durationMs,
        sessionId: context.sessionId,
        success: toolResult.success,
      },
      timestamp: new Date(),
    });

    if (!toolResult.success) {
      return err(toolResult.error);
    }

    // Store the tool result as an observation
    memory.addObservation(`tool_result_${decision.action}`, toolResult.data);
    this.updateContextMemory(context, memory);

    return ok(actionStep);
  }

  /**
   * Run the full agent loop until completion, budget exhaustion,
   * kill switch activation, or max steps reached.
   */
  async runLoop(
    context: AgentContext,
    maxSteps: number = DEFAULT_MAX_STEPS,
  ): Promise<Result<AgentOutcome>> {
    let stepCount = 0;

    while (stepCount < maxSteps) {
      // ── Kill switch check ──
      if (context.killSwitch.active) {
        return ok(
          this.buildOutcome(
            context,
            'killed',
            stepCount,
            `Session killed: ${context.killSwitch.reason}`,
          ),
        );
      }

      // ── Budget check ──
      const budgetCheck = this.checkBudget(context);
      if (!budgetCheck.success) {
        return ok(this.buildOutcome(context, 'timeout', stepCount, 'Budget exhausted'));
      }

      // ── Run step ──
      const stepResult = await this.runStep(context);
      stepCount++;

      if (!stepResult.success) {
        // Check if it's a compliance block or safety issue
        if (stepResult.error instanceof ComplianceViolationError) {
          return ok(
            this.buildOutcome(
              context,
              'failed',
              stepCount,
              `Compliance violation: ${stepResult.error.message}`,
            ),
          );
        }

        if (stepResult.error.code === 'AGENT_SAFETY_BLOCK') {
          return ok(this.buildOutcome(context, 'killed', stepCount, stepResult.error.message));
        }

        // For other errors, continue loop (agent may recover)
        continue;
      }

      const step = stepResult.data;

      // ── Check for terminal conditions ──
      if (
        step.type === 'act' &&
        step.toolUsed !== undefined &&
        TERMINAL_ACTIONS.has(step.toolUsed)
      ) {
        const result =
          step.toolUsed === 'escalate' ? ('escalated' as const) : ('completed' as const);
        return ok(this.buildOutcome(context, result, stepCount, step.output));
      }

      // ── Check for HITL escalation (step was routed to queue) ──
      if (step.type === 'check' && step.output.includes('HITL queue')) {
        return ok(
          this.buildOutcome(context, 'escalated', stepCount, 'Decision routed to human review'),
        );
      }
    }

    // Max steps reached
    return ok(
      this.buildOutcome(
        context,
        'timeout',
        stepCount,
        `Maximum steps (${String(maxSteps)}) reached`,
      ),
    );
  }

  /**
   * Kill a session immediately. No cleanup delay.
   *
   * SECURITY: Kill switch is the highest-priority control.
   * When activated, the agent loop exits on the very next iteration.
   */
  killSession(sessionId: string, reason: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session !== undefined) {
      session.killSwitch.active = true;
      session.killSwitch.reason = reason;
      session.killSwitch.killedAt = new Date();
    }
  }

  /**
   * Get the HITL queue for external access (approval/rejection).
   */
  getHitlQueue(): HitlQueue {
    return this.hitlQueue;
  }

  // ─── Private Methods ────────────────────────────────────────

  /**
   * Check if the session budget allows another step.
   */
  private checkBudget(context: AgentContext): Result<true> {
    if (context.budget.usedTokens >= context.budget.maxTokens) {
      return err(
        new AppError(
          `Token budget exhausted: ${String(context.budget.usedTokens)}/${String(context.budget.maxTokens)}`,
          'AGENT_SAFETY_BLOCK',
          403,
          true,
        ),
      );
    }

    if (context.budget.usedCostCents >= context.budget.maxCostCents) {
      return err(
        new AppError(
          `Cost budget exhausted: ${String(context.budget.usedCostCents)}/${String(context.budget.maxCostCents)} cents`,
          'AGENT_SAFETY_BLOCK',
          403,
          true,
        ),
      );
    }

    if (context.budget.usedActions >= context.budget.maxActions) {
      return err(
        new AppError(
          `Action budget exhausted: ${String(context.budget.usedActions)}/${String(context.budget.maxActions)}`,
          'AGENT_SAFETY_BLOCK',
          403,
          true,
        ),
      );
    }

    return ok(true as const);
  }

  /**
   * Parse the LLM response into a structured AgentDecision.
   *
   * SECURITY: Only the parsed structure is used — raw content is never logged.
   */
  private parseLLMResponse(content: string): Result<AgentDecision> {
    try {
      // Extract JSON from potential markdown code blocks
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```')) {
        const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (jsonMatch?.[1] !== undefined) {
          jsonStr = jsonMatch[1].trim();
        }
      }

      const parsed: unknown = JSON.parse(jsonStr);

      // Validate the shape
      if (typeof parsed !== 'object' || parsed === null) {
        return err(new ValidationError('LLM response is not a JSON object'));
      }

      const obj = parsed as Record<string, unknown>;

      if (typeof obj['action'] !== 'string') {
        return err(new ValidationError('LLM response missing "action" field'));
      }

      const confidence = typeof obj['confidence'] === 'number' ? obj['confidence'] : 0.5;
      const requiresApproval =
        typeof obj['requiresApproval'] === 'boolean'
          ? obj['requiresApproval']
          : confidence < CONFIDENCE_THRESHOLD;

      const decision: AgentDecision = {
        action: obj['action'],
        parameters:
          typeof obj['parameters'] === 'object' && obj['parameters'] !== null
            ? (obj['parameters'] as Record<string, unknown>)
            : {},
        reasoning: typeof obj['reasoning'] === 'string' ? obj['reasoning'] : '',
        confidence,
        requiresApproval,
      };

      return ok(decision);
    } catch {
      return err(new ValidationError('Failed to parse LLM response as JSON'));
    }
  }

  /**
   * Update the context's memory state from the working memory.
   */
  private updateContextMemory(context: AgentContext, memory: AgentMemory): void {
    const state = memory.toState();
    // AgentContext.memory is readonly at the type level, but we need to update it
    // during the session. This is safe because the context is session-scoped.
    (context as { memory: typeof state }).memory = state;
  }

  /**
   * Build the final outcome record for a session.
   */
  private buildOutcome(
    context: AgentContext,
    result: AgentOutcome['result'],
    totalSteps: number,
    description: string,
  ): AgentOutcome {
    return {
      sessionId: context.sessionId,
      result,
      totalSteps,
      totalCost: context.budget.usedCostCents,
      totalTokens: context.budget.usedTokens,
      description,
    };
  }
}
