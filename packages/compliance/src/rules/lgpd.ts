/**
 * LGPD rules — Lei Geral de Protecao de Dados Pessoais (Brazil).
 *
 * Brazil's comprehensive data protection law (Law No. 13.709/2018),
 * modeled after GDPR with Brazilian-specific requirements.
 */

import type { ComplianceRule } from '../types.js';

/** Valid legal bases for processing under LGPD. */
const VALID_LEGAL_BASES = [
  'consent',
  'legitimate_interest',
  'contract',
  'legal_obligation',
  'public_policy',
  'research',
  'exercise_of_rights',
  'health_protection',
  'credit_protection',
  'vital_interests',
] as const;

/** Processing requires a valid legal basis (Art. 7). */
const LGPD_LEGAL_BASIS: ComplianceRule = {
  id: 'LGPD_LEGAL_BASIS',
  regulation: 'lgpd',
  name: 'Valid Legal Basis for Processing',
  description:
    'Processing of personal data requires a valid legal basis — consent, legitimate interest, contract performance, legal obligation, or other Art. 7 bases (LGPD Art. 7).',
  severity: 'critical',
  evaluate(context) {
    const legalBasis = context.data['legalBasis'];
    if (typeof legalBasis !== 'string' || legalBasis === '') {
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'LGPD-ART7',
          message: 'No legal basis provided for data processing.',
          severity: this.severity,
          remediation:
            'Establish and document a valid legal basis under Art. 7 LGPD before processing personal data.',
        },
      };
    }

    if ((VALID_LEGAL_BASES as readonly string[]).includes(legalBasis)) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'LGPD-ART7',
        message: `Invalid legal basis "${legalBasis}" — not recognized under Art. 7 LGPD.`,
        severity: this.severity,
        remediation:
          'Use a valid legal basis: consent, legitimate_interest, contract, legal_obligation, public_policy, research, exercise_of_rights, health_protection, credit_protection, or vital_interests.',
      },
    };
  },
};

/** Data subjects must have access, correction, deletion, and portability rights (Art. 18). */
const LGPD_DATA_SUBJECT_RIGHTS: ComplianceRule = {
  id: 'LGPD_DATA_SUBJECT_RIGHTS',
  regulation: 'lgpd',
  name: 'Data Subject Rights',
  description:
    'Data subjects must be able to exercise their rights: access, correction, anonymization, deletion, and portability (LGPD Art. 18).',
  severity: 'high',
  evaluate(context) {
    const rightsSupported = context.data['dataSubjectRightsSupported'];
    if (rightsSupported === undefined) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (!Array.isArray(rightsSupported)) {
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'LGPD-ART18',
          message: 'Data subject rights configuration is invalid.',
          severity: this.severity,
          remediation:
            'Configure supported data subject rights as an array: access, correction, deletion, portability.',
        },
      };
    }

    const required = ['access', 'correction', 'deletion', 'portability'];
    const missing = required.filter(
      (r) => !(rightsSupported as string[]).includes(r),
    );

    if (missing.length === 0) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'LGPD-ART18',
        message: `Missing data subject rights: ${missing.join(', ')}.`,
        severity: this.severity,
        remediation:
          'Implement all required data subject rights: access, correction, deletion, and portability.',
      },
    };
  },
};

/** Processing limited to declared purpose (Art. 6-I). */
const LGPD_PURPOSE_LIMITATION: ComplianceRule = {
  id: 'LGPD_PURPOSE_LIMITATION',
  regulation: 'lgpd',
  name: 'Purpose Limitation',
  description:
    'Processing must be carried out for legitimate, specific, and explicit purposes informed to the data subject (LGPD Art. 6-I).',
  severity: 'high',
  evaluate(context) {
    const declaredPurpose = context.data['declaredPurpose'];
    const actualPurpose = context.data['actualPurpose'];

    if (typeof declaredPurpose !== 'string' || typeof actualPurpose !== 'string') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (declaredPurpose === actualPurpose) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'LGPD-ART6-I',
        message: `Processing for "${actualPurpose}" but declared purpose is "${declaredPurpose}".`,
        severity: this.severity,
        remediation:
          'Limit processing to the originally declared purpose or obtain new consent for additional purposes.',
      },
    };
  },
};

/** Only minimum data necessary for the purpose (Art. 6-III). */
const LGPD_DATA_MINIMIZATION: ComplianceRule = {
  id: 'LGPD_DATA_MINIMIZATION',
  regulation: 'lgpd',
  name: 'Data Minimization',
  description:
    'Only the minimum personal data necessary for the stated purpose may be processed (LGPD Art. 6-III).',
  severity: 'medium',
  evaluate(context) {
    const collectedFields = context.data['collectedFields'];
    const necessaryFields = context.data['necessaryFields'];

    if (!Array.isArray(collectedFields) || !Array.isArray(necessaryFields)) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const excessive = (collectedFields as string[]).filter(
      (f) => !(necessaryFields as string[]).includes(f),
    );

    if (excessive.length === 0) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'LGPD-ART6-III',
        message: `Excessive data collected beyond necessity: ${excessive.join(', ')}.`,
        severity: this.severity,
        remediation:
          'Remove unnecessary data fields and collect only what is strictly required for the declared purpose.',
      },
    };
  },
};

