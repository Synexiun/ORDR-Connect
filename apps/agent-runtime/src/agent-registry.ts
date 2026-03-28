/**
 * Agent configuration registry — role-based agent config management
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Agent permissions use explicit tool allowlist per agent role
 * - Agents CANNOT modify their own tool set — fixed at session start via registry
 * - PromptBuilder functions NEVER include raw PII/PHI in system prompts
 * - Configs are frozen at construction — immutable at runtime
 *
 * COMPLIANCE:
 * - Tool allowlists enforce principle of least privilege (ISO 27001 A.9.1)
 * - Budget caps enforce cost controls per SOC2 CC6.1
 * - Per-tenant enable/disable provides kill switch granularity
 */

import type { AgentRole, AutonomyLevel, Result } from '@ordr/core';
import { createAgentRole, ok, err, ValidationError } from '@ordr/core';
import type { LLMMessage } from '@ordr/ai';
import type { AgentTool, AgentContext } from './types.js';
import type { AgentMemory } from './memory.js';

// ─── Types ──────────────────────────────────────────────────────

/**
 * Prompt builder function signature.
 * Builds LLM message array from agent context and working memory.
 * SECURITY: MUST NOT include raw PII/PHI in output messages.
 */
export type PromptBuilder = (context: AgentContext, memory: AgentMemory) => LLMMessage[];

/**
 * Configuration for an agent role.
 * Defines capabilities, constraints, and behavioral boundaries.
 */
export interface AgentConfig {
  readonly role: AgentRole;
  readonly displayName: string;
  readonly description: string;
  readonly defaultAutonomyLevel: AutonomyLevel;
  readonly maxAutonomyLevel: AutonomyLevel;
  readonly toolAllowlist: readonly string[];
  readonly systemPromptTemplate: string;
  readonly maxSteps: number;
  readonly maxTokensBudget: number;
  readonly maxCostCentsBudget: number;
  readonly maxActions: number;
  readonly enabled: boolean;
}

/**
 * Per-tenant role override for enable/disable control.
 * Provides tenant-level kill switch granularity.
 */
interface TenantRoleOverride {
  readonly tenantId: string;
  readonly role: AgentRole;
  readonly enabled: boolean;
}

// ─── Built-in Agent Configurations ──────────────────────────────

/**
 * Collections agent — debt collection and payment follow-up.
 * Tools: send_sms, lookup_customer, check_payment, schedule_followup
 */
const COLLECTIONS_CONFIG: AgentConfig = {
  role: createAgentRole('collections'),
  displayName: 'Collections Agent',
  description:
    'Handles debt collection outreach, payment follow-ups, and settlement negotiations. FDCPA/TCPA compliant.',
  defaultAutonomyLevel: 'supervised',
  maxAutonomyLevel: 'autonomous',
  toolAllowlist: ['send_sms', 'lookup_customer', 'check_payment', 'schedule_followup'],
  systemPromptTemplate:
    'You are a collections agent operating within the ORDR-Connect Customer Operations OS. Your role is to manage debt collection outreach while strictly adhering to FDCPA, TCPA, and all applicable regulations.',
  maxSteps: 10,
  maxTokensBudget: 100_000,
  maxCostCentsBudget: 500,
  maxActions: 20,
  enabled: true,
} as const;

/**
 * Support triage agent — customer issue classification and routing.
 * Tools: search_knowledge, categorize_ticket, route_ticket, lookup_customer
 */
const SUPPORT_TRIAGE_CONFIG: AgentConfig = {
  role: createAgentRole('support_triage'),
  displayName: 'Support Triage Agent',
  description:
    'Classifies incoming customer support requests, searches knowledge base for solutions, and routes to appropriate teams.',
  defaultAutonomyLevel: 'supervised',
  maxAutonomyLevel: 'supervised',
  toolAllowlist: ['search_knowledge', 'categorize_ticket', 'route_ticket', 'lookup_customer'],
  systemPromptTemplate:
    'You are a customer support triage agent operating within the ORDR-Connect Customer Operations OS. Your role is to understand customer issues, search for solutions, and route tickets to the right team.',
  maxSteps: 8,
  maxTokensBudget: 80_000,
  maxCostCentsBudget: 300,
  maxActions: 15,
  enabled: true,
} as const;

