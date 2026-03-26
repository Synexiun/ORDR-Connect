/**
 * PIPEDA rules — Personal Information Protection and Electronic Documents Act (Canada).
 *
 * Governs how private-sector organizations collect, use, and disclose
 * personal information in the course of commercial activities.
 */

import type { ComplianceRule } from '../types.js';

/** Consent must be meaningful — informed and specific to the stated purpose (Principle 3). */
const PIPEDA_MEANINGFUL_CONSENT: ComplianceRule = {
  id: 'PIPEDA_MEANINGFUL_CONSENT',
  regulation: 'pipeda',
  name: 'Meaningful Consent',
  description:
    'Consent must be informed, specific, and meaningful — individuals must understand what they are consenting to (PIPEDA Principle 3).',
  severity: 'critical',
  evaluate(context) {
    const consentObtained = context.data['consentObtained'];
    if (consentObtained === undefined) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const consentInformed = context.data['consentInformed'] === true;
    const consentSpecific = context.data['consentSpecific'] === true;

    if (consentObtained === true && consentInformed && consentSpecific) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'PIPEDA-P3',
        message: 'Consent is not meaningful — must be informed and specific to purpose.',
        severity: this.severity,
        remediation:
          'Obtain consent that clearly explains what personal information is collected, why, and how it will be used.',
      },
    };
  },
};

/** Data collection limited to what is necessary for the stated purpose (Principle 4). */
const PIPEDA_LIMITED_COLLECTION: ComplianceRule = {
  id: 'PIPEDA_LIMITED_COLLECTION',
  regulation: 'pipeda',
  name: 'Limited Collection',
  description:
    'Collection of personal information must be limited to what is necessary for the identified purposes (PIPEDA Principle 4).',
  severity: 'high',
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
        code: 'PIPEDA-P4',
        message: `Excessive data collection: ${excessive.join(', ')} not required for stated purpose.`,
        severity: this.severity,
        remediation:
          'Limit data collection to only what is necessary for the identified purposes.',
      },
    };
  },
};

/** Data retained only as long as necessary for the stated purpose (Principle 5). */
const PIPEDA_RETENTION_SCHEDULE: ComplianceRule = {
  id: 'PIPEDA_RETENTION_SCHEDULE',
  regulation: 'pipeda',
  name: 'Retention Schedule',
  description:
    'Personal information must only be retained as long as necessary to fulfill the stated purpose (PIPEDA Principle 5).',
  severity: 'high',
  evaluate(context) {
    const retentionScheduleDefined = context.data['retentionScheduleDefined'];
    if (retentionScheduleDefined === undefined) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (retentionScheduleDefined === true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'PIPEDA-P5',
        message: 'No retention schedule defined — data may be kept longer than necessary.',
        severity: this.severity,
        remediation:
          'Define and enforce a data retention schedule that aligns with the purpose of collection.',
      },
    };
  },
};

/** Access requests must be fulfilled within 30 days (Principle 9). */
const PIPEDA_ACCESS_REQUEST_30D: ComplianceRule = {
  id: 'PIPEDA_ACCESS_REQUEST_30D',
  regulation: 'pipeda',
  name: 'Access Request within 30 Days',
  description:
    'Individuals have the right to access their personal information, and requests must be fulfilled within 30 days (PIPEDA Principle 9).',
  severity: 'critical',
  evaluate(context) {
    const requestedAt = context.data['accessRequestedAt'];
    if (typeof requestedAt !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const elapsed = context.timestamp.getTime() - requestedAt;
    const fulfilled = context.data['accessRequestFulfilled'] === true;

    if (fulfilled || elapsed <= thirtyDaysMs) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'PIPEDA-P9',
        message: `Access request pending for ${Math.round(elapsed / (24 * 60 * 60 * 1000))} days — exceeds 30-day limit.`,
        severity: this.severity,
        remediation:
          'Fulfill the access request immediately or provide a valid reason for the delay with a revised timeline.',
      },
    };
  },
};

