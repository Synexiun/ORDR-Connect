/**
 * Multi-agent orchestrator — supervisor pattern for ORDR-Connect
 *
 * Routes decisions from the Decision Engine to specialized agents,
 * manages inter-agent handoffs, enforces budget across chains,
 * and maintains the full audit trail.
 *
 * Architecture:
 *   Decision Engine -> Orchestrator (Supervisor) -> [Collections | Support Triage | Escalation]
 *                           |              |
 *                    Agent Registry    Memory Manager
 *                           |
 *                      Message Bus
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Agent CANNOT modify its own tools or permissions — fixed at session start via registry
 * - Compliance gate checked before every customer-facing action
 * - Budget enforcement across handoffs — total session cost includes all agents in chain
 * - Kill switch terminates entire chain immediately
 * - Max handoff depth = 3 — prevents infinite agent loops
 * - NEVER log agent conversation content — only metadata
 *
 * COMPLIANCE:
 * - Full dispatch -> handoff -> outcome chain audit-logged (WORM)
 * - SOC2 CC7.2 — system monitoring and incident detection
 * - ISO 27001 A.12.4 — logging and monitoring
 * - HIPAA §164.312(b) — audit controls
 */

import { randomUUID } from 'node:crypto';
import { type Result, err, AppError as AppErrorClass, InternalError } from '@ordr/core';
import type { AgentRole } from '@ordr/core';
import { createAgentRole } from '@ordr/core';
import type { AgentContext, AgentOutcome, AgentEngineDeps } from './types.js';
import { AgentEngine } from './engine.js';
import { AgentMemory } from './memory.js';
import { HitlQueue } from './hitl.js';
import type { AgentRegistry } from './agent-registry.js';
import { MessageBus } from './message-protocol.js';
import type { MemoryManager } from './memory/manager.js';
import { CheckpointManager } from './checkpoint.js';

// ─── Constants ──────────────────────────────────────────────────

/** Maximum handoff chain depth — prevents infinite agent loops. */
export const MAX_HANDOFF_DEPTH = 3 as const;

/** Action-to-role routing map. Maps decision actions to agent roles. */
const ACTION_TO_ROLE: Readonly<Record<string, AgentRole>> = {
  send_sms: createAgentRole('collections'),
  send_email: createAgentRole('collections'),
  send_voice: createAgentRole('collections'),
  offer_payment_plan: createAgentRole('collections'),
  schedule_callback: createAgentRole('collections'),
  route_to_agent: createAgentRole('support_triage'),
  trigger_workflow: createAgentRole('support_triage'),
  escalate_to_human: createAgentRole('escalation'),
  cease_communication: createAgentRole('escalation'),
} as const;

// ─── Types ──────────────────────────────────────────────────────

/**
 * Handoff context — preserves state across agent transitions.
 *
 * SECURITY: preservedMemory contains metadata only — no raw PII/PHI.
 */
export interface HandoffContext {
  readonly fromAgent: AgentRole;
  readonly toAgent: AgentRole;
  readonly reason: string;
  readonly preservedMemory: readonly string[];
  readonly conversationHistory: readonly string[];
  readonly customerContext: Record<string, unknown>;
}

/**
 * NBAPipeline interface — abstraction over the decision engine.
 * Decoupled for dependency injection and testability.
 */
export interface NBAPipelineInterface {
  readonly evaluate: (context: {
    readonly tenantId: string;
    readonly customerId: string;
    readonly eventType: string;
    readonly eventPayload: Record<string, unknown>;
    readonly customerProfile: Record<string, unknown>;
    readonly channelPreferences: readonly string[];
    readonly interactionHistory: readonly Record<string, unknown>[];
    readonly constraints: Record<string, unknown>;
    readonly timestamp: Date;
    readonly correlationId: string;
  }) => Promise<
    Result<
      {
        readonly id: string;
        readonly tenantId: string;
        readonly customerId: string;
        readonly action: string;
        readonly channel: string | undefined;
        readonly parameters: Record<string, unknown>;
        readonly score: number;
        readonly confidence: number;
        readonly reasoning: string;
      },
      AppError
    >
  >;
}

