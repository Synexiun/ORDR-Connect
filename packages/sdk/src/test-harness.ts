/**
 * AgentTestHarness — Test framework for SDK agent developers
 *
 * Provides a mock execution environment that simulates the full
 * agent loop: observe -> think -> act -> check.
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Mock compliance engine allows configurable pass/fail
 * - Budget enforcement is tested in isolation
 * - Audit trail is captured for assertion
 *
 * COMPLIANCE:
 * - Test harness validates all actions pass compliance checks
 * - Budget assertions verify agent stays within bounds
 * - Audit trail assertions ensure all actions are logged
 */

import { ok, err, ValidationError, isOk } from '@ordr/core';
import type { Result, AppError, AgentRole } from '@ordr/core';
import { createAgentRole } from '@ordr/core';
import type {
  AgentPackage,
  ToolDefinition,
  ToolExecutionContext,
  AgentBudgetConfig,
} from './types.js';

// ─── Audit Log Entry ───────────────────────────────────────────

export interface AuditLogEntry {
  readonly timestamp: Date;
  readonly action: string;
  readonly toolName: string | undefined;
  readonly input: unknown;
  readonly output: unknown;
  readonly confidence: number;
  readonly compliancePassed: boolean;
}

// ─── Scenario Definition ───────────────────────────────────────

export interface TestScenario {
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly expectedOutcome: 'completed' | 'escalated' | 'failed' | 'budget_exceeded' | 'compliance_blocked';
  readonly expectedActions?: readonly string[];
  readonly maxSteps?: number;
}

// ─── Scenario Result ───────────────────────────────────────────

export interface ScenarioResult {
  readonly scenario: string;
  readonly passed: boolean;
  readonly outcome: string;
  readonly stepsExecuted: number;
  readonly totalTokensUsed: number;
  readonly totalCostCents: number;
  readonly actionsExecuted: readonly string[];
  readonly auditTrail: readonly AuditLogEntry[];
  readonly errors: readonly string[];
}

// ─── Mock Compliance Engine ────────────────────────────────────

export interface MockComplianceConfig {
  /** If true, all compliance checks pass. If false, all fail. */
  readonly defaultAllow: boolean;
  /** Specific actions to block, even if defaultAllow is true. */
  readonly blockedActions: readonly string[];
  /** Specific actions to allow, even if defaultAllow is false. */
  readonly allowedActions: readonly string[];
}

// ─── Mock Memory ───────────────────────────────────────────────

class MockMemory {
  private readonly _store: Map<string, unknown> = new Map();

  set(key: string, value: unknown): void {
    this._store.set(key, value);
  }

  get(key: string): unknown {
    return this._store.get(key);
  }

  has(key: string): boolean {
    return this._store.has(key);
  }

  getAll(): ReadonlyMap<string, unknown> {
    return new Map(this._store);
  }

  clear(): void {
    this._store.clear();
  }
}

// ─── AgentTestHarness ──────────────────────────────────────────

export class AgentTestHarness {
  private readonly _agent: AgentPackage;
  private readonly _toolRegistry: Map<string, ToolDefinition>;
  private readonly _auditLog: AuditLogEntry[] = [];
  private readonly _memory: MockMemory;
  private _complianceConfig: MockComplianceConfig;
  private _budgetUsed: {
    tokens: number;
    costCents: number;
    actions: number;
  };

  constructor(agent: AgentPackage) {
    this._agent = agent;
    this._toolRegistry = new Map();
    this._memory = new MockMemory();
    this._complianceConfig = {
      defaultAllow: true,
      blockedActions: [],
      allowedActions: [],
    };
    this._budgetUsed = { tokens: 0, costCents: 0, actions: 0 };

    // Register all agent tools
    for (const tool of agent.tools) {
      this._toolRegistry.set(tool.name, tool);
    }
  }

  /**
   * Configure the mock compliance engine.
   */
  configureCompliance(config: MockComplianceConfig): this {
    this._complianceConfig = config;
    return this;
  }

  /**
   * Set an initial observation in memory.
   */
  setObservation(key: string, value: unknown): this {
    this._memory.set(key, value);
    return this;
  }

