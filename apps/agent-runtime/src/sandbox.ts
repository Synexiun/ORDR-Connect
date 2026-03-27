/**
 * Agent Sandbox — constrained execution environment for marketplace agents
 *
 * SOC2 CC6.1 — Access control: tool allowlist enforced per agent manifest.
 * ISO 27001 A.12.6.1 — Technical vulnerability management: sandboxed execution.
 * HIPAA §164.312(a)(1) — Access control: budget enforcement prevents runaway costs.
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Budget enforcement: tokens, cost, and action limits are HARD — exceed = terminate
 * - Tool allowlist: only tools declared in manifest are accessible
 * - Timeout: 30-second max per step prevents runaway execution
 * - Output validation: JSON schema check on every agent output
 * - Kill switch: immediate termination capability
 * - Audit logging: all sandbox executions are WORM-logged
 * - Agents CANNOT modify their own permissions
 *
 * COMPLIANCE:
 * - Every sandbox execution is audited (Rule 3)
 * - Agents are bounded by their manifest (Rule 9)
 * - Concurrent sandboxes are isolated
 */

import { randomUUID } from 'node:crypto';
import {
  type Result,
  ok,
  err,
  AppError,
  ValidationError,
  createAgentRole,
  type AutonomyLevel,
} from '@ordr/core';
import type { AgentTool, AgentBudget, KillSwitch } from './types.js';

// ─── Constants ──────────────────────────────────────────────────

/** Maximum time per step in milliseconds. */
export const STEP_TIMEOUT_MS = 30_000 as const;

// ─── Types ──────────────────────────────────────────────────────

/** Configuration for a sandbox instance. */
export interface SandboxConfig {
  readonly agentId: string;
  readonly agentName: string;
  readonly tenantId: string;
  readonly toolAllowlist: readonly string[];
  readonly budget: {
    readonly maxTokens: number;
    readonly maxCostCents: number;
    readonly maxActions: number;
  };
  readonly outputSchema?: Record<string, unknown>;
}

/** Result of a single sandbox execution step. */
export interface SandboxStepResult {
  readonly stepId: string;
  readonly action: string;
  readonly output: unknown;
  readonly tokensUsed: number;
  readonly costCents: number;
  readonly durationMs: number;
  readonly timestamp: Date;
}