/**
 * Audit log interface for the orchestrator.
 */
interface OrchestratorAuditLog {
  (input: {
    readonly tenantId: string;
    readonly eventType: 'agent.action' | 'agent.decision' | 'agent.killed';
    readonly actorType: 'agent';
    readonly actorId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly action: string;
    readonly details: Record<string, unknown>;
    readonly timestamp: Date;
  }): Promise<void>;
}

/**
 * Dependencies for the orchestrator.
 * All external services are injected — never directly imported.
 */
export interface OrchestratorDeps {
  readonly registry: AgentRegistry;
  readonly engineDeps: AgentEngineDeps;
  readonly memoryManager: MemoryManager;
  readonly hitlQueue: HitlQueue;
  readonly auditLog: OrchestratorAuditLog;
}

// ─── Active Session Tracking ────────────────────────────────────

interface ActiveSession {
  readonly context: AgentContext;
  readonly tenantId: string;
  readonly handoffDepth: number;
  readonly parentSessionId: string | undefined;
  readonly correlationId: string;
}

// ─── AgentOrchestrator ──────────────────────────────────────────

export class AgentOrchestrator {
  private readonly registry: AgentRegistry;
  private readonly engine: AgentEngine;
  private readonly memoryManager: MemoryManager;
  private readonly hitlQueue: HitlQueue;
  private readonly auditLog: OrchestratorAuditLog;
  private readonly checkpointManager: CheckpointManager;
  private readonly messageBus: Map<string, MessageBus> = new Map();
  private readonly activeSessions: Map<string, ActiveSession> = new Map();
  private readonly tenantSessions: Map<string, Set<string>> = new Map();

  constructor(deps: OrchestratorDeps) {
    this.registry = deps.registry;
    this.engine = new AgentEngine(deps.engineDeps, deps.hitlQueue);
    this.memoryManager = deps.memoryManager;
    this.hitlQueue = deps.hitlQueue;
    this.auditLog = deps.auditLog;
    this.checkpointManager = new CheckpointManager();
  }