  /**
   * Reset the harness state for a new scenario.
   */
  reset(): void {
    this._auditLog.length = 0;
    this._memory.clear();
    this._budgetUsed = { tokens: 0, costCents: 0, actions: 0 };
  }

  /**
   * Check if an action passes compliance.
   */
  private checkCompliance(action: string): boolean {
    // Check specific allowlist first
    if (this._complianceConfig.allowedActions.includes(action)) {
      return true;
    }

    // Check specific blocklist
    if (this._complianceConfig.blockedActions.includes(action)) {
      return false;
    }

    // Fall back to default
    return this._complianceConfig.defaultAllow;
  }

  /**
   * Execute a tool by name with given params.
   */
  async executeTool(
    toolName: string,
    params: unknown,
    confidence: number = 0.85,
  ): Promise<Result<unknown, AppError>> {
    const tool = this._toolRegistry.get(toolName);
    if (tool === undefined) {
      const entry: AuditLogEntry = {
        timestamp: new Date(),
        action: 'tool_not_found',
        toolName,
        input: params,
        output: null,
        confidence,
        compliancePassed: false,
      };
      this._auditLog.push(entry);
      return err(new ValidationError(
        `Tool not found: ${toolName}`,
        { tool: [`Unknown tool: ${toolName}`] },
      ));
    }

    // Compliance check
    const compliancePassed = this.checkCompliance(toolName);
    if (!compliancePassed) {
      const entry: AuditLogEntry = {
        timestamp: new Date(),
        action: 'compliance_blocked',
        toolName,
        input: params,
        output: null,
        confidence,
        compliancePassed: false,
      };
      this._auditLog.push(entry);
      return err(new ValidationError(
        `Compliance check failed for tool: ${toolName}`,
        { compliance: [`Action blocked: ${toolName}`] },
      ));
    }

    // Budget check
    this._budgetUsed.actions += 1;
    this._budgetUsed.tokens += 1000; // Simulated per-action cost
    this._budgetUsed.costCents += 5; // Simulated per-action cost

    if (this._budgetUsed.actions > this._agent.manifest.maxBudget.maxActions) {
      const entry: AuditLogEntry = {
        timestamp: new Date(),
        action: 'budget_exceeded',
        toolName,
        input: params,
        output: null,
        confidence,
        compliancePassed: true,
      };
      this._auditLog.push(entry);
      return err(new ValidationError(
        'Budget exceeded: maxActions',
        { budget: ['Action limit exceeded'] },
      ));
    }

    if (this._budgetUsed.tokens > this._agent.manifest.maxBudget.maxTokens) {
      const entry: AuditLogEntry = {
        timestamp: new Date(),
        action: 'budget_exceeded',
        toolName,
        input: params,
        output: null,
        confidence,
        compliancePassed: true,
      };
      this._auditLog.push(entry);
      return err(new ValidationError(
        'Budget exceeded: maxTokens',
        { budget: ['Token limit exceeded'] },
      ));
    }

    if (this._budgetUsed.costCents > this._agent.manifest.maxBudget.maxCostCents) {
      const entry: AuditLogEntry = {
        timestamp: new Date(),
        action: 'budget_exceeded',
        toolName,
        input: params,
        output: null,
        confidence,
        compliancePassed: true,
      };
      this._auditLog.push(entry);
      return err(new ValidationError(
        'Budget exceeded: maxCostCents',
        { budget: ['Cost limit exceeded'] },
      ));
    }

    // Execute the tool
    const context: ToolExecutionContext = {
      sessionId: 'test-session-001',
      tenantId: 'test-tenant-001',
      customerId: 'test-customer-001',
      agentRole: createAgentRole(this._agent.manifest.name.replace(/-/g, '_')),
      timestamp: new Date(),
    };

    const result = await tool.execute(params, context);

    const entry: AuditLogEntry = {
      timestamp: new Date(),
      action: 'tool_executed',
      toolName,
      input: params,
      output: isOk(result) ? result.data : null,
      confidence,
      compliancePassed: true,
    };
    this._auditLog.push(entry);

    return result;
  }

