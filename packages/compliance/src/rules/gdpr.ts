/**
 * GDPR rules — General Data Protection Regulation (EU 2016/679).
 *
 * Governs consent, right to erasure, data portability,
 * purpose limitation, and data minimization.
 */

import type { ComplianceRule } from '../types.js';

/** Data processing requires a valid legal basis (Art. 6). */
const GDPR_CONSENT_REQUIRED: ComplianceRule = {
  id: 'GDPR_CONSENT_REQUIRED',
  regulation: 'gdpr',
  name: 'Valid Legal Basis for Processing',
  description:
    'Processing personal data requires a valid legal basis — consent, contract, legal obligation, vital interests, public task, or legitimate interests (Art. 6 GDPR).',
  severity: 'critical',
  evaluate(context) {
    const hasLegalBasis = context.data['legalBasis'] !== undefined &&
      context.data['legalBasis'] !== null &&
      context.data['legalBasis'] !== '';

    if (hasLegalBasis) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART6',
        message: 'Data processing attempted without a valid legal basis.',
        severity: this.severity,
        remediation:
          'Establish and document a lawful basis for processing (consent, contractual necessity, etc.) before accessing personal data.',
      },
    };
  },
};

/** Must honor deletion requests within 30 days (Art. 17). */
const GDPR_RIGHT_TO_ERASURE: ComplianceRule = {
  id: 'GDPR_RIGHT_TO_ERASURE',
  regulation: 'gdpr',
  name: 'Right to Erasure (Right to be Forgotten)',
  description:
    'Deletion requests must be honored within 30 days unless an exemption applies (Art. 17 GDPR).',
  severity: 'critical',
  evaluate(context) {
    const erasureRequestedAt = context.data['erasureRequestedAt'];
    if (typeof erasureRequestedAt !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const elapsed = context.timestamp.getTime() - erasureRequestedAt;
    const erasureCompleted = context.data['erasureCompleted'] === true;

    if (elapsed <= thirtyDaysMs || erasureCompleted) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART17',
        message: `Erasure request pending for ${Math.round(elapsed / (24 * 60 * 60 * 1000))} days — exceeds 30-day limit.`,
        severity: this.severity,
        remediation:
          'Complete data erasure immediately or document the applicable exemption (legal hold, regulatory requirement, etc.).',
      },
    };
  },
};

/** Must provide data export in machine-readable format (Art. 20). */
const GDPR_DATA_PORTABILITY: ComplianceRule = {
  id: 'GDPR_DATA_PORTABILITY',
  regulation: 'gdpr',
  name: 'Data Portability',
  description:
    'Data subjects have the right to receive their data in a structured, commonly used, machine-readable format (Art. 20 GDPR).',
  severity: 'high',
  evaluate(context) {
    const portabilityRequested = context.data['portabilityRequested'] === true;
    if (!portabilityRequested) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const exportAvailable = context.data['exportAvailable'] === true;
    if (exportAvailable) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART20',
        message: 'Data portability requested but machine-readable export is not available.',
        severity: this.severity,
        remediation:
          'Generate a machine-readable export (JSON, CSV) of the data subject\'s personal data and make it available for download.',
      },
    };
  },
};

/** Data may only be used for its stated purpose (Art. 5(1)(b)). */
const GDPR_PURPOSE_LIMITATION: ComplianceRule = {
  id: 'GDPR_PURPOSE_LIMITATION',
  regulation: 'gdpr',
  name: 'Purpose Limitation',
  description:
    'Personal data must only be collected and processed for specified, explicit, and legitimate purposes (Art. 5(1)(b) GDPR).',
  severity: 'high',
  evaluate(context) {
    const statedPurpose = context.data['statedPurpose'];
    const actualPurpose = context.data['actualPurpose'];

    // If purposes are not declared, we cannot evaluate
    if (
      typeof statedPurpose !== 'string' ||
      typeof actualPurpose !== 'string'
    ) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (statedPurpose === actualPurpose) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART5-1B',
        message: `Data processed for "${actualPurpose}" but consent was given for "${statedPurpose}".`,
        severity: this.severity,
        remediation:
          'Only process data for the originally stated purpose, or obtain fresh consent for the new purpose.',
      },
    };
  },
};