  /**
   * Dispatch a decision to the appropriate agent.
   *
   * Flow:
   * 1. Map decision action to agent role via ACTION_TO_ROLE
   * 2. Verify role is enabled for tenant
   * 3. Get agent config from registry
   * 4. Build tools from registry allowlist
   * 5. Start agent session via AgentEngine
   * 6. Initialize memory with decision context + customer history
   * 7. Run agent loop
   * 8. On completion/escalation: check if handoff needed
   * 9. Record outcome + audit trail
   * 10. Promote memory to episodic store
   */
  async dispatch(
    decision: {
      readonly id: string;
      readonly action: string;
      readonly channel?: string | undefined;
      readonly parameters: Record<string, unknown>;
      readonly score: number;
      readonly confidence: number;
      readonly reasoning: string;
    },
    tenantId: string,
    customerId: string,
  ): Promise<Result<AgentOutcome, AppError>> {
    // ── Map action to agent role ──
    const agentRole = ACTION_TO_ROLE[decision.action];
    if (agentRole === undefined) {
      return err(new InternalError(`No agent role mapped for action: ${decision.action}`));
    }

    // ── Verify role is enabled for tenant ──
    if (!this.registry.isRoleEnabled(agentRole, tenantId)) {
      return err(
        new AppErrorClass(
          `Agent role "${agentRole}" is disabled for tenant ${tenantId}`,
          'AGENT_SAFETY_BLOCK',
          403,
          true,
        ),
      );
    }

    // ── Get agent config ──
    const config = this.registry.getConfig(agentRole);
    if (config === undefined) {
      return err(new InternalError(`No configuration found for agent role: ${agentRole}`));
    }

    // ── Start agent session ──
    const sessionResult = await this.engine.startSession(
      tenantId,
      customerId,
      agentRole,
      decision.id,
      config.defaultAutonomyLevel,
      {
        maxTokens: config.maxTokensBudget,
        maxCostCents: config.maxCostCentsBudget,
        maxActions: config.maxActions,
      },
    );

    if (!sessionResult.success) {
      return sessionResult;
    }

    const context = sessionResult.data;
    const correlationId = randomUUID();

    // ── Track active session ──
    this.trackSession(context, tenantId, 0, undefined, correlationId);

    // ── Initialize memory with decision context ──
    const memory = AgentMemory.fromState(context.memory);
    memory.addObservation('decision_id', decision.id);
    memory.addObservation('decision_action', decision.action);
    memory.addObservation('decision_score', decision.score);
    memory.addObservation('decision_confidence', decision.confidence);
    memory.addObservation('decision_reasoning', decision.reasoning);

    // Load episodic memory for customer context
    const episodicResult = await this.memoryManager.getEpisodic(customerId, tenantId, 5);
    if (episodicResult.success && episodicResult.data.length > 0) {
      const priorSummary = episodicResult.data
        .map((ep) => `Session ${ep.sessionId}: ${ep.outcome} (${ep.agentRole})`)
        .join('; ');
      memory.addObservation('prior_interactions', priorSummary);
    }

    this.updateContextMemory(context, memory);

    // ── Audit log dispatch ──
    await this.auditLog({
      tenantId,
      eventType: 'agent.action',
      actorType: 'agent',
      actorId: context.sessionId,
      resource: 'orchestrator',
      resourceId: context.sessionId,
      action: 'dispatch',
      details: {
        agentRole,
        decisionId: decision.id,
        decisionAction: decision.action,
        correlationId,
      },
      timestamp: new Date(),
    });

    // ── Run agent loop ──
    const outcome = await this.engine.runLoop(context, config.maxSteps);

    if (!outcome.success) {
      this.removeSession(context.sessionId, tenantId);
      return outcome;
    }

    // ── Promote memory to episodic ──
    await this.memoryManager.promoteToEpisodic(
      context.sessionId,
      customerId,
      tenantId,
      agentRole,
      AgentMemory.fromState(context.memory),
      outcome.data.description,
    );

    // ── Check if handoff needed ──
    if (outcome.data.result === 'escalated') {
      const handoffResult = await this.handoff(
        context.sessionId,
        createAgentRole('escalation'),
        'Agent session escalated',
        {
          fromAgent: agentRole,
          toAgent: createAgentRole('escalation'),
          reason: outcome.data.description,
          preservedMemory: this.extractPreservedMemory(context),
          conversationHistory: [],
          customerContext: { customerId, tenantId },
        },
      );

      this.removeSession(context.sessionId, tenantId);

      if (handoffResult.success) {
        return handoffResult;
      }
      // Handoff failed — return original outcome
    }

    // ── Clean up ──
    this.removeSession(context.sessionId, tenantId);

    // ── Audit log completion ──
    await this.auditLog({
      tenantId,
      eventType: 'agent.action',
      actorType: 'agent',
      actorId: context.sessionId,
      resource: 'orchestrator',
      resourceId: context.sessionId,
      action: 'dispatch_completed',
      details: {
        result: outcome.data.result,
        totalSteps: outcome.data.totalSteps,
        totalCost: outcome.data.totalCost,
        totalTokens: outcome.data.totalTokens,
        correlationId,
      },
      timestamp: new Date(),
    });

    return outcome;
  }