/** Organizations must keep personal information accurate and up-to-date (Principle 6). */
const PIPEDA_ACCURACY: ComplianceRule = {
  id: 'PIPEDA_ACCURACY',
  regulation: 'pipeda',
  name: 'Data Accuracy',
  description:
    'Personal information must be accurate, complete, and up-to-date for its intended purpose (PIPEDA Principle 6).',
  severity: 'medium',
  evaluate(context) {
    const accuracyVerified = context.data['accuracyVerified'];
    if (accuracyVerified === undefined) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (accuracyVerified === true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'PIPEDA-P6',
        message: 'Data accuracy has not been verified — may be outdated or incorrect.',
        severity: this.severity,
        remediation:
          'Implement processes to verify and update personal information, especially before using it to make decisions.',
      },
    };
  },
};

/** Appropriate security safeguards required for personal information (Principle 7). */
const PIPEDA_SAFEGUARDS: ComplianceRule = {
  id: 'PIPEDA_SAFEGUARDS',
  regulation: 'pipeda',
  name: 'Security Safeguards',
  description:
    'Personal information must be protected by security safeguards appropriate to its sensitivity (PIPEDA Principle 7).',
  severity: 'critical',
  evaluate(context) {
    const encrypted = context.data['encrypted'];
    const accessControlled = context.data['accessControlled'];

    if (encrypted === undefined && accessControlled === undefined) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (encrypted === true && accessControlled === true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const missing: string[] = [];
    if (encrypted !== true) missing.push('encryption');
    if (accessControlled !== true) missing.push('access control');

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'PIPEDA-P7',
        message: `Missing security safeguards: ${missing.join(', ')}.`,
        severity: this.severity,
        remediation:
          'Implement appropriate security safeguards including encryption at rest and in transit, and role-based access controls.',
      },
    };
  },
};

/** Privacy practices must be publicly available and transparent (Principle 8). */
const PIPEDA_TRANSPARENCY: ComplianceRule = {
  id: 'PIPEDA_TRANSPARENCY',
  regulation: 'pipeda',
  name: 'Transparency of Privacy Practices',
  description:
    'Organizations must make information about their privacy policies and practices publicly available (PIPEDA Principle 8).',
  severity: 'high',
  evaluate(context) {
    const privacyPolicyPublished = context.data['privacyPolicyPublished'];
    if (privacyPolicyPublished === undefined) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (privacyPolicyPublished === true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'PIPEDA-P8',
        message: 'Privacy policy not publicly available.',
        severity: this.severity,
        remediation:
          'Publish a clear, understandable privacy policy describing data practices, purposes, and individual rights.',
      },
    };
  },
};

/** Mandatory breach notification when risk of significant harm (PIPEDA s. 10.1). */
const PIPEDA_BREACH_NOTIFICATION: ComplianceRule = {
  id: 'PIPEDA_BREACH_NOTIFICATION',
  regulation: 'pipeda',
  name: 'Breach Notification (Risk of Significant Harm)',
  description:
    'Organizations must notify the Privacy Commissioner and affected individuals of breaches that pose a real risk of significant harm (PIPEDA s. 10.1).',
  severity: 'critical',
  evaluate(context) {
    const breachDetected = context.data['breachDetected'] === true;
    if (!breachDetected) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const riskOfHarm = context.data['riskOfSignificantHarm'] === true;
    if (!riskOfHarm) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const notificationSent = context.data['breachNotificationSent'] === true;
    if (notificationSent) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'PIPEDA-S10-1',
        message: 'Breach with risk of significant harm detected but notification not sent.',
        severity: this.severity,
        remediation:
          'Notify the Privacy Commissioner of Canada and all affected individuals as soon as feasible after determining risk of significant harm.',
      },
    };
  },
};

export const PIPEDA_RULES: ReadonlyArray<ComplianceRule> = [
  PIPEDA_MEANINGFUL_CONSENT,
  PIPEDA_LIMITED_COLLECTION,
  PIPEDA_RETENTION_SCHEDULE,
  PIPEDA_ACCESS_REQUEST_30D,
  PIPEDA_ACCURACY,
  PIPEDA_SAFEGUARDS,
  PIPEDA_TRANSPARENCY,
  PIPEDA_BREACH_NOTIFICATION,
];
