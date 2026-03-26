/**
 * @ordr/compliance — Pre-action compliance gate.
 *
 * This gate MUST be called before every customer-facing action.
 * Actions that fail the gate MUST NOT execute.
 */

import { ComplianceEngine } from './engine.js';
import type {
  ComplianceContext,
  ComplianceGateResult,
  Regulation,
} from './types.js';

/** Channel-to-regulation mapping for channel-specific checks. */
const CHANNEL_REGULATIONS: Readonly<Record<string, ReadonlyArray<Regulation>>> = {
  sms: ['tcpa'],
  voice: ['tcpa', 'fdcpa'],
  phone: ['tcpa', 'fdcpa'],
  email: ['gdpr', 'ccpa'],
  mail: ['fdcpa'],
} as const;

/**
 * Region-to-regulation mapping for region-based compliance routing.
 * EU regions trigger GDPR, Canada triggers PIPEDA, Brazil triggers LGPD.
 */
export const REGION_REGULATIONS: Readonly<Record<string, ReadonlyArray<Regulation>>> = {
  'eu-west': ['gdpr'],
  'eu-central': ['gdpr'],
  'ca-central': ['pipeda'],
  'sa-east': ['lgpd'],
} as const;

export class ComplianceGate {
  private readonly engine: ComplianceEngine;

  constructor(engine: ComplianceEngine) {
    this.engine = engine;
  }

  /**
   * Evaluate all rules before allowing an action.
   * Returns a gate result — if `allowed` is false, the action MUST NOT proceed.
   */
  check(
    action: string,
    context: Omit<ComplianceContext, 'action'>,
  ): ComplianceGateResult {
    const fullContext: ComplianceContext = { ...context, action };
    return this.engine.evaluate(fullContext);
  }

  /**
   * Channel-specific compliance checks.
   * Routes to the correct regulation(s) based on the communication channel.
   *
   * - SMS -> TCPA
   * - Voice/Phone -> TCPA + FDCPA
   * - Email -> GDPR/CCPA (consent-based)
   * - Mail -> FDCPA
   */
  checkForChannel(
    channel: string,
    context: ComplianceContext,
  ): ComplianceGateResult {
    const regulations = CHANNEL_REGULATIONS[channel.toLowerCase()];

    if (regulations === undefined || regulations.length === 0) {
      // Unknown channel — run all rules as a safety net
      return this.engine.evaluate(context);
    }

    // Collect results from all applicable regulations
    const allResults: ComplianceGateResult['results'] = [];
    const allViolations: ComplianceGateResult['violations'] = [];
    let allowed = true;

    for (const reg of regulations) {
      const result = this.engine.evaluateForRegulation(
        reg,
        context,
      );
      allResults.push(...result.results);
      allViolations.push(...result.violations);
      if (!result.allowed) {
        allowed = false;
      }
    }

    return {
      allowed,
      results: allResults,
      violations: allViolations,
      timestamp: new Date(),
    };
  }

  /**
   * Specialized check for outbound contact attempts.
   * Evaluates FDCPA 7-in-7 frequency rule + contact timing restrictions.
   */
  isContactAllowed(
    customerId: string,
    tenantId: string,
    contactAttempts: number,
    lastContactAt: Date | null,
    timezone: string,
  ): ComplianceGateResult {
    // Compute the customer's current local hour from their timezone
    const now = new Date();
    let localHour: number;
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      });
      localHour = Number(formatter.format(now));
    } catch {
      // If timezone is invalid, default to blocking (fail-safe)
      localHour = 0;
    }

    const context: ComplianceContext = {
      tenantId,
      customerId,
      action: 'outbound_contact',
      channel: 'phone',
      data: {
        contactAttemptsLast7Days: contactAttempts,
        localHour,
        lastContactAt: lastContactAt?.getTime() ?? null,
      },
      timestamp: now,
      timezone,
    };

    return this.engine.evaluateForRegulation('fdcpa', context);
  }

  /**
   * Region-aware compliance checks.
   *
   * Runs standard checks PLUS region-specific regulations:
   * - EU (eu-west, eu-central) -> GDPR
   * - Canada (ca-central) -> PIPEDA
   * - Brazil (sa-east) -> LGPD
   * - Other regions -> standard checks only
   */
  checkWithRegion(
    action: string,
    context: Omit<ComplianceContext, 'action'>,
    tenantRegion: string,
  ): ComplianceGateResult {
    const fullContext: ComplianceContext = { ...context, action };

    // Always run standard checks first
    const standardResult = this.engine.evaluate(fullContext);

    // Look up region-specific regulations
    const regionRegs = REGION_REGULATIONS[tenantRegion];
    if (regionRegs === undefined || regionRegs.length === 0) {
      return standardResult;
    }

    // Collect region-specific rule results
    const allResults = [...standardResult.results];
    const allViolations = [...standardResult.violations];
    let allowed = standardResult.allowed;

    for (const reg of regionRegs) {
      const regionResult = this.engine.evaluateForRegulation(reg, fullContext);

      // Only add results not already present (avoid duplicate GDPR checks if GDPR is in standard set)
      for (const result of regionResult.results) {
        const alreadyPresent = allResults.some((r) => r.ruleId === result.ruleId);
        if (!alreadyPresent) {
          allResults.push(result);
          if (!result.passed) {
            allViolations.push(result);
          }
        }
      }

      if (!regionResult.allowed) {
        allowed = false;
      }
    }

    return {
      allowed,
      results: allResults,
      violations: allViolations,
      timestamp: new Date(),
    };
  }
}
