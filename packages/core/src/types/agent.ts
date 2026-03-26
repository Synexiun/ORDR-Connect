/**
 * Agent types — AI agent framework for ORDR-Connect
 *
 * Agents operate under strict autonomy tiers. Every action is logged
 * with confidence scores and audit trails for compliance.
 */

import type { TenantId } from './tenant.js';

// ─── Branded Types ────────────────────────────────────────────────

declare const __agentIdBrand: unique symbol;

/** Branded string — prevents accidental use of raw strings as agent IDs */
export type AgentId = string & { readonly [__agentIdBrand]: never };

export function createAgentId(id: string): AgentId {
  if (!id || id.trim().length === 0) {
    throw new Error('AgentId cannot be empty');
  }
  return id as AgentId;
}

// ─── Agent Role ───────────────────────────────────────────────────

/** Well-known agent roles built into the platform. */
export const AGENT_ROLES = [
  'lead_qualifier',
  'follow_up',
  'meeting_prep',
  'churn_detection',
  'collections',
  'support_triage',
  'escalation',
  'executive_briefing',
] as const;

/** Well-known role literal union — used for type narrowing on built-in roles. */
export type WellKnownAgentRole = (typeof AGENT_ROLES)[number];

declare const __agentRoleBrand: unique symbol;

/**
 * Branded string type for agent roles.
 * Accepts both well-known roles and custom plugin-registered roles.
 * Created via `createAgentRole()` factory — validates format.
 */
export type AgentRole = string & { readonly [__agentRoleBrand]: never };

/** Regex: lowercase alphanumeric + underscores, 1–64 characters. */
const AGENT_ROLE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Factory function — creates a validated AgentRole from a raw string.
 * Validates: lowercase, alphanumeric + underscores, max 64 chars.
 * Throws on invalid input.
 */
export function createAgentRole(role: string): AgentRole {
  if (!AGENT_ROLE_PATTERN.test(role)) {
    throw new Error(
      `Invalid AgentRole "${role}": must be lowercase alphanumeric + underscores, 1-64 chars, starting with a letter`,
    );
  }
  return role as AgentRole;
}

/**
 * Check if a role is one of the well-known built-in roles.
 */
export function isWellKnownRole(role: AgentRole): role is AgentRole & WellKnownAgentRole {
  return (AGENT_ROLES as readonly string[]).includes(role);
}

// ─── Autonomy Levels ──────────────────────────────────────────────

export const AUTONOMY_LEVELS = [
  'rule_based',
  'router',
  'supervised',
  'autonomous',
  'full_autonomy',
] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/** Numeric ranking — higher = more autonomy */
const AUTONOMY_RANK: Record<AutonomyLevel, number> = {
  rule_based: 0,
  router: 1,
  supervised: 2,
  autonomous: 3,
  full_autonomy: 4,
} as const;

/** Returns true if levelA has equal or greater autonomy than levelB */
export function hasAutonomyAtLeast(
  levelA: AutonomyLevel,
  levelB: AutonomyLevel,
): boolean {
  return AUTONOMY_RANK[levelA] >= AUTONOMY_RANK[levelB];
}

// ─── Agent Action ─────────────────────────────────────────────────

export interface AgentAuditEntry {
  readonly step: string;
  readonly detail: string;
  readonly timestamp: Date;
}

export interface AgentAction {
  readonly id: string;
  readonly agentId: AgentId;
  readonly agentRole: AgentRole;
  readonly tenantId: TenantId;
  readonly actionType: string;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown> | null;
  readonly confidence: number;
  readonly autonomyLevel: AutonomyLevel;
  readonly approved: boolean;
  readonly auditTrail: readonly AgentAuditEntry[];
  readonly timestamp: Date;
}

// ─── Agent Status ─────────────────────────────────────────────────

export const AGENT_STATUSES = ['idle', 'processing', 'awaiting_approval', 'error', 'disabled'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
