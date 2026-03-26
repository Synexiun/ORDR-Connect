/**
 * @ordr/compliance — Type definitions for the compliance rules engine.
 *
 * All regulations, rule shapes, evaluation contexts, and gate results
 * are defined here as the single source of truth.
 */

/** Supported regulatory frameworks. */
export type Regulation =
  | 'hipaa'
  | 'fdcpa'
  | 'tcpa'
  | 'gdpr'
  | 'ccpa'
  | 'fec'
  | 'respa'
  | 'pipeda'
  | 'lgpd';

/** All supported regulations as a const array. */
export const REGULATIONS = [
  'hipaa',
  'fdcpa',
  'tcpa',
  'gdpr',
  'ccpa',
  'fec',
  'respa',
  'pipeda',
  'lgpd',
] as const satisfies ReadonlyArray<Regulation>;

/** Severity tiers — critical/high violations block the action. */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

/**
 * A single compliance rule that can be registered with the engine.
 * Rules MUST be deterministic and synchronous — no LLM calls, no I/O.
 */
export interface ComplianceRule {
  readonly id: string;
  readonly regulation: Regulation;
  readonly name: string;
  readonly description: string;
  readonly severity: Severity;
  evaluate(context: ComplianceContext): ComplianceResult;
}

/**
 * Context passed into every rule evaluation.
 * Captures the who, what, when, and where of a customer-facing action.
 */
export interface ComplianceContext {
  readonly tenantId: string;
  readonly customerId?: string | undefined;
  readonly action: string;
  readonly channel?: string | undefined;
  readonly data: Record<string, unknown>;
  readonly timestamp: Date;
  readonly timezone?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

/** The outcome of evaluating a single rule against a context. */
export interface ComplianceResult {
  readonly ruleId: string;
  readonly regulation: Regulation;
  readonly passed: boolean;
  readonly violation?: {
    readonly code: string;
    readonly message: string;
    readonly severity: string;
    readonly remediation: string;
  } | undefined;
}

/** Aggregate outcome of running all applicable rules through the engine. */
export interface ComplianceGateResult {
  readonly allowed: boolean;
  readonly results: ComplianceResult[];
  readonly violations: ComplianceResult[];
  readonly timestamp: Date;
}