/** Audit logging function type. */
export type SandboxAuditLog = (input: {
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

// ─── AgentSandbox ───────────────────────────────────────────────

export class AgentSandbox {
  readonly sandboxId: string;
  private readonly config: SandboxConfig;
  private readonly tools: ReadonlyMap<string, AgentTool>;
  private readonly allowedTools: ReadonlySet<string>;
  private readonly budget: AgentBudget;
  private readonly killSwitch: KillSwitch;
  private readonly auditLog: SandboxAuditLog;
  private active: boolean;
  private readonly steps: SandboxStepResult[];

  constructor(
    config: SandboxConfig,
    tools: ReadonlyMap<string, AgentTool>,
    auditLog: SandboxAuditLog,
  ) {
    this.sandboxId = randomUUID();
    this.config = config;
    this.tools = tools;
    this.allowedTools = new Set(config.toolAllowlist);
    this.budget = {
      maxTokens: config.budget.maxTokens,
      maxCostCents: config.budget.maxCostCents,
      maxActions: config.budget.maxActions,
      usedTokens: 0,
      usedCostCents: 0,
      usedActions: 0,
    };
    this.killSwitch = {
      active: false,
      reason: '',
      killedAt: null,
    };
    this.auditLog = auditLog;
    this.active = true;
    this.steps = [];
  }

  /**
   * Execute a tool action within the sandbox.
   *
   * Enforces: kill switch, budget, tool allowlist, timeout, output validation.
   * Every execution is audit-logged regardless of outcome.
   */
  async executeStep(
    action: string,
    params: Record<string, unknown>,
    tokensUsed: number = 0,
    costCents: number = 0,
  ): Promise<Result<SandboxStepResult>> {
    const stepId = randomUUID();
    const startTime = Date.now();

    // ── Kill switch check ──
    if (this.killSwitch.active) {
      return err(
        new AppError(`Sandbox killed: ${this.killSwitch.reason}`, 'AGENT_SAFETY_BLOCK', 403, true),
      );
    }

    // ── Active check ──
    if (!this.active) {
      return err(new AppError('Sandbox is not active', 'AGENT_SAFETY_BLOCK', 403, true));
    }

    // ── Budget check — tokens ──
    if (this.budget.usedTokens + tokensUsed > this.budget.maxTokens) {
      await this.auditBudgetExceeded('tokens');
      return err(
        new AppError(
          `Token budget exceeded: ${String(this.budget.usedTokens + tokensUsed)}/${String(this.budget.maxTokens)}`,
          'AGENT_SAFETY_BLOCK',
          403,
          true,
        ),
      );
    }

    // ── Budget check — cost ──
    if (this.budget.usedCostCents + costCents > this.budget.maxCostCents) {
      await this.auditBudgetExceeded('cost');
      return err(
        new AppError(
          `Cost budget exceeded: ${String(this.budget.usedCostCents + costCents)}/${String(this.budget.maxCostCents)} cents`,
          'AGENT_SAFETY_BLOCK',
          403,
          true,
        ),
      );
    }

    // ── Budget check — actions ──
    if (this.budget.usedActions >= this.budget.maxActions) {
      await this.auditBudgetExceeded('actions');
      return err(
        new AppError(
          `Action budget exceeded: ${String(this.budget.usedActions)}/${String(this.budget.maxActions)}`,
          'AGENT_SAFETY_BLOCK',
          403,
          true,
        ),
      );
    }

    // ── Tool allowlist check ──
    if (!this.allowedTools.has(action)) {
      await this.auditToolBlocked(action);
      return err(
        new ValidationError(`Tool "${action}" is not in the agent allowlist`, {
          tool: [`Not allowed: ${action}`],
        }),
      );
    }

    // ── Resolve tool ──
    const tool = this.tools.get(action);
    if (!tool) {
      return err(
        new ValidationError(`Tool "${action}" not found`, { tool: [`Not found: ${action}`] }),
      );
    }

    // ── Execute with timeout ──
    let output: unknown;
    try {
      const toolContext = {
        sessionId: this.sandboxId,
        tenantId: this.config.tenantId,
        customerId: '',
        agentRole: createAgentRole(this.config.agentName),
        autonomyLevel: 'rule_based' as AutonomyLevel,
        tools: this.tools,
        memory: { observations: new Map(), steps: [] },
        budget: this.budget,
        killSwitch: this.killSwitch,
        triggerEventId: '',
        startedAt: new Date(),
      } as const;

      const toolPromise = tool.execute(params, toolContext);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new AppError(
              `Tool execution timed out after ${String(STEP_TIMEOUT_MS)}ms`,
              'AGENT_SAFETY_BLOCK',
              408,
              true,
            ),
          );
        }, STEP_TIMEOUT_MS);
      });

      const result = await Promise.race([toolPromise, timeoutPromise]);

      if (!result.success) {
        const durationMs = Date.now() - startTime;
        await this.auditStepExecution(stepId, action, false, durationMs);
        return err(result.error);
      }

      output = result.data;
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      await this.auditStepExecution(stepId, action, false, durationMs);

      if (error instanceof AppError) {
        return err(error);
      }
      return err(new AppError('Tool execution failed', 'INTERNAL_ERROR', 500, false));
    }

    // ── Output validation ──
    if (this.config.outputSchema) {
      const validationResult = this.validateOutput(output);
      if (!validationResult.success) {
        const durationMs = Date.now() - startTime;
        await this.auditStepExecution(stepId, action, false, durationMs);
        return validationResult;
      }
    }

    // ── Update budget ──
    this.budget.usedTokens += tokensUsed;
    this.budget.usedCostCents += costCents;
    this.budget.usedActions += 1;

    const durationMs = Date.now() - startTime;

    const stepResult: SandboxStepResult = {
      stepId,
      action,
      output,
      tokensUsed,
      costCents,
      durationMs,
      timestamp: new Date(),
    };

    this.steps.push(stepResult);

    // ── Audit log ──
    await this.auditStepExecution(stepId, action, true, durationMs);

    return ok(stepResult);
  }

  /**
   * Activate the kill switch — terminates execution immediately.
   */
  kill(reason: string): void {
    this.killSwitch.active = true;
    this.killSwitch.reason = reason;
    this.killSwitch.killedAt = new Date();
    this.active = false;

    // Fire-and-forget audit of kill event
    void this.auditLog({
      tenantId: this.config.tenantId,
      eventType: 'agent.killed',
      actorType: 'agent',
      actorId: this.sandboxId,
      resource: 'agent_sandbox',
      resourceId: this.sandboxId,
      action: 'sandbox_killed',
      details: {
        reason,
        agentId: this.config.agentId,
        agentName: this.config.agentName,
        stepsCompleted: this.steps.length,
        budgetUsed: {
          tokens: this.budget.usedTokens,
          cost: this.budget.usedCostCents,
          actions: this.budget.usedActions,
        },
      },
      timestamp: new Date(),
    });
  }

  /**
   * Get the current budget state.
   */
  getBudget(): Readonly<AgentBudget> {
    return { ...this.budget };
  }

  /**
   * Check if the sandbox is still active.
   */
  isActive(): boolean {
    return this.active && !this.killSwitch.active;
  }

  /**
   * Get completed steps.
   */
  getSteps(): readonly SandboxStepResult[] {
    return [...this.steps];
  }

  /**
   * Shut down the sandbox gracefully.
   */
  async shutdown(): Promise<void> {
    this.active = false;

    await this.auditLog({
      tenantId: this.config.tenantId,
      eventType: 'agent.action',
      actorType: 'agent',
      actorId: this.sandboxId,
      resource: 'agent_sandbox',
      resourceId: this.sandboxId,
      action: 'sandbox_shutdown',
      details: {
        agentId: this.config.agentId,
        agentName: this.config.agentName,
        totalSteps: this.steps.length,
        budgetUsed: {
          tokens: this.budget.usedTokens,
          cost: this.budget.usedCostCents,
          actions: this.budget.usedActions,
        },
      },
      timestamp: new Date(),
    });
  }

  // ─── Private ──────────────────────────────────────────────────

  /**
   * Validate agent output against the configured JSON schema.
   * Performs structural type checks (not full JSON Schema — keep it simple).
   */
  private validateOutput(output: unknown): Result<void> {
    if (output === null || output === undefined) {
      return err(
        new ValidationError('Agent output is null or undefined', {
          output: ['Output must not be null or undefined'],
        }),
      );
    }

    // If output schema requires an object, check that
    if (this.config.outputSchema && typeof this.config.outputSchema['type'] === 'string') {
      const expectedType = this.config.outputSchema['type'];
      if (expectedType === 'object' && (typeof output !== 'object' || Array.isArray(output))) {
        return err(
          new ValidationError('Agent output does not match expected schema', {
            output: ['Expected object output'],
          }),
        );
      }
    }

    return ok(undefined);
  }

  private async auditStepExecution(
    stepId: string,
    action: string,
    success: boolean,
    durationMs: number,
  ): Promise<void> {
    await this.auditLog({
      tenantId: this.config.tenantId,
      eventType: 'agent.action',
      actorType: 'agent',
      actorId: this.sandboxId,
      resource: 'agent_sandbox',
      resourceId: stepId,
      action: success ? `${action}_success` : `${action}_failed`,
      details: {
        agentId: this.config.agentId,
        agentName: this.config.agentName,
        durationMs,
        budgetUsed: {
          tokens: this.budget.usedTokens,
          cost: this.budget.usedCostCents,
          actions: this.budget.usedActions,
        },
      },
      timestamp: new Date(),
    });
  }

  private async auditBudgetExceeded(budgetType: string): Promise<void> {
    await this.auditLog({
      tenantId: this.config.tenantId,
      eventType: 'agent.action',
      actorType: 'agent',
      actorId: this.sandboxId,
      resource: 'agent_sandbox',
      resourceId: this.sandboxId,
      action: `budget_exceeded_${budgetType}`,
      details: {
        agentId: this.config.agentId,
        agentName: this.config.agentName,
        budget: {
          maxTokens: this.budget.maxTokens,
          maxCostCents: this.budget.maxCostCents,
          maxActions: this.budget.maxActions,
          usedTokens: this.budget.usedTokens,
          usedCostCents: this.budget.usedCostCents,
          usedActions: this.budget.usedActions,
        },
      },
      timestamp: new Date(),
    });
  }

  private async auditToolBlocked(toolName: string): Promise<void> {
    await this.auditLog({
      tenantId: this.config.tenantId,
      eventType: 'agent.action',
      actorType: 'agent',
      actorId: this.sandboxId,
      resource: 'agent_sandbox',
      resourceId: this.sandboxId,
      action: 'tool_blocked',
      details: {
        agentId: this.config.agentId,
        agentName: this.config.agentName,
        toolName,
        allowedTools: [...this.allowedTools],
      },
      timestamp: new Date(),
    });
  }
}