  /**
   * Hand off a session from one agent to another.
   *
   * SECURITY:
   * - Max handoff chain depth = 3 to prevent infinite loops
   * - Budget enforcement across handoffs — total cost includes all agents
   * - Preserved memory contains NO raw PII/PHI — only metadata
   * - Full handoff chain audit-logged
   */
  async handoff(
    fromSessionId: string,
    toAgentRole: AgentRole,
    reason: string,
    handoffContext: HandoffContext,
  ): Promise<Result<AgentOutcome>> {
    // ── Get source session ──
    const sourceSession = this.activeSessions.get(fromSessionId);

    // ── Check handoff depth ──
    const currentDepth = sourceSession !== undefined ? sourceSession.handoffDepth : 0;
    if (currentDepth >= MAX_HANDOFF_DEPTH) {
      return err(
        new AppErrorClass(
          `Maximum handoff depth (${String(MAX_HANDOFF_DEPTH)}) reached. Cannot handoff from ${fromSessionId} to ${toAgentRole}.`,
          'AGENT_SAFETY_BLOCK',
          403,
          true,
        ),
      );
    }

    const tenantId =
      sourceSession?.tenantId ?? (handoffContext.customerContext['tenantId'] as string);
    const customerId =
      sourceSession?.context.customerId ?? (handoffContext.customerContext['customerId'] as string);
    const correlationId = sourceSession?.correlationId ?? randomUUID();

    // ── Verify target role is enabled ──
    if (!this.registry.isRoleEnabled(toAgentRole, tenantId)) {
      return err(
        new AppErrorClass(
          `Agent role "${toAgentRole}" is disabled for tenant ${tenantId}`,
          'AGENT_SAFETY_BLOCK',
          403,
          true,
        ),
      );
    }

    // ── Get target config ──
    const targetConfig = this.registry.getConfig(toAgentRole);
    if (targetConfig === undefined) {
      return err(new InternalError(`No configuration found for agent role: ${toAgentRole}`));
    }

    // ── Calculate remaining budget from source session ──
    let remainingBudget = {
      maxTokens: targetConfig.maxTokensBudget,
      maxCostCents: targetConfig.maxCostCentsBudget,
      maxActions: targetConfig.maxActions,
    };

    if (sourceSession !== undefined) {
      const sourceBudget = sourceSession.context.budget;
      remainingBudget = {
        maxTokens: Math.max(0, sourceBudget.maxTokens - sourceBudget.usedTokens),
        maxCostCents: Math.max(0, sourceBudget.maxCostCents - sourceBudget.usedCostCents),
        maxActions: Math.max(0, sourceBudget.maxActions - sourceBudget.usedActions),
      };
    }

    // ── Audit log handoff ──
    await this.auditLog({
      tenantId,
      eventType: 'agent.action',
      actorType: 'agent',
      actorId: fromSessionId,
      resource: 'orchestrator',
      resourceId: fromSessionId,
      action: 'handoff',
      details: {
        fromAgent: handoffContext.fromAgent,
        toAgent: toAgentRole,
        reason,
        handoffDepth: currentDepth + 1,
        correlationId,
      },
      timestamp: new Date(),
    });

    // ── Start new session for target agent ──
    const sessionResult = await this.engine.startSession(
      tenantId,
      customerId,
      toAgentRole,
      `handoff-${fromSessionId}`,
      targetConfig.defaultAutonomyLevel,
      remainingBudget,
    );

    if (!sessionResult.success) {
      return sessionResult;
    }

    const newContext = sessionResult.data;

    // ── Track the new session ──
    this.trackSession(newContext, tenantId, currentDepth + 1, fromSessionId, correlationId);

    // ── Initialize memory with handoff context ──
    const memory = AgentMemory.fromState(newContext.memory);
    memory.addObservation('handoff_from', handoffContext.fromAgent);
    memory.addObservation('handoff_reason', reason);
    memory.addObservation('handoff_depth', currentDepth + 1);

    for (const obs of handoffContext.preservedMemory) {
      memory.addObservation(`prior_${handoffContext.fromAgent}`, obs);
    }

    this.updateContextMemory(newContext, memory);

    // ── Send handoff message via bus ──
    const bus = this.getOrCreateBus(tenantId);
    await bus.send(
      MessageBus.createMessage(
        handoffContext.fromAgent,
        fromSessionId,
        toAgentRole,
        'handoff_request',
        {
          reason,
          handoffDepth: currentDepth + 1,
          preservedMemoryCount: handoffContext.preservedMemory.length,
        },
        correlationId,
      ),
    );

    // ── Run target agent loop ──
    const outcome = await this.engine.runLoop(newContext, targetConfig.maxSteps);

    // ── Promote memory ──
    if (outcome.success) {
      await this.memoryManager.promoteToEpisodic(
        newContext.sessionId,
        customerId,
        tenantId,
        toAgentRole,
        AgentMemory.fromState(newContext.memory),
        outcome.data.description,
      );
    }

    // ── Clean up ──
    this.removeSession(newContext.sessionId, tenantId);

    return outcome;
  }