/** Only collect data that is strictly necessary (Art. 5(1)(c)). */
const GDPR_DATA_MINIMIZATION: ComplianceRule = {
  id: 'GDPR_DATA_MINIMIZATION',
  regulation: 'gdpr',
  name: 'Data Minimization',
  description:
    'Only collect personal data that is adequate, relevant, and limited to what is necessary (Art. 5(1)(c) GDPR).',
  severity: 'medium',
  evaluate(context) {
    const collectedFields = context.data['collectedFields'];
    const requiredFields = context.data['requiredFields'];

    if (!Array.isArray(collectedFields) || !Array.isArray(requiredFields)) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const excessive = (collectedFields as string[]).filter(
      (f) => !(requiredFields as string[]).includes(f),
    );

    if (excessive.length === 0) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART5-1C',
        message: `Excessive data fields collected: ${excessive.join(', ')}.`,
        severity: this.severity,
        remediation:
          'Remove unnecessary fields from the data collection form. Only collect what is strictly required for the stated purpose.',
      },
    };
  },
};

/** Countries with EU adequacy decisions (simplified for MVP). */
const ADEQUACY_COUNTRIES = [
  'ad', 'ar', 'ca', 'fo', 'gg', 'il', 'im', 'je', 'nz',
  'ch', 'uy', 'jp', 'kr', 'gb', 'us-dpo',
] as const;

/** Cross-border transfers require adequacy decision or SCCs (Art. 44–49). */
const GDPR_CROSS_BORDER_TRANSFER: ComplianceRule = {
  id: 'GDPR_CROSS_BORDER_TRANSFER',
  regulation: 'gdpr',
  name: 'Cross-Border Transfer Safeguards',
  description:
    'Personal data transfers outside the EU/EEA require an adequacy decision or Standard Contractual Clauses (Art. 44–49 GDPR).',
  severity: 'critical',
  evaluate(context) {
    const destination = context.data['destinationCountry'];
    if (typeof destination !== 'string' || destination === '') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const hasAdequacy = (ADEQUACY_COUNTRIES as readonly string[]).includes(
      destination.toLowerCase(),
    );
    const hasSccs = context.data['sccsInPlace'] === true;

    if (hasAdequacy || hasSccs) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART44',
        message: `Cross-border transfer to "${destination}" lacks adequacy decision or SCCs.`,
        severity: this.severity,
        remediation:
          'Establish Standard Contractual Clauses with the recipient or transfer only to countries with an EU adequacy decision.',
      },
    };
  },
};

/** Cookie consent must be obtained before tracking (ePrivacy / Art. 5(3)). */
const GDPR_COOKIE_CONSENT: ComplianceRule = {
  id: 'GDPR_COOKIE_CONSENT',
  regulation: 'gdpr',
  name: 'Cookie Consent Required',
  description:
    'Tracking cookies require prior, informed consent from the data subject (ePrivacy Directive Art. 5(3), enforced under GDPR).',
  severity: 'high',
  evaluate(context) {
    const cookieConsentObtained = context.data['cookieConsentObtained'];
    if (cookieConsentObtained === undefined) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (cookieConsentObtained === true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-EPRIVACY-5-3',
        message: 'Tracking initiated without obtaining cookie consent.',
        severity: this.severity,
        remediation:
          'Obtain explicit cookie consent before placing tracking cookies or processing tracking data.',
      },
    };
  },
};

/** Tenant must have a designated DPO when required (Art. 37). */
const GDPR_DPO_APPOINTED: ComplianceRule = {
  id: 'GDPR_DPO_APPOINTED',
  regulation: 'gdpr',
  name: 'Data Protection Officer Appointed',
  description:
    'A Data Protection Officer must be designated when processing is carried out by a public authority or involves large-scale monitoring (Art. 37 GDPR).',
  severity: 'high',
  evaluate(context) {
    const dpoAppointed = context.data['dpoAppointed'];
    if (dpoAppointed === undefined) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (dpoAppointed === true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART37',
        message: 'No Data Protection Officer appointed for this tenant.',
        severity: this.severity,
        remediation:
          'Appoint a Data Protection Officer and register their contact details with the supervisory authority.',
      },
    };
  },
};