  /**
   * Run a test scenario against the agent.
   */
  async runScenario(scenario: TestScenario): Promise<ScenarioResult> {
    this.reset();

    // Set up initial observations from scenario input
    for (const [key, value] of Object.entries(scenario.input)) {
      this._memory.set(key, value);
    }

    const actionsExecuted: string[] = [];
    const errors: string[] = [];
    const maxSteps = scenario.maxSteps ?? 10;
    let outcome = 'completed';

    // Simulate the agent loop
    for (let step = 0; step < maxSteps; step++) {
      // Determine next action from tools
      const nextTool = this._agent.tools[step % this._agent.tools.length];
      if (nextTool === undefined) {
        break;
      }

      const result = await this.executeTool(nextTool.name, scenario.input);

      if (isOk(result)) {
        actionsExecuted.push(nextTool.name);
      } else {
        const errorMsg = result.error.message;
        errors.push(errorMsg);

        if (errorMsg.includes('Budget exceeded')) {
          outcome = 'budget_exceeded';
          break;
        }

        if (errorMsg.includes('Compliance check failed')) {
          outcome = 'compliance_blocked';
          break;
        }

        outcome = 'failed';
        break;
      }

      // Check if expected actions are satisfied
      if (scenario.expectedActions !== undefined &&
          scenario.expectedActions.length > 0 &&
          scenario.expectedActions.every(a => actionsExecuted.includes(a))) {
        break;
      }
    }

    const passed = outcome === scenario.expectedOutcome;

    return {
      scenario: scenario.name,
      passed,
      outcome,
      stepsExecuted: actionsExecuted.length,
      totalTokensUsed: this._budgetUsed.tokens,
      totalCostCents: this._budgetUsed.costCents,
      actionsExecuted,
      auditTrail: [...this._auditLog],
      errors,
    };
  }

  /**
   * Assert all actions passed compliance checks.
   */
  assertCompliance(): Result<void, AppError> {
    const failures = this._auditLog.filter(e => !e.compliancePassed);
    if (failures.length > 0) {
      return err(new ValidationError(
        `${String(failures.length)} action(s) failed compliance checks`,
        {
          compliance: failures.map(f =>
            `${f.toolName ?? 'unknown'}: ${f.action}`,
          ),
        },
      ));
    }
    return ok(undefined);
  }

  /**
   * Assert budget was not exceeded.
   */
  assertBudgetWithin(budget: AgentBudgetConfig): Result<void, AppError> {
    const violations: string[] = [];

    if (this._budgetUsed.tokens > budget.maxTokens) {
      violations.push(
        `Tokens: ${String(this._budgetUsed.tokens)} > ${String(budget.maxTokens)}`,
      );
    }

    if (this._budgetUsed.costCents > budget.maxCostCents) {
      violations.push(
        `Cost: ${String(this._budgetUsed.costCents)} > ${String(budget.maxCostCents)}`,
      );
    }

    if (this._budgetUsed.actions > budget.maxActions) {
      violations.push(
        `Actions: ${String(this._budgetUsed.actions)} > ${String(budget.maxActions)}`,
      );
    }

    if (violations.length > 0) {
      return err(new ValidationError(
        'Budget exceeded',
        { budget: violations },
      ));
    }

    return ok(undefined);
  }

  /**
   * Assert all actions were logged in the audit trail.
   */
  assertAuditTrail(): Result<void, AppError> {
    if (this._auditLog.length === 0) {
      return err(new ValidationError(
        'Audit trail is empty — no actions were logged',
        { audit: ['No entries found'] },
      ));
    }

    const missingTimestamps = this._auditLog.filter(e => !(e.timestamp instanceof Date));
    if (missingTimestamps.length > 0) {
      return err(new ValidationError(
        'Audit entries missing timestamps',
        { audit: ['Entries without timestamps found'] },
      ));
    }

    return ok(undefined);
  }

  /**
   * Get the full audit log.
   */
  getAuditLog(): readonly AuditLogEntry[] {
    return [...this._auditLog];
  }

  /**
   * Get current budget usage.
   */
  getBudgetUsage(): {
    readonly tokens: number;
    readonly costCents: number;
    readonly actions: number;
  } {
    return { ...this._budgetUsed };
  }
}