  /**
   * Get all active sessions for a tenant.
   */
  getActiveSessionsForTenant(tenantId: string): readonly AgentContext[] {
    const sessionIds = this.tenantSessions.get(tenantId);
    if (sessionIds === undefined) {
      return [];
    }

    const contexts: AgentContext[] = [];
    for (const sessionId of sessionIds) {
      const session = this.activeSessions.get(sessionId);
      if (session !== undefined) {
        contexts.push(session.context);
      }
    }

    return contexts;
  }

  /**
   * Kill ALL active sessions for a tenant.
   *
   * SECURITY: Tenant-level kill switch — terminates all agent activity
   * for a tenant immediately with no cleanup delay.
   */
  killAllForTenant(tenantId: string, reason: string): void {
    const sessionIds = this.tenantSessions.get(tenantId);
    if (sessionIds === undefined) {
      return;
    }

    for (const sessionId of sessionIds) {
      this.engine.killSession(sessionId, reason);

      // Audit log each kill (fire and forget — kill must not be delayed)
      void this.auditLog({
        tenantId,
        eventType: 'agent.killed',
        actorType: 'agent',
        actorId: sessionId,
        resource: 'orchestrator',
        resourceId: sessionId,
        action: 'kill_all_for_tenant',
        details: {
          reason,
          tenantId,
        },
        timestamp: new Date(),
      });
    }
  }

  /**
   * Get the message bus for a tenant.
   */
  getMessageBus(tenantId: string): MessageBus | undefined {
    return this.messageBus.get(tenantId);
  }

  /**
   * Get the checkpoint manager.
   */
  getCheckpointManager(): CheckpointManager {
    return this.checkpointManager;
  }

  /**
   * Get the underlying engine.
   */
  getEngine(): AgentEngine {
    return this.engine;
  }

  /**
   * Get the registry.
   */
  getRegistry(): AgentRegistry {
    return this.registry;
  }

  // ─── Private Methods ──────────────────────────────────────────

  /**
   * Track a new active session.
   */
  private trackSession(
    context: AgentContext,
    tenantId: string,
    handoffDepth: number,
    parentSessionId: string | undefined,
    correlationId: string,
  ): void {
    this.activeSessions.set(context.sessionId, {
      context,
      tenantId,
      handoffDepth,
      parentSessionId,
      correlationId,
    });

    const tenantSet = this.tenantSessions.get(tenantId) ?? new Set<string>();
    tenantSet.add(context.sessionId);
    this.tenantSessions.set(tenantId, tenantSet);
  }

  /**
   * Remove a session from tracking.
   */
  private removeSession(sessionId: string, tenantId: string): void {
    this.activeSessions.delete(sessionId);

    const tenantSet = this.tenantSessions.get(tenantId);
    if (tenantSet !== undefined) {
      tenantSet.delete(sessionId);
      if (tenantSet.size === 0) {
        this.tenantSessions.delete(tenantId);
      }
    }
  }

  /**
   * Get or create a message bus for a tenant.
   */
  private getOrCreateBus(tenantId: string): MessageBus {
    let bus = this.messageBus.get(tenantId);
    if (bus === undefined) {
      bus = new MessageBus(tenantId);
      this.messageBus.set(tenantId, bus);
    }
    return bus;
  }

  /**
   * Extract preserved memory observations from a context.
   * Returns metadata-only strings — NO raw PII/PHI.
   */
  private extractPreservedMemory(context: AgentContext): readonly string[] {
    const preserved: string[] = [];
    const steps = context.memory.steps;

    for (const step of steps) {
      if (step.type === 'act' && step.toolUsed !== undefined) {
        preserved.push(`Tool "${step.toolUsed}" executed (confidence: ${String(step.confidence)})`);
      }
    }

    return preserved;
  }

  /**
   * Update the context's memory state from the working memory.
   */
  private updateContextMemory(context: AgentContext, memory: AgentMemory): void {
    const state = memory.toState();
    (context as { memory: typeof state }).memory = state;
  }
}