/**
 * Escalation agent — human handoff coordination.
 * Tools: escalate_to_human, summarize_conversation, create_ticket, lookup_customer
 */
const ESCALATION_CONFIG: AgentConfig = {
  role: createAgentRole('escalation'),
  displayName: 'Escalation Coordinator',
  description:
    'Coordinates escalation to human agents. Summarizes context, creates tickets, and ensures smooth handoff with full audit trail.',
  defaultAutonomyLevel: 'supervised',
  maxAutonomyLevel: 'supervised',
  toolAllowlist: [
    'escalate_to_human',
    'summarize_conversation',
    'create_ticket',
    'lookup_customer',
  ],
  systemPromptTemplate:
    'You are an escalation coordinator operating within the ORDR-Connect Customer Operations OS. Your role is to assess severity, summarize context, create tickets, and coordinate handoff to human agents.',
  maxSteps: 6,
  maxTokensBudget: 60_000,
  maxCostCentsBudget: 200,
  maxActions: 10,
  enabled: true,
} as const;

/**
 * Healthcare agent — HIPAA-compliant patient operations.
 * Tools: lookup_patient, schedule_appointment, check_care_plan, send_health_reminder
 *
 * COMPLIANCE:
 * - HIPAA §164.502(b) — minimum necessary access
 * - HIPAA §164.312(b) — audit controls for all PHI access
 * - Max autonomy level capped at 'supervised' — always requires HITL for level 4-5
 * - Budget constrained: maxTokens 50000, maxCostCents 200, maxActions 10
 */
const HEALTHCARE_CONFIG: AgentConfig = {
  role: createAgentRole('healthcare'),
  displayName: 'Healthcare Agent',
  description:
    'HIPAA-compliant healthcare operations: appointment scheduling, patient follow-up, care coordination, and prescription reminders. All PHI access is tokenized and audit-logged.',
  defaultAutonomyLevel: 'supervised',
  maxAutonomyLevel: 'supervised',
  toolAllowlist: [
    'lookup_patient',
    'schedule_appointment',
    'check_care_plan',
    'send_health_reminder',
  ],
  systemPromptTemplate:
    'You are a HIPAA-compliant healthcare operations agent within the ORDR-Connect Customer Operations OS. Your role is to manage appointment scheduling, patient follow-up, care coordination, and health reminders while maintaining strict HIPAA compliance.',
  maxSteps: 10,
  maxTokensBudget: 50_000,
  maxCostCentsBudget: 200,
  maxActions: 10,
  enabled: true,
} as const;

/**
 * Lead qualifier agent — ICP scoring and sales pipeline entry.
 * Tools: lookup_customer, search_knowledge, schedule_followup, send_sms
 *
 * COMPLIANCE: TCPA consent required before every outbound message.
 */
const LEAD_QUALIFIER_CONFIG: AgentConfig = {
  role: createAgentRole('lead_qualifier'),
  displayName: 'Lead Qualifier',
  description:
    'Qualifies inbound and outbound leads against ICP criteria using BANT framework. Routes qualified leads to sales pipeline. TCPA-compliant outreach.',
  defaultAutonomyLevel: 'supervised',
  maxAutonomyLevel: 'autonomous',
  toolAllowlist: ['lookup_customer', 'search_knowledge', 'schedule_followup', 'send_sms'],
  systemPromptTemplate:
    'You are a lead_qualifier agent. Qualify leads against ICP criteria and route to sales.',
  maxSteps: 8,
  maxTokensBudget: 80_000,
  maxCostCentsBudget: 300,
  maxActions: 15,
  enabled: true,
} as const;

/**
 * Follow-up agent — post-interaction follow-up and relationship nurturing.
 * Uses collections prompt (FDCPA/TCPA compliance is required for payment follow-ups).
 * Tools: send_sms, lookup_customer, check_payment, schedule_followup
 */
