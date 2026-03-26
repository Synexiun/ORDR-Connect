/**
 * @ordr/sdk — Agent SDK for ORDR-Connect
 *
 * Provides the full toolkit for building, testing, and packaging
 * custom agents within the ORDR-Connect Customer Operations OS.
 *
 * Usage:
 *   import { AgentBuilder, AgentTestHarness, packageAgent } from '@ordr/sdk';
 *
 *   const agent = new AgentBuilder('my-agent')
 *     .version('1.0.0')
 *     .description('Custom agent')
 *     .author('partner@example.com')
 *     .license('MIT')
 *     .withPromptBuilder(myPromptFn)
 *     .build();
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  AgentManifest,
  AgentPackage,
  PackagedAgent,
  ToolDefinition,
  ToolExecutionContext,
  SdkPromptBuilder,
  AgentBudgetConfig,
  SdkDataClassification,
  ValidationResult,
} from './types.js';

// ─── Manifest Validator ──────────────────────────────────────────
export {
  validateManifest,
  checkManifest,
  agentManifestSchema,
  OSI_APPROVED_LICENSES,
  PLATFORM_BUDGET_LIMITS,
  MIN_CONFIDENCE_THRESHOLD,
} from './manifest-validator.js';

// ─── Agent Builder ───────────────────────────────────────────────
export { AgentBuilder } from './agent-builder.js';

// ─── Test Harness ────────────────────────────────────────────────
export { AgentTestHarness } from './test-harness.js';
export type {
  AuditLogEntry,
  TestScenario,
  ScenarioResult,
  MockComplianceConfig,
} from './test-harness.js';

// ─── Packager ────────────────────────────────────────────────────
export {
  packageAgent,
  verifyPackage,
} from './packager.js';
