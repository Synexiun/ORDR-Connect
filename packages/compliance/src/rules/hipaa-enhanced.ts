/**
 * Enhanced HIPAA rules — healthcare-specific compliance rules beyond the base 6
 *
 * These rules cover advanced HIPAA requirements for healthcare vertical agents:
 * - Minimum Necessary (enhanced) — field-level access justification
 * - Designated Record Set — data in proper record sets
 * - Accounting of Disclosures — 6-year tracking
 * - Breach Risk Assessment — 4-factor risk scoring
 * - BAA Required (enhanced) — subprocessor verification
 * - Authorization Required — patient authorization for specific uses
 *
 * COMPLIANCE:
 * - HIPAA §164.502(b) — minimum necessary
 * - HIPAA §164.524 — designated record sets
 * - HIPAA §164.528 — accounting of disclosures
 * - HIPAA §164.402 — breach risk assessment
 * - HIPAA §164.502(e) — BAA requirements
 * - HIPAA §164.508 — authorization requirements
 */

import type { ComplianceRule } from '../types.js';

// ─── Enhanced Minimum Necessary Rule ─────────────────────────────

/**
 * Enhanced minimum necessary — verifies that PHI access includes
 * a documented business justification and only requests fields
 * that are demonstrably needed for the stated purpose.
 */
const HIPAA_MINIMUM_NECESSARY_ENHANCED: ComplianceRule = {
  id: 'HIPAA_MINIMUM_NECESSARY_ENHANCED',
  regulation: 'hipaa',
  name: 'Enhanced Minimum Necessary PHI Access',
  description:
    'PHI access must include a documented business justification and request only fields demonstrably needed for the stated purpose (§164.502(b)).',
  severity: 'high',
  evaluate(context) {
    const hasJustification = typeof context.data['accessJustification'] === 'string' &&
      (context.data['accessJustification'] as string).length > 0;
    const purposeCode = context.data['purposeCode'];
    const requestedFields = context.data['requestedFields'];

    // If no PHI access context, rule is not applicable
    if (requestedFields === undefined && purposeCode === undefined) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    // Justification is mandatory for PHI access
    if (!hasJustification) {
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'HIPAA-164.502-B-ENH',
          message: 'PHI access attempted without documented business justification.',
          severity: this.severity,
          remediation:
            'Provide an accessJustification string documenting the business need before accessing PHI.',
        },
      };
    }

    // Purpose code is required
    if (typeof purposeCode !== 'string' || purposeCode.length === 0) {
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'HIPAA-164.502-B-ENH',
          message: 'PHI access attempted without a valid purpose code.',
          severity: this.severity,
          remediation:
            'Provide a purposeCode (e.g., "treatment", "payment", "operations") before accessing PHI.',
        },
      };
    }

    return { ruleId: this.id, regulation: this.regulation, passed: true };
  },
};

// ─── Designated Record Set Rule ──────────────────────────────────

/**
 * Ensures data being accessed belongs to a HIPAA-designated record set
 * (medical records, billing records, enrollment records, etc.).
 */
const HIPAA_DESIGNATED_RECORD_SET: ComplianceRule = {
  id: 'HIPAA_DESIGNATED_RECORD_SET',
  regulation: 'hipaa',
  name: 'Designated Record Set Verification',
  description:
    'Data access must target a HIPAA-designated record set (medical, billing, enrollment, etc.) (§164.524).',
  severity: 'medium',
  evaluate(context) {
    const recordSetType = context.data['recordSetType'];

    // If no record set context, rule is not applicable
    if (recordSetType === undefined) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const validRecordSets = [
      'medical_record',
      'billing_record',
      'enrollment_record',
      'case_management',
      'claims_adjudication',
    ];

    if (typeof recordSetType === 'string' && validRecordSets.includes(recordSetType)) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'HIPAA-164.524',
        message: `Invalid or unrecognized record set type: "${String(recordSetType)}".`,
        severity: this.severity,
        remediation:
          'Ensure the data being accessed belongs to a valid designated record set (medical_record, billing_record, enrollment_record, case_management, claims_adjudication).',
      },
    };
  },
};

// ─── Accounting of Disclosures Rule ──────────────────────────────