const FOLLOW_UP_CONFIG: AgentConfig = {
  role: createAgentRole('follow_up'),
  displayName: 'Follow-Up Agent',
  description:
    'Manages post-interaction follow-up sequences: payment reminders, satisfaction check-ins, and re-engagement. FDCPA/TCPA compliant.',
  defaultAutonomyLevel: 'supervised',
  maxAutonomyLevel: 'autonomous',
  toolAllowlist: ['send_sms', 'lookup_customer', 'check_payment', 'schedule_followup'],
  systemPromptTemplate:
    'You are a follow_up agent. Manage post-interaction follow-up while respecting FDCPA and TCPA.',
  maxSteps: 8,
  maxTokensBudget: 80_000,
  maxCostCentsBudget: 300,
  maxActions: 15,
  enabled: true,
} as const;

/**
 * Meeting prep agent — pre-meeting briefing and context assembly.
 * READ-ONLY: may not initiate outbound communications.
 * Tools: lookup_customer, search_knowledge, summarize_conversation
 */
const MEETING_PREP_CONFIG: AgentConfig = {
  role: createAgentRole('meeting_prep'),
  displayName: 'Meeting Prep Agent',
  description:
    'Assembles pre-meeting briefings: account history, key contacts, open issues, suggested agenda. Read-only — no outbound actions.',
  defaultAutonomyLevel: 'supervised',
  maxAutonomyLevel: 'supervised',
  toolAllowlist: ['lookup_customer', 'search_knowledge', 'summarize_conversation'],
  systemPromptTemplate:
    'You are a meeting_prep agent. Assemble factual pre-meeting briefings from account data.',
  maxSteps: 6,
  maxTokensBudget: 60_000,
  maxCostCentsBudget: 200,
  maxActions: 10,
  enabled: true,
} as const;

/**
 * Churn detection agent — health scoring and retention trigger.
 * Tools: lookup_customer, search_knowledge, schedule_followup, send_sms
 *
 * COMPLIANCE: TCPA consent required before retention outreach.
 * Budget capped — health analysis is read-heavy, not action-heavy.
 */
const CHURN_DETECTION_CONFIG: AgentConfig = {
  role: createAgentRole('churn_detection'),
  displayName: 'Churn Detection Agent',
  description:
    'Monitors customer health signals and classifies churn risk (LOW/MEDIUM/HIGH). Triggers retention outreach for HIGH risk and schedules check-ins for MEDIUM.',
  defaultAutonomyLevel: 'supervised',
  maxAutonomyLevel: 'autonomous',
  toolAllowlist: ['lookup_customer', 'search_knowledge', 'schedule_followup', 'send_sms'],
  systemPromptTemplate:
    'You are a churn_detection agent. Score churn risk and trigger retention actions.',
  maxSteps: 8,
  maxTokensBudget: 80_000,
  maxCostCentsBudget: 300,
  maxActions: 12,
  enabled: true,
} as const;

/**
 * Executive briefing agent — C-suite-grade account summaries.
 * READ-ONLY: produces briefings, never initiates contact.
 * Tools: lookup_customer, summarize_conversation, search_knowledge
 */
const EXECUTIVE_BRIEFING_CONFIG: AgentConfig = {
  role: createAgentRole('executive_briefing'),
  displayName: 'Executive Briefing Agent',
  description:
    'Generates concise, data-backed executive briefings covering relationship health, key metrics, open risks, and recommended actions. Read-only.',
  defaultAutonomyLevel: 'supervised',
  maxAutonomyLevel: 'supervised',
  toolAllowlist: ['lookup_customer', 'summarize_conversation', 'search_knowledge'],
  systemPromptTemplate:
    'You are an executive_briefing agent. Produce concise, factual executive summaries.',
  maxSteps: 6,
  maxTokensBudget: 60_000,
  maxCostCentsBudget: 200,
  maxActions: 8,
  enabled: true,
} as const;