/** Breaches must be reported to the supervisory authority within 72 hours (Art. 33). */
const GDPR_BREACH_NOTIFICATION_72H: ComplianceRule = {
  id: 'GDPR_BREACH_NOTIFICATION_72H',
  regulation: 'gdpr',
  name: 'Breach Notification within 72 Hours',
  description:
    'Personal data breaches must be reported to the supervisory authority within 72 hours of discovery (Art. 33 GDPR).',
  severity: 'critical',
  evaluate(context) {
    const detectedAt = context.data['breachDetectedAt'];
    const reportedAt = context.data['breachReportedAt'];

    if (typeof detectedAt !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const seventyTwoHoursMs = 72 * 60 * 60 * 1000;

    if (typeof reportedAt === 'number') {
      const gap = reportedAt - detectedAt;
      if (gap <= seventyTwoHoursMs) {
        return { ruleId: this.id, regulation: this.regulation, passed: true };
      }
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'GDPR-ART33',
          message: `Breach reported ${Math.round(gap / (60 * 60 * 1000))} hours after detection — exceeds 72-hour limit.`,
          severity: this.severity,
          remediation:
            'Report personal data breaches to the supervisory authority within 72 hours of becoming aware of the breach.',
        },
      };
    }

    // Not yet reported — check if 72 hours have elapsed since detection
    const elapsed = context.timestamp.getTime() - detectedAt;
    if (elapsed <= seventyTwoHoursMs) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART33',
        message: `Breach detected ${Math.round(elapsed / (60 * 60 * 1000))} hours ago and not yet reported — exceeds 72-hour limit.`,
        severity: this.severity,
        remediation:
          'Report personal data breaches to the supervisory authority within 72 hours of becoming aware of the breach.',
      },
    };
  },
};

/** DPIA required for high-risk processing activities (Art. 35). */
const GDPR_DPIA_REQUIRED: ComplianceRule = {
  id: 'GDPR_DPIA_REQUIRED',
  regulation: 'gdpr',
  name: 'Data Protection Impact Assessment Required',
  description:
    'A DPIA is required when processing is likely to result in a high risk to data subjects (Art. 35 GDPR).',
  severity: 'high',
  evaluate(context) {
    const processingType = context.data['processingType'];
    if (typeof processingType !== 'string') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const highRiskTypes = ['profiling', 'large_scale_monitoring', 'sensitive_data'];
    if (!highRiskTypes.includes(processingType)) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const dpiaCompleted = context.data['dpiaCompleted'] === true;
    if (dpiaCompleted) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART35',
        message: `High-risk processing type "${processingType}" requires a completed DPIA.`,
        severity: this.severity,
        remediation:
          'Conduct a Data Protection Impact Assessment before proceeding with this processing activity.',
      },
    };
  },
};

/** Automated decision-making transparency and right to human review (Art. 22). */
const GDPR_AUTOMATED_DECISION_TRANSPARENCY: ComplianceRule = {
  id: 'GDPR_AUTOMATED_DECISION_TRANSPARENCY',
  regulation: 'gdpr',
  name: 'Automated Decision-Making Transparency',
  description:
    'Data subjects have the right not to be subject to solely automated decisions with legal effects, and must be informed with access to human review (Art. 22 GDPR).',
  severity: 'high',
  evaluate(context) {
    const automatedDecision = context.data['automatedDecision'];
    if (automatedDecision !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const humanReviewAvailable = context.data['humanReviewAvailable'] === true;
    if (humanReviewAvailable) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART22',
        message: 'Automated decision-making without human review option.',
        severity: this.severity,
        remediation:
          'Provide meaningful information about the logic involved, significance, and ensure human review is available on request.',
      },
    };
  },
};

/** Parental consent required for children under 16 (Art. 8). */
const GDPR_CHILD_CONSENT: ComplianceRule = {
  id: 'GDPR_CHILD_CONSENT',
  regulation: 'gdpr',
  name: 'Child Consent (Parental Authorization)',
  description:
    'Processing personal data of a child under 16 requires parental consent (Art. 8 GDPR). Member states may lower the age to 13.',
  severity: 'critical',
  evaluate(context) {
    const age = context.data['dataSubjectAge'];
    if (typeof age !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (age >= 16) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const parentalConsent = context.data['parentalConsentObtained'] === true;
    if (parentalConsent) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART8',
        message: `Data subject is ${age} years old — parental consent required but not obtained.`,
        severity: this.severity,
        remediation:
          'Obtain verifiable parental consent before processing personal data of children under 16.',
      },
    };
  },
};

