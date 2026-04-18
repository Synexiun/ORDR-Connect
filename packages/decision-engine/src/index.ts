/**
 * @ordr/decision-engine — 3-Layer Decision Engine for ORDR-Connect
 *
 * Determines the Next-Best-Action for every customer interaction through:
 *   Layer 1: Deterministic Rules (sub-100ms)
 *   Layer 2: ML Scoring (probabilistic, stub models for MVP)
 *   Layer 3: LLM Reasoning (contextual, invoked when L1+L2 insufficient)
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - Every decision is WORM audit-logged with full layer chain
 * - PHI is NEVER sent to LLM or logged — only tokenized references
 * - Compliance gate checked on every final action
 * - All functions return Result<T, AppError>
 *
 * Usage:
 *   import { NBAPipeline, RulesEngine, MLScorer, LLMReasoner } from '@ordr/decision-engine';
 *
 *   const pipeline = new NBAPipeline({ rules, ml, llm, compliance, auditLogger });
 *   const result = await pipeline.evaluate(context);
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  DecisionLayer,
  RuleOperator,
  LifecycleStage,
  ActionType,
  ChannelType,
  CustomerProfile,
  PaymentEvent,
  InteractionRecord,
  DecisionConstraints,
  DecisionContext,
  RuleCondition,
  RuleDefinition,
  RuleAction,
  RuleResult,
  MLFeatureVector,
  MLPrediction,
  MLModel,
  NBACandidate,
  Decision,
  DecisionAuditEntry,
  ComplianceGateInterface,
  AuditLoggerInterface,
} from './types.js';

export {
  DECISION_LAYERS,
  RULE_OPERATORS,
  LIFECYCLE_STAGES,
  ACTION_TYPES,
  CHANNEL_TYPES,
} from './types.js';

// ─── Rules Engine (Layer 1) ──────────────────────────────────────
export {
  RulesEngine,
  InMemoryRuleStore,
  evaluateCondition,
  BUILTIN_RULES,
  copyBuiltinRulesForTenant,
} from './rules.js';
export type { RuleStore } from './rules.js';

// ─── Feature Assembler ──────────────────────────────────────────
export { assembleFeatures } from './feature-assembler.js';

// ─── ML Scorer (Layer 2) ────────────────────────────────────────
export {
  MLScorer,
  PropensityToPayModel,
  ChurnRiskModel,
  ContactResponsivenessModel,
  createDefaultMLScorer,
} from './ml-scorer.js';
export type { MLScorerLike } from './ml-scorer.js';

// ─── ML Bundle (externalised weights, hot-swap) ─────────────────
export { BundledLinearModel, loadMLBundle, parseMLBundle, computeBundleHash } from './ml-bundle.js';
export type {
  MLModelBundle,
  MLModelEntry,
  MLFeatureTransform,
  BundleLoadResult,
} from './ml-bundle.js';

// ─── Shadow Scorer (A/B harness) ────────────────────────────────
export { ShadowScorer, InMemoryShadowSink } from './shadow-scorer.js';
export type {
  ShadowComparisonEvent,
  ShadowComparisonSink,
  ShadowDefinition,
  ShadowScorerOptions,
} from './shadow-scorer.js';
export { PrometheusShadowSink } from './prometheus-shadow-sink.js';
export type { PrometheusShadowSinkOptions, ShadowMetricsSink } from './prometheus-shadow-sink.js';

// ─── LLM Reasoner (Layer 3) ─────────────────────────────────────
export { LLMReasoner } from './llm-reasoner.js';
export type { PromptRegistryInterface } from './llm-reasoner.js';

// ─── NBA Pipeline (Core) ────────────────────────────────────────
export { NBAPipeline } from './nba-pipeline.js';
export type { NBAPipelineDeps } from './nba-pipeline.js';