/** All built-in agent configurations — covers every WellKnownAgentRole. */
const BUILT_IN_CONFIGS: readonly AgentConfig[] = [
  COLLECTIONS_CONFIG,
  FOLLOW_UP_CONFIG,
  LEAD_QUALIFIER_CONFIG,
  MEETING_PREP_CONFIG,
  CHURN_DETECTION_CONFIG,
  SUPPORT_TRIAGE_CONFIG,
  ESCALATION_CONFIG,
  HEALTHCARE_CONFIG,
  EXECUTIVE_BRIEFING_CONFIG,
] as const;

// ─── AgentRegistry ──────────────────────────────────────────────

export class AgentRegistry {
  private readonly configs: Map<AgentRole, AgentConfig>;
  private readonly promptBuilders: Map<AgentRole, PromptBuilder> = new Map();
  private readonly tenantOverrides: Map<string, TenantRoleOverride> = new Map();
  private readonly builtInRoles: ReadonlySet<string>;

  constructor(configs?: readonly AgentConfig[]) {
    const configMap = new Map<AgentRole, AgentConfig>();
    const allConfigs = configs ?? BUILT_IN_CONFIGS;
    const builtInSet = new Set<string>();

    for (const config of allConfigs) {
      configMap.set(config.role, config);
      builtInSet.add(config.role);
    }

    this.configs = configMap;
    this.builtInRoles = builtInSet;
  }

  /**
   * Get the configuration for a specific agent role.
   * Returns undefined if the role is not registered.
   */
  getConfig(agentRole: AgentRole): AgentConfig | undefined {
    return this.configs.get(agentRole);
  }

  /**
   * Get the allowed tools for a role, filtered from available tools.
   * Only tools in the role's allowlist AND in the full tool set are returned.
   *
   * SECURITY: This enforces principle of least privilege —
   * agents only get the tools they are explicitly allowed.
   */
  getToolsForRole(
    agentRole: AgentRole,
    allTools: ReadonlyMap<string, AgentTool>,
  ): Map<string, AgentTool> {
    const config = this.configs.get(agentRole);
    if (config === undefined) {
      return new Map();
    }

    const roleTools = new Map<string, AgentTool>();
    for (const toolName of config.toolAllowlist) {
      const tool = allTools.get(toolName);
      if (tool !== undefined) {
        roleTools.set(toolName, tool);
      }
    }

    return roleTools;
  }

  /**
   * Get the prompt builder for a role.
   * Falls back to undefined if no builder has been registered.
   */
  getPromptBuilderForRole(agentRole: AgentRole): PromptBuilder | undefined {
    return this.promptBuilders.get(agentRole);
  }

  /**
   * Register a prompt builder for an agent role.
   */
  registerPromptBuilder(agentRole: AgentRole, builder: PromptBuilder): void {
    this.promptBuilders.set(agentRole, builder);
  }

  /**
   * Get all registered roles.
   */
  getAllRoles(): readonly AgentRole[] {
    return [...this.configs.keys()];
  }

  /**
   * Check if a role is enabled, considering tenant-level overrides.
   *
   * Priority:
   * 1. Tenant-specific override (if set)
   * 2. Global config enabled flag
   */
  isRoleEnabled(agentRole: AgentRole, tenantId: string): boolean {
    // Check tenant-level override first
    const overrideKey = `${tenantId}:${agentRole}`;
    const override = this.tenantOverrides.get(overrideKey);
    if (override !== undefined) {
      return override.enabled;
    }

    // Fall back to global config
    const config = this.configs.get(agentRole);
    if (config === undefined) {
      return false;
    }

    return config.enabled;
  }

  /**
   * Set a tenant-level override for a role's enabled status.
   * Used for tenant-level kill switches.
   */
  setTenantRoleOverride(tenantId: string, role: AgentRole, enabled: boolean): void {
    const key = `${tenantId}:${role}`;
    this.tenantOverrides.set(key, { tenantId, role, enabled });
  }