/** Enhanced purpose limitation — original purpose must match current processing (Art. 5(1)(b) strict). */
const GDPR_PURPOSE_LIMITATION_STRICT: ComplianceRule = {
  id: 'GDPR_PURPOSE_LIMITATION_STRICT',
  regulation: 'gdpr',
  name: 'Purpose Limitation (Strict)',
  description:
    'Purpose declared at data collection must match the current processing purpose exactly. Secondary purposes require fresh consent (Art. 5(1)(b) GDPR).',
  severity: 'high',
  evaluate(context) {
    const collectionPurpose = context.data['collectionPurpose'];
    const processingPurpose = context.data['processingPurpose'];

    if (typeof collectionPurpose !== 'string' || typeof processingPurpose !== 'string') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const freshConsent = context.data['freshConsentForNewPurpose'] === true;
    if (collectionPurpose === processingPurpose || freshConsent) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART5-1B-STRICT',
        message: `Data collected for "${collectionPurpose}" but now processed for "${processingPurpose}" without fresh consent.`,
        severity: this.severity,
        remediation:
          'Obtain fresh, specific consent for the new processing purpose or limit processing to the original stated purpose.',
      },
    };
  },
};

/** Data must have a defined retention period — no indefinite storage (Art. 5(1)(e)). */
const GDPR_STORAGE_LIMITATION: ComplianceRule = {
  id: 'GDPR_STORAGE_LIMITATION',
  regulation: 'gdpr',
  name: 'Storage Limitation',
  description:
    'Personal data must not be stored indefinitely — a retention period must be defined and enforced (Art. 5(1)(e) GDPR).',
  severity: 'medium',
  evaluate(context) {
    const retentionDefined = context.data['retentionPeriodDefined'];
    if (retentionDefined === undefined) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (retentionDefined === true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART5-1E',
        message: 'No retention period defined — data stored indefinitely.',
        severity: this.severity,
        remediation:
          'Define and document a data retention period. Implement automated deletion or anonymization at expiry.',
      },
    };
  },
};

/** Data portability — export in machine-readable format on request (Art. 20). */
const GDPR_DATA_PORTABILITY_AVAILABLE: ComplianceRule = {
  id: 'GDPR_DATA_PORTABILITY_AVAILABLE',
  regulation: 'gdpr',
  name: 'Data Portability Available',
  description:
    'When data portability is requested, data export in machine-readable format must be available (Art. 20 GDPR).',
  severity: 'high',
  evaluate(context) {
    const portabilityRequested = context.data['portabilityRequested'] === true;
    if (!portabilityRequested) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const machineReadableExport = context.data['machineReadableExportAvailable'] === true;
    if (machineReadableExport) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'GDPR-ART20-EXPORT',
        message: 'Data portability requested but machine-readable export not available.',
        severity: this.severity,
        remediation:
          'Provide data export in a structured, commonly used, machine-readable format (JSON, CSV) within 30 days.',
      },
    };
  },
};

export const GDPR_RULES: ReadonlyArray<ComplianceRule> = [
  GDPR_CONSENT_REQUIRED,
  GDPR_RIGHT_TO_ERASURE,
  GDPR_DATA_PORTABILITY,
  GDPR_PURPOSE_LIMITATION,
  GDPR_DATA_MINIMIZATION,
  GDPR_CROSS_BORDER_TRANSFER,
  GDPR_COOKIE_CONSENT,
  GDPR_DPO_APPOINTED,
  GDPR_BREACH_NOTIFICATION_72H,
  GDPR_DPIA_REQUIRED,
  GDPR_AUTOMATED_DECISION_TRANSPARENCY,
  GDPR_CHILD_CONSENT,
  GDPR_PURPOSE_LIMITATION_STRICT,
  GDPR_STORAGE_LIMITATION,
  GDPR_DATA_PORTABILITY_AVAILABLE,
];
