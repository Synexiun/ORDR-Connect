/**
 * @ordr/compliance — Rule registry barrel export.
 *
 * Combines all regulation-specific rule arrays into a single
 * ALL_RULES collection for engine registration.
 */

import type { ComplianceRule } from '../types.js';
import { HIPAA_RULES } from './hipaa.js';
import { HIPAA_ENHANCED_RULES } from './hipaa-enhanced.js';
import { FDCPA_RULES } from './fdcpa.js';
import { TCPA_RULES } from './tcpa.js';
import { GDPR_RULES } from './gdpr.js';
import { CCPA_RULES } from './ccpa.js';
import { FEC_RULES } from './fec.js';
import { RESPA_RULES } from './respa.js';
import { PIPEDA_RULES } from './pipeda.js';
import { LGPD_RULES } from './lgpd.js';

export { HIPAA_RULES } from './hipaa.js';
export { HIPAA_ENHANCED_RULES } from './hipaa-enhanced.js';
export { FDCPA_RULES } from './fdcpa.js';
export { TCPA_RULES } from './tcpa.js';
export { GDPR_RULES } from './gdpr.js';
export { CCPA_RULES } from './ccpa.js';
export { FEC_RULES } from './fec.js';
export { RESPA_RULES } from './respa.js';
export { PIPEDA_RULES } from './pipeda.js';
export { LGPD_RULES } from './lgpd.js';

/** Every rule across all supported regulations. */
export const ALL_RULES: ReadonlyArray<ComplianceRule> = [
  ...HIPAA_RULES,
  ...HIPAA_ENHANCED_RULES,
  ...FDCPA_RULES,
  ...TCPA_RULES,
  ...GDPR_RULES,
  ...CCPA_RULES,
  ...FEC_RULES,
  ...RESPA_RULES,
  ...PIPEDA_RULES,
  ...LGPD_RULES,
];
