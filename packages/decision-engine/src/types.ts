/**
 * @ordr/decision-engine — Type definitions for the 3-layer Decision Engine.
 *
 * The Decision Engine processes customer signals through three layers of
 * increasing sophistication: Rules -> ML Scoring -> LLM Reasoning.
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - PHI is NEVER included in DecisionAuditEntry or LLM payloads
 * - All types use readonly to enforce immutability
 * - Decision audit entries reference customers by tokenized ID only
 */

// ─── Decision Layer ──────────────────────────────────────────────

export const DECISION_LAYERS = ['rules', 'ml', 'llm'] as const;
export type DecisionLayer = (typeof DECISION_LAYERS)[number];

// ─── Rule Operators ──────────────────────────────────────────────

export const RULE_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'in',
  'not_in',
  'contains',
  'regex',
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

// ─── Lifecycle Stages ────────────────────────────────────────────

export const LIFECYCLE_STAGES = [
  'prospect',
  'onboarding',
  'active',
  'at_risk',
  'churned',
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

// ─── Action Types ────────────────────────────────────────────────

export const ACTION_TYPES = [
  'send_sms',
  'send_email',
  'send_voice',
  'route_to_agent',
  'escalate_to_human',
  'offer_payment_plan',
  'cease_communication',
  'schedule_callback',
  'trigger_workflow',
  'no_action',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

// ─── Channel Types ───────────────────────────────────────────────

export const CHANNEL_TYPES = [
  'sms',
  'email',
  'voice',
  'chat',
  'in_app',
] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

// ─── Customer Profile ────────────────────────────────────────────

export interface CustomerProfile {
  readonly healthScore: number;
  readonly lifecycleStage: LifecycleStage;
  readonly segment: string;
  readonly ltv: number;
  readonly sentimentAvg: number;
  readonly responseRate: number;
  readonly preferredChannel: ChannelType | undefined;
  readonly outstandingBalance: number;
  readonly maxBalance: number;
  readonly daysSinceLastContact: number;
  readonly totalInteractions30d: number;
  readonly paymentHistory: readonly PaymentEvent[];
}

export interface PaymentEvent {
  readonly date: Date;
  readonly amount: number;
  readonly onTime: boolean;
}

// ─── Interaction History ─────────────────────────────────────────

export interface InteractionRecord {
  readonly id: string;
  readonly channel: ChannelType;
  readonly direction: 'inbound' | 'outbound';
  readonly timestamp: Date;
  readonly outcome: string;
  readonly sentiment: number;
  readonly responded: boolean;
}

// ─── Decision Constraints ────────────────────────────────────────

export interface DecisionConstraints {
  readonly budgetCents: number | undefined;
  readonly timeWindowMinutes: number | undefined;
  readonly blockedChannels: readonly ChannelType[];
  readonly maxContactsPerWeek: number;
  readonly maxSmsPerDay: number;
  readonly maxEmailsPerWeek: number;
}

// ─── Decision Context ────────────────────────────────────────────

/**
 * Context passed into the Decision Engine for evaluation.
 * Contains everything needed to make a Next-Best-Action decision.
 *
 * SECURITY: customerProfile and interactionHistory contain NO raw PHI.
 * Customer is identified by customerId (tokenized reference).
 */
export interface DecisionContext {
  readonly tenantId: string;
  readonly customerId: string;
  readonly eventType: string;
  readonly eventPayload: Record<string, unknown>;
  readonly customerProfile: CustomerProfile;
  readonly channelPreferences: readonly ChannelType[];
  readonly interactionHistory: readonly InteractionRecord[];
  readonly constraints: DecisionConstraints;
  readonly timestamp: Date;
  readonly correlationId: string;
}

// ─── Rule Condition ──────────────────────────────────────────────

export interface RuleCondition {
  readonly field: string;
  readonly operator: RuleOperator;
  readonly value: unknown;
}

// ─── Rule Definition ─────────────────────────────────────────────

export interface RuleDefinition {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string;
  readonly priority: number;
  readonly conditions: readonly RuleCondition[];
  readonly action: RuleAction;
  readonly enabled: boolean;
  readonly terminal: boolean;
  readonly regulation: string | undefined;
}

export interface RuleAction {
  readonly type: ActionType;
  readonly channel: ChannelType | undefined;
  readonly parameters: Record<string, unknown>;
}

// ─── Rule Result ─────────────────────────────────────────────────

export interface RuleResult {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly matched: boolean;
  readonly action: RuleAction | undefined;
  readonly score: number;
  readonly reasoning: string;
}

// ─── ML Types ────────────────────────────────────────────────────

/** Named numeric features for ML model input. */
export type MLFeatureVector = Readonly<Record<string, number>>;

export interface MLPrediction {
  readonly modelName: string;
  readonly score: number;
  readonly confidence: number;
  readonly featuresUsed: readonly string[];
}

/** Interface for pluggable ML models. Designed for future ONNX Runtime swap. */
export interface MLModel {
  readonly name: string;
  readonly version: string;
  predict(features: MLFeatureVector): Promise<number>;
}

// ─── NBA Candidate ───────────────────────────────────────────────

export interface NBACandidate {
  readonly action: ActionType;
  readonly channel: ChannelType | undefined;
  readonly score: number;
  readonly confidence: number;
  readonly constraintsSatisfied: boolean;
  readonly complianceChecked: boolean;
  readonly estimatedCostCents: number;
  readonly source: DecisionLayer;
  readonly reasoning: string;
}

// ─── Decision ────────────────────────────────────────────────────

/**
 * The final decision output — the Next-Best-Action for a customer.
 */
export interface Decision {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly action: ActionType;
  readonly channel: ChannelType | undefined;
  readonly parameters: Record<string, unknown>;
  readonly score: number;
  readonly confidence: number;
  readonly reasoning: string;
  readonly layersUsed: readonly DecisionLayer[];
  readonly candidates: readonly NBACandidate[];
  readonly evaluatedAt: Date;
  readonly expiresAt: Date;
}

// ─── Decision Audit Entry ────────────────────────────────────────

/**
 * Audit record for a decision evaluation.
 *
 * CRITICAL: inputSummary and outputSummary MUST NEVER contain PHI.
 * Use only tokenized customer IDs, scores, and metadata.
 */
export interface DecisionAuditEntry {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly layer: DecisionLayer;
  readonly inputSummary: string;
  readonly outputSummary: string;
  readonly durationMs: number;
  readonly score: number;
  readonly confidence: number;
  readonly actionSelected: ActionType;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
}

// ─── Pipeline Dependencies ───────────────────────────────────────

/**
 * Compliance gate interface — subset of @ordr/compliance ComplianceGate
 * decoupled for testability.
 */
export interface ComplianceGateInterface {
  check(
    action: string,
    context: {
      readonly tenantId: string;
      readonly customerId?: string | undefined;
      readonly data: Record<string, unknown>;
      readonly timestamp: Date;
    },
  ): { readonly allowed: boolean; readonly violations: readonly { readonly ruleId: string; readonly regulation: string; readonly passed: boolean }[] };
}

/**
 * Audit logger interface — subset of @ordr/audit AuditLogger
 * decoupled for testability.
 */
export interface AuditLoggerInterface {
  log(input: {
    readonly tenantId: string;
    readonly eventType: 'agent.decision';
    readonly actorType: 'agent';
    readonly actorId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly action: string;
    readonly details: Record<string, unknown>;
    readonly timestamp: Date;
  }): Promise<{ readonly id: string }>;
}
