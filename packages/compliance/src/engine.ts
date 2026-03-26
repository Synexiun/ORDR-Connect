/**
 * @ordr/compliance — Deterministic compliance rules engine.
 *
 * Evaluates registered rules synchronously against a context.
 * Sub-100ms by design: no I/O, no async, no LLM calls.
 */

import type {
  ComplianceContext,
  ComplianceGateResult,
  ComplianceRule,
  ComplianceResult,
  Regulation,
  Severity,
} from './types.js';

/** Priority ordering — critical rules evaluate first. */
const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
} as const;

export class ComplianceEngine {
  private readonly rules: Map<string, ComplianceRule> = new Map();

  /**
   * Register a single rule. Duplicate IDs overwrite the previous rule.
   */
  registerRule(rule: ComplianceRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Register multiple rules at once.
   */
  registerRules(rules: ReadonlyArray<ComplianceRule>): void {
    for (const rule of rules) {
      this.registerRule(rule);
    }
  }

  /**
   * Evaluate ALL registered rules against the given context.
   *
   * Rules execute in severity priority order (critical first).
   * If ANY critical or high rule fails, `allowed` is `false`.
   */
  evaluate(context: ComplianceContext): ComplianceGateResult {
    const sorted = this.getSortedRules();
    return this.runRules(sorted, context);
  }

  /**
   * Evaluate only rules for a specific regulation.
   */
  evaluateForRegulation(
    regulation: Regulation,
    context: ComplianceContext,
  ): ComplianceGateResult {
    const sorted = this.getSortedRules().filter(
      (r) => r.regulation === regulation,
    );
    return this.runRules(sorted, context);
  }

  /**
   * Return all registered rules, optionally filtered by regulation.
   */
  getRules(regulation?: Regulation): ComplianceRule[] {
    const all = [...this.rules.values()];
    if (regulation === undefined) return all;
    return all.filter((r) => r.regulation === regulation);
  }

  // ── internals ──────────────────────────────────────────────

  private getSortedRules(): ComplianceRule[] {
    return [...this.rules.values()].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
  }

  private runRules(
    rules: ReadonlyArray<ComplianceRule>,
    context: ComplianceContext,
  ): ComplianceGateResult {
    const results: ComplianceResult[] = [];
    const violations: ComplianceResult[] = [];

    for (const rule of rules) {
      const result = rule.evaluate(context);
      results.push(result);
      if (!result.passed) {
        violations.push(result);
      }
    }

    const hasBlockingViolation = violations.some(
      (v) =>
        v.violation?.severity === 'critical' ||
        v.violation?.severity === 'high',
    );

    return {
      allowed: !hasBlockingViolation,
      results,
      violations,
      timestamp: new Date(),
    };
  }
}