/**
 * Verifies that PHI disclosures are tracked with complete metadata
 * and that disclosure records are maintained for at least 6 years.
 */
const HIPAA_ACCOUNTING_OF_DISCLOSURES: ComplianceRule = {
  id: 'HIPAA_ACCOUNTING_OF_DISCLOSURES',
  regulation: 'hipaa',
  name: 'Accounting of Disclosures',
  description:
    'All PHI disclosures must be tracked with date, recipient, purpose, and description, and records retained for 6 years (§164.528).',
  severity: 'high',
  evaluate(context) {
    const isDisclosure = context.data['isDisclosure'] === true;

    // If not a disclosure action, rule is not applicable
    if (!isDisclosure) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const hasDisclosureDate = typeof context.data['disclosureDate'] === 'string' ||
      typeof context.data['disclosureDate'] === 'number';
    const hasRecipient = typeof context.data['disclosureRecipient'] === 'string' &&
      (context.data['disclosureRecipient'] as string).length > 0;
    const hasPurpose = typeof context.data['disclosurePurpose'] === 'string' &&
      (context.data['disclosurePurpose'] as string).length > 0;
    const hasDescription = typeof context.data['disclosureDescription'] === 'string' &&
      (context.data['disclosureDescription'] as string).length > 0;

    if (hasDisclosureDate && hasRecipient && hasPurpose && hasDescription) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const missing: string[] = [];
    if (!hasDisclosureDate) missing.push('disclosureDate');
    if (!hasRecipient) missing.push('disclosureRecipient');
    if (!hasPurpose) missing.push('disclosurePurpose');
    if (!hasDescription) missing.push('disclosureDescription');

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'HIPAA-164.528',
        message: `PHI disclosure missing required tracking fields: ${missing.join(', ')}.`,
        severity: this.severity,
        remediation:
          'Provide all required disclosure tracking fields: disclosureDate, disclosureRecipient, disclosurePurpose, disclosureDescription.',
      },
    };
  },
};

// ─── Breach Risk Assessment Rule ─────────────────────────────────

/**
 * 4-factor breach risk assessment as required by HIPAA §164.402(2).
 * Factors: nature of PHI, unauthorized recipient, whether PHI was acquired/viewed,
 * and risk mitigation measures.
 */
const HIPAA_BREACH_RISK_ASSESSMENT: ComplianceRule = {
  id: 'HIPAA_BREACH_RISK_ASSESSMENT',
  regulation: 'hipaa',
  name: 'Breach Risk Assessment (4-Factor)',
  description:
    'Potential breaches must undergo a 4-factor risk assessment: nature of PHI, unauthorized person, acquisition/viewing, mitigation (§164.402(2)).',
  severity: 'critical',
  evaluate(context) {
    const isPotentialBreach = context.data['isPotentialBreach'] === true;

    // If not a breach scenario, rule is not applicable
    if (!isPotentialBreach) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const hasNatureAssessment = typeof context.data['phiNatureAssessment'] === 'string' &&
      (context.data['phiNatureAssessment'] as string).length > 0;
    const hasRecipientAssessment = typeof context.data['unauthorizedRecipientAssessment'] === 'string' &&
      (context.data['unauthorizedRecipientAssessment'] as string).length > 0;
    const hasAcquisitionAssessment = typeof context.data['acquisitionViewingAssessment'] === 'string' &&
      (context.data['acquisitionViewingAssessment'] as string).length > 0;
    const hasMitigationAssessment = typeof context.data['mitigationAssessment'] === 'string' &&
      (context.data['mitigationAssessment'] as string).length > 0;

    if (hasNatureAssessment && hasRecipientAssessment && hasAcquisitionAssessment && hasMitigationAssessment) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const missing: string[] = [];
    if (!hasNatureAssessment) missing.push('phiNatureAssessment');
    if (!hasRecipientAssessment) missing.push('unauthorizedRecipientAssessment');
    if (!hasAcquisitionAssessment) missing.push('acquisitionViewingAssessment');
    if (!hasMitigationAssessment) missing.push('mitigationAssessment');

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'HIPAA-164.402-2',
        message: `Breach risk assessment incomplete — missing factors: ${missing.join(', ')}.`,
        severity: this.severity,
        remediation:
          'Complete all 4 factors of the breach risk assessment: phiNatureAssessment, unauthorizedRecipientAssessment, acquisitionViewingAssessment, mitigationAssessment.',
      },
    };
  },
};

