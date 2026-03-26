/**
 * @ordr/compliance — Compliance rules engine for ORDR-Connect.
 *
 * Provides deterministic, sub-100ms regulatory compliance checks
 * for HIPAA, FDCPA, TCPA, GDPR, CCPA, FEC, RESPA, PIPEDA, and LGPD.
 *
 * Usage:
 *   import { ComplianceEngine, ComplianceGate, ALL_RULES } from '@ordr/compliance';
 *
 *   const engine = new ComplianceEngine();
 *   engine.registerRules(ALL_RULES);
 *
 *   const gate = new ComplianceGate(engine);
 *   const result = gate.check('send_sms', { tenantId: 't1', data: {...}, timestamp: new Date() });
 *   if (!result.allowed) { // block the action }
 */

// Types
export type {
  Regulation,
  Severity,
  ComplianceRule,
  ComplianceContext,
  ComplianceResult,
  ComplianceGateResult,
} from './types.js';

export { REGULATIONS } from './types.js';

// Engine
export { ComplianceEngine } from './engine.js';

// Gate
export { ComplianceGate, REGION_REGULATIONS } from './gate.js';

// Rules
export {
  ALL_RULES,
  HIPAA_RULES,
  HIPAA_ENHANCED_RULES,
  FDCPA_RULES,
  TCPA_RULES,
  GDPR_RULES,
  PIPEDA_RULES,
  LGPD_RULES,
} from './rules/index.js';
