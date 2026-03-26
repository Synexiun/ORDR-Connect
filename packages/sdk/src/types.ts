/**
 * @ordr/sdk types — Agent SDK type definitions for ORDR-Connect
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Agents declare their data classifications and compliance requirements
 * - Tool definitions include classification metadata for enforcement
 * - Budget caps are mandatory — no unbounded agent execution
 *
 * COMPLIANCE:
 * - Manifests capture regulatory requirements (SOC2 CC6.1)
 * - License field enforces OSI-approved licenses only (Rule 8)
 * - Confidence thresholds enforced at manifest level (Rule 9)
 */

import type { z } from 'zod';
import type { Result, AgentRole } from '@ordr/core';
import type { AppError } from '@ordr/core';
import type { Regulation } from '@ordr/compliance';

// ─── Data Classification ───────────────────────────────────────

/** Data sensitivity levels aligned with CLAUDE.md Rule 6. */
export type SdkDataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

// ─── Tool Definition ───────────────────────────────────────────

/**
 * A tool available to an SDK-built agent.
 *
 * SECURITY: Each tool declares the data classifications it accesses
 * and the regulations it touches. These are validated at registration
 * and enforced at runtime.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: z.ZodType;
  readonly dataClassifications: readonly SdkDataClassification[];
  readonly regulations: readonly Regulation[];
  readonly execute: (
    params: unknown,
    context: ToolExecutionContext,
  ) => Promise<Result<unknown, AppError>>;
}

/**
 * Context passed to tool execution.
 * Contains session-level info without exposing internal state.
 */
export interface ToolExecutionContext {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly agentRole: AgentRole;
  readonly timestamp: Date;
}

// ─── Agent Budget ──────────────────────────────────────────────

/**
 * Budget constraints for an agent. All fields mandatory.
 * Enforcement is hard — exceeding any limit terminates the session.
 */
export interface AgentBudgetConfig {
  readonly maxTokens: number;
  readonly maxCostCents: number;
  readonly maxActions: number;
}

// ─── Prompt Builder ────────────────────────────────────────────

/**
 * Prompt builder function type for SDK agents.
 * SECURITY: MUST NOT include raw PII/PHI in output messages.
 */
export type SdkPromptBuilder = (context: {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly agentRole: AgentRole;
  readonly observations: ReadonlyMap<string, unknown>;
}) => readonly { readonly role: 'system' | 'user' | 'assistant'; readonly content: string }[];

// ─── Agent Manifest ────────────────────────────────────────────

/**
 * Full metadata manifest for an SDK-built agent.
 *
 * COMPLIANCE:
 * - License must be OSI-approved (Rule 8)
 * - Confidence threshold must be >= 0.7 (Rule 9)
 * - Budget caps are mandatory (Rule 9)
 * - All required regulations must be valid (Rule 9)
 */
export interface AgentManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly license: string;
  readonly requiredTools: readonly string[];
  readonly complianceRequirements: readonly Regulation[];
  readonly permissions: readonly SdkDataClassification[];
  readonly entryPoint: string;
  readonly minConfidenceThreshold: number;
  readonly maxBudget: AgentBudgetConfig;
}

// ─── Agent Package ─────────────────────────────────────────────

/**
 * A fully assembled agent package — manifest + prompt builder + tools.
 * Created via `AgentBuilder.build()`.
 */
export interface AgentPackage {
  readonly manifest: AgentManifest;
  readonly promptBuilder: SdkPromptBuilder;
  readonly tools: readonly ToolDefinition[];
}

// ─── Packaged Agent ────────────────────────────────────────────

/**
 * A packaged agent — ready for distribution or registration.
 * Includes content hash for integrity verification.
 */
export interface PackagedAgent {
  readonly manifest: AgentManifest;
  readonly contentHash: string;
  readonly signature: string;
  readonly createdAt: Date;
}

// ─── Validation Result ─────────────────────────────────────────

/**
 * Result of validating an agent manifest or package.
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}