/** International transfers only with adequate safeguards (Art. 33). */
const LGPD_INTERNATIONAL_TRANSFER: ComplianceRule = {
  id: 'LGPD_INTERNATIONAL_TRANSFER',
  regulation: 'lgpd',
  name: 'International Data Transfer',
  description:
    'International transfer of personal data requires adequate safeguards — adequacy determination, contractual clauses, or consent (LGPD Art. 33).',
  severity: 'critical',
  evaluate(context) {
    const internationalTransfer = context.data['internationalTransfer'] === true;
    if (!internationalTransfer) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const hasAdequacy = context.data['adequacyDetermination'] === true;
    const hasContractualClauses = context.data['contractualClauses'] === true;
    const hasConsent = context.data['transferConsent'] === true;

    if (hasAdequacy || hasContractualClauses || hasConsent) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'LGPD-ART33',
        message: 'International data transfer without adequate safeguards.',
        severity: this.severity,
        remediation:
          'Establish adequate safeguards before transferring data internationally: adequacy determination, standard contractual clauses, or explicit data subject consent.',
      },
    };
  },
};

/** Breach notification within reasonable timeframe (Art. 48). */
const LGPD_BREACH_NOTIFICATION_REASONABLE: ComplianceRule = {
  id: 'LGPD_BREACH_NOTIFICATION_REASONABLE',
  regulation: 'lgpd',
  name: 'Breach Notification (Reasonable Time)',
  description:
    'The ANPD and data subjects must be notified of security incidents within a reasonable timeframe (LGPD Art. 48).',
  severity: 'critical',
  evaluate(context) {
    const breachDetectedAt = context.data['breachDetectedAt'];
    if (typeof breachDetectedAt !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const notificationSent = context.data['breachNotificationSent'] === true;
    if (notificationSent) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    // ANPD recommends notification within 2 business days; we use 72 hours as reasonable
    const seventyTwoHoursMs = 72 * 60 * 60 * 1000;
    const elapsed = context.timestamp.getTime() - breachDetectedAt;

    if (elapsed <= seventyTwoHoursMs) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'LGPD-ART48',
        message: `Breach detected ${Math.round(elapsed / (60 * 60 * 1000))} hours ago — notification not sent within reasonable timeframe.`,
        severity: this.severity,
        remediation:
          'Notify the ANPD (National Data Protection Authority) and affected data subjects as soon as possible after breach discovery.',
      },
    };
  },
};

/** DPO appointment required for certain processing activities (Art. 41). */
const LGPD_DPO_REQUIRED: ComplianceRule = {
  id: 'LGPD_DPO_REQUIRED',
  regulation: 'lgpd',
  name: 'DPO Appointment Required',
  description:
    'Controllers must appoint a Data Protection Officer (encarregado) to handle data protection matters (LGPD Art. 41).',
  severity: 'high',
  evaluate(context) {
    const dpoRequired = context.data['dpoRequired'];
    if (dpoRequired !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const dpoAppointed = context.data['dpoAppointed'] === true;
    if (dpoAppointed) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'LGPD-ART41',
        message: 'DPO (encarregado) required but not appointed.',
        severity: this.severity,
        remediation:
          'Appoint a Data Protection Officer (encarregado) and publish their contact information.',
      },
    };
  },
};

/** Impact report required for processing affecting fundamental rights (Art. 38). */
const LGPD_IMPACT_REPORT: ComplianceRule = {
  id: 'LGPD_IMPACT_REPORT',
  regulation: 'lgpd',
  name: 'Data Protection Impact Report',
  description:
    'A Data Protection Impact Report is required when processing may affect the fundamental rights and liberties of data subjects (LGPD Art. 38).',
  severity: 'high',
  evaluate(context) {
    const impactReportRequired = context.data['impactReportRequired'];
    if (impactReportRequired !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const impactReportCompleted = context.data['impactReportCompleted'] === true;
    if (impactReportCompleted) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'LGPD-ART38',
        message: 'Data Protection Impact Report required but not completed.',
        severity: this.severity,
        remediation:
          'Complete a Data Protection Impact Report before proceeding with processing activities that may affect fundamental rights.',
      },
    };
  },
};

export const LGPD_RULES: ReadonlyArray<ComplianceRule> = [
  LGPD_LEGAL_BASIS,
  LGPD_DATA_SUBJECT_RIGHTS,
  LGPD_PURPOSE_LIMITATION,
  LGPD_DATA_MINIMIZATION,
  LGPD_INTERNATIONAL_TRANSFER,
  LGPD_BREACH_NOTIFICATION_REASONABLE,
  LGPD_DPO_REQUIRED,
  LGPD_IMPACT_REPORT,
];