  /**
   * Clear a tenant-level override, reverting to global config.
   */
  clearTenantRoleOverride(tenantId: string, role: AgentRole): void {
    const key = `${tenantId}:${role}`;
    this.tenantOverrides.delete(key);
  }

  // ─── Dynamic Registration (SDK Plugin Support) ───────────────

  /**
   * Register a dynamically-created agent from an SDK manifest.
   * Validates the manifest's role, checks for duplicates, and registers the agent config.
   *
   * COMPLIANCE (Rule 9): Agent registration is an auditable action.
   * Caller is responsible for logging the registration event.
   */
  registerFromManifest(
    manifest: {
      readonly name: string;
      readonly version: string;
      readonly description: string;
      readonly requiredTools: readonly string[];
      readonly minConfidenceThreshold: number;
      readonly maxBudget: {
        readonly maxTokens: number;
        readonly maxCostCents: number;
        readonly maxActions: number;
      };
    },
    promptBuilder: PromptBuilder,
    tools: readonly AgentTool[],
  ): Result<void> {
    // Validate role name format
    let role: AgentRole;
    try {
      role = createAgentRole(manifest.name);
    } catch {
      return err(
        new ValidationError(
          `Invalid agent name "${manifest.name}": must be lowercase alphanumeric + underscores, 1-64 chars`,
          { name: [`Invalid format: ${manifest.name}`] },
        ),
      );
    }

    // Check for duplicate registration
    if (this.configs.has(role)) {
      return err(
        new ValidationError(`Agent "${manifest.name}" is already registered`, {
          name: [`Duplicate: ${manifest.name}`],
        }),
      );
    }

    // Verify all required tools are provided
    const providedToolNames = new Set(tools.map((t) => t.name));
    const missingTools = manifest.requiredTools.filter((t) => !providedToolNames.has(t));
    if (missingTools.length > 0) {
      return err(
        new ValidationError(`Missing required tools: ${missingTools.join(', ')}`, {
          tools: missingTools.map((t) => `Missing: ${t}`),
        }),
      );
    }

    // Build the agent config from the manifest
    const config: AgentConfig = {
      role,
      displayName: manifest.name,
      description: manifest.description,
      defaultAutonomyLevel: 'supervised',
      maxAutonomyLevel: 'supervised',
      toolAllowlist: [...manifest.requiredTools],
      systemPromptTemplate: `You are a ${manifest.name} agent (v${manifest.version}). ${manifest.description}`,
      maxSteps: 10,
      maxTokensBudget: manifest.maxBudget.maxTokens,
      maxCostCentsBudget: manifest.maxBudget.maxCostCents,
      maxActions: manifest.maxBudget.maxActions,
      enabled: true,
    };

    this.configs.set(role, config);
    this.promptBuilders.set(role, promptBuilder);

    return ok(undefined);
  }

  /**
   * Unregister a dynamically registered agent.
   * Built-in agents cannot be unregistered.
   */
  unregister(name: string): Result<void> {
    let role: AgentRole;
    try {
      role = createAgentRole(name);
    } catch {
      return err(
        new ValidationError(`Invalid agent name "${name}"`, { name: [`Invalid format: ${name}`] }),
      );
    }

    if (this.builtInRoles.has(role)) {
      return err(
        new ValidationError(`Cannot unregister built-in agent "${name}"`, {
          name: [`Built-in: ${name}`],
        }),
      );
    }

    if (!this.configs.has(role)) {
      return err(
        new ValidationError(`Agent "${name}" is not registered`, { name: [`Not found: ${name}`] }),
      );
    }

    this.configs.delete(role);
    this.promptBuilders.delete(role);

    return ok(undefined);
  }

  /**
   * List all registered agent configs — both built-in and dynamic.
   */
  listRegistered(): AgentConfig[] {
    return [...this.configs.values()];
  }

  /**
   * Check if an agent is a built-in (vs dynamically registered).
   */
  isBuiltIn(name: string): boolean {
    return this.builtInRoles.has(name);
  }
}