// ─── BAA Required (Enhanced) Rule ────────────────────────────────

/**
 * Enhanced BAA check — verifies both BAA existence and that the BAA
 * is current (not expired) before PHI sharing.
 */
const HIPAA_BAA_REQUIRED_ENHANCED: ComplianceRule = {
  id: 'HIPAA_BAA_REQUIRED_ENHANCED',
  regulation: 'hipaa',
  name: 'Enhanced BAA Verification',
  description:
    'A signed, non-expired BAA must be verified before sharing PHI with any subprocessor. BAA must be current and cover the specific data type (§164.502(e)).',
  severity: 'critical',
  evaluate(context) {
    const subprocessorId = context.data['subprocessorId'];

    // If no subprocessor involved, rule is not applicable
    if (subprocessorId === undefined || subprocessorId === null) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const baaOnFile = context.data['baaOnFile'] === true;
    const baaExpirationMs = context.data['baaExpirationDate'];

    if (!baaOnFile) {
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'HIPAA-164.502-E-ENH',
          message: `No BAA on file for subprocessor "${String(subprocessorId)}".`,
          severity: this.severity,
          remediation:
            'Execute a Business Associate Agreement before sharing any PHI with this subprocessor.',
        },
      };
    }

    // Check BAA expiration if provided
    if (typeof baaExpirationMs === 'number' && baaExpirationMs < context.timestamp.getTime()) {
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'HIPAA-164.502-E-ENH',
          message: `BAA for subprocessor "${String(subprocessorId)}" has expired.`,
          severity: this.severity,
          remediation:
            'Renew the Business Associate Agreement before sharing any PHI with this subprocessor.',
        },
      };
    }

    return { ruleId: this.id, regulation: this.regulation, passed: true };
  },
};

// ─── Authorization Required Rule ─────────────────────────────────

/**
 * Certain uses and disclosures of PHI require specific patient
 * authorization (e.g., marketing, sale of PHI, psychotherapy notes).
 */
const HIPAA_AUTHORIZATION_REQUIRED: ComplianceRule = {
  id: 'HIPAA_AUTHORIZATION_REQUIRED',
  regulation: 'hipaa',
  name: 'Patient Authorization Required',
  description:
    'Certain uses/disclosures require explicit patient authorization: marketing, sale of PHI, psychotherapy notes, and other non-TPO uses (§164.508).',
  severity: 'critical',
  evaluate(context) {
    const usageType = context.data['usageType'];

    // If no usage type specified, rule is not applicable
    if (typeof usageType !== 'string') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    // Uses that require explicit patient authorization per §164.508
    const authorizationRequiredUses = [
      'marketing',
      'sale_of_phi',
      'psychotherapy_notes',
      'research',
      'fundraising',
      'underwriting',
    ];

    if (!authorizationRequiredUses.includes(usageType)) {
      // Standard TPO (Treatment, Payment, Operations) — no extra authorization needed
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const hasPatientAuthorization = context.data['patientAuthorizationOnFile'] === true;

    if (hasPatientAuthorization) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'HIPAA-164.508',
        message: `Usage type "${usageType}" requires explicit patient authorization which is not on file.`,
        severity: this.severity,
        remediation:
          'Obtain a signed HIPAA authorization form from the patient before this use/disclosure of PHI.',
      },
    };
  },
};

// ─── Export ──────────────────────────────────────────────────────

export const HIPAA_ENHANCED_RULES: ReadonlyArray<ComplianceRule> = [
  HIPAA_MINIMUM_NECESSARY_ENHANCED,
  HIPAA_DESIGNATED_RECORD_SET,
  HIPAA_ACCOUNTING_OF_DISCLOSURES,
  HIPAA_BREACH_RISK_ASSESSMENT,
  HIPAA_BAA_REQUIRED_ENHANCED,
  HIPAA_AUTHORIZATION_REQUIRED,
];
