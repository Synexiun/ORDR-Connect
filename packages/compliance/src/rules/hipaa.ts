/**
 * HIPAA rules (45 CFR §164.312) — PHI access controls, encryption,
 * session management, breach notification, and BAA requirements.
 */

import type { ComplianceRule } from '../types.js';

/** Every PHI access MUST have an audit trail entry. */
const HIPAA_PHI_ACCESS_LOGGING: ComplianceRule = {
  id: 'HIPAA_PHI_ACCESS_LOGGING',
  regulation: 'hipaa',
  name: 'PHI Access Audit Logging',
  description:
    'Every access to Protected Health Information must produce an immutable audit trail entry (§164.312(b)).',
  severity: 'critical',
  evaluate(context) {
    const hasAuditTrail = context.data['auditTrailId'] !== undefined &&
      context.data['auditTrailId'] !== null &&
      context.data['auditTrailId'] !== '';

    if (hasAuditTrail) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'HIPAA-164.312-B',
        message: 'PHI access attempted without audit trail entry.',
        severity: this.severity,
        remediation:
          'Generate an audit trail entry before accessing PHI. Use @ordr/audit to create a WORM log record.',
      },
    };
  },
};

/** Access restricted to minimum necessary PHI fields. */
const HIPAA_MINIMUM_NECESSARY: ComplianceRule = {
  id: 'HIPAA_MINIMUM_NECESSARY',
  regulation: 'hipaa',
  name: 'Minimum Necessary PHI Access',
  description:
    'Access must be limited to the minimum necessary PHI fields for the stated purpose (§164.502(b)).',
  severity: 'high',
  evaluate(context) {
    const requestedFields = context.data['requestedFields'];
    const authorizedFields = context.data['authorizedFields'];

    // If no fields specified, we cannot verify minimum necessary
    if (!Array.isArray(requestedFields) || !Array.isArray(authorizedFields)) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const unauthorized = (requestedFields as string[]).filter(
      (f) => !(authorizedFields as string[]).includes(f),
    );

    if (unauthorized.length === 0) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'HIPAA-164.502-B',
        message: `Access requested for unauthorized PHI fields: ${unauthorized.join(', ')}.`,
        severity: this.severity,
        remediation:
          'Restrict the request to only the PHI fields authorized for this role and purpose.',
      },
    };
  },
};

/** PHI MUST be encrypted before storage or transmission. */
const HIPAA_ENCRYPTION_REQUIRED: ComplianceRule = {
  id: 'HIPAA_ENCRYPTION_REQUIRED',
  regulation: 'hipaa',
  name: 'PHI Encryption Requirement',
  description:
    'PHI must be encrypted at rest and in transit using AES-256 or equivalent (§164.312(a)(2)(iv)).',
  severity: 'critical',
  evaluate(context) {
    const isEncrypted = context.data['encrypted'] === true;

    if (isEncrypted) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'HIPAA-164.312-A2IV',
        message: 'PHI data is not encrypted. Encryption is mandatory.',
        severity: this.severity,
        remediation:
          'Encrypt PHI using AES-256-GCM via @ordr/crypto before storage or transmission.',
      },
    };
  },
};

/** Sessions accessing PHI must timeout after 15 minutes idle. */
const HIPAA_SESSION_TIMEOUT: ComplianceRule = {
  id: 'HIPAA_SESSION_TIMEOUT',
  regulation: 'hipaa',
  name: 'PHI Session Timeout',
  description:
    'Sessions with PHI access must auto-terminate after 15 minutes of inactivity (§164.312(a)(2)(iii)).',
  severity: 'high',
  evaluate(context) {
    const lastActivityMs = context.data['lastActivityAt'];
    if (typeof lastActivityMs !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const fifteenMinutesMs = 15 * 60 * 1000;
    const elapsed = context.timestamp.getTime() - lastActivityMs;

    if (elapsed <= fifteenMinutesMs) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'HIPAA-164.312-A2III',
        message: `Session idle for ${Math.round(elapsed / 60_000)} minutes — exceeds 15-minute limit.`,
        severity: this.severity,
        remediation:
          'Terminate the session and require re-authentication before accessing PHI.',
      },
    };
  },
};

/** Breaches must be reported within 60 days of discovery. */
const HIPAA_BREACH_NOTIFICATION: ComplianceRule = {
  id: 'HIPAA_BREACH_NOTIFICATION',
  regulation: 'hipaa',
  name: 'Breach Notification Timeline',
  description:
    'Covered entities must notify affected individuals within 60 days of discovering a breach (§164.404).',
  severity: 'critical',
  evaluate(context) {
    const breachDiscoveredAt = context.data['breachDiscoveredAt'];
    if (typeof breachDiscoveredAt !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
    const elapsed = context.timestamp.getTime() - breachDiscoveredAt;
    const notified = context.data['breachNotificationSent'] === true;

    if (elapsed <= sixtyDaysMs || notified) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'HIPAA-164.404',
        message: `Breach discovered ${Math.round(elapsed / (24 * 60 * 60 * 1000))} days ago without notification — exceeds 60-day limit.`,
        severity: this.severity,
        remediation:
          'Immediately issue breach notification to affected individuals and HHS.',
      },
    };
  },
};

/** Business Associate Agreement required for PHI subprocessors. */
const HIPAA_BAA_REQUIRED: ComplianceRule = {
  id: 'HIPAA_BAA_REQUIRED',
  regulation: 'hipaa',
  name: 'Business Associate Agreement Required',
  description:
    'A signed BAA must be in place before sharing PHI with any subprocessor (§164.502(e)).',
  severity: 'critical',
  evaluate(context) {
    const subprocessorId = context.data['subprocessorId'];
    if (subprocessorId === undefined || subprocessorId === null) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const baaOnFile = context.data['baaOnFile'] === true;
    if (baaOnFile) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'HIPAA-164.502-E',
        message: `No BAA on file for subprocessor "${String(subprocessorId)}".`,
        severity: this.severity,
        remediation:
          'Execute a Business Associate Agreement before sharing any PHI with this subprocessor.',
      },
    };
  },
};

export const HIPAA_RULES: ReadonlyArray<ComplianceRule> = [
  HIPAA_PHI_ACCESS_LOGGING,
  HIPAA_MINIMUM_NECESSARY,
  HIPAA_ENCRYPTION_REQUIRED,
  HIPAA_SESSION_TIMEOUT,
  HIPAA_BREACH_NOTIFICATION,
  HIPAA_BAA_REQUIRED,
];
