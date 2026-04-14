/**
 * RESPA rules — Real Estate Settlement Procedures Act (12 U.S.C. § 2601 et seq.)
 * and Regulation X (12 CFR Part 1024), as amended by the CFPB mortgage servicing rules.
 *
 * Applies when tenants are mortgage servicers, originators, or settlement service
 * providers using ORDR-Connect to communicate with borrowers.
 *
 * Rules enforced:
 *   12 CFR § 1024.39   — Early intervention for delinquent borrowers (36-day contact)
 *   12 CFR § 1024.41(b) — Loss mitigation application acknowledgment (5 business days)
 *   12 CFR § 1024.41(c) — Loss mitigation application evaluation (30 calendar days)
 *   12 U.S.C. § 2607   — Section 8: kickback and referral fee prohibition
 *   12 CFR § 1024.37   — Force-placed insurance notice (45-day advance warning)
 *   12 CFR § 1024.40   — Continuity of contact — single point of contact during loss mitigation
 *   12 CFR § 1026.41   — Periodic billing statement required for closed-end mortgages
 */

import type { ComplianceRule } from '../types.js';

// ─── Timing constants ────────────────────────────────────────────

/** 5 business days ≈ 7 calendar days (loss mitigation acknowledgment). */
const FIVE_BUSINESS_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** 36 calendar days — early intervention contact deadline. */
const THIRTY_SIX_DAYS_MS = 36 * 24 * 60 * 60 * 1000;

/** 30 calendar days — loss mitigation evaluation deadline. */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** 45 calendar days — force-placed insurance advance notice. */
const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;

// ─── 12 CFR § 1024.39 — Early Intervention ──────────────────────

/**
 * Servicers must make good-faith efforts to establish live contact with a
 * delinquent borrower no later than the 36th day of delinquency and provide
 * them with loss mitigation option information.
 *
 * context.data:
 *   borrowerDelinquentSince  — Unix ms timestamp when delinquency began
 *   earlyInterventionContactAt — Unix ms timestamp of live contact (optional)
 *   earlyInterventionAttempted — true if the servicer has attempted contact
 */
const RESPA_EARLY_INTERVENTION: ComplianceRule = {
  id: 'RESPA_EARLY_INTERVENTION',
  regulation: 'respa',
  name: 'Early Intervention — 36-Day Live Contact Requirement',
  description:
    'Mortgage servicers must make good-faith efforts to establish live contact with a delinquent borrower by the 36th day of delinquency and provide information about loss mitigation options (12 CFR § 1024.39(a)).',
  severity: 'critical',
  evaluate(context) {
    const delinquentSince = context.data['borrowerDelinquentSince'];
    if (typeof delinquentSince !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const contactAt = context.data['earlyInterventionContactAt'];
    if (typeof contactAt === 'number') {
      const gap = contactAt - delinquentSince;
      if (gap <= THIRTY_SIX_DAYS_MS) {
        return { ruleId: this.id, regulation: this.regulation, passed: true };
      }
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'RESPA-1024.39A',
          message: `Early intervention contact made ${Math.round(gap / (24 * 60 * 60 * 1000))} days after delinquency began — exceeds 36-day requirement.`,
          severity: this.severity,
          remediation:
            'Establish live contact with delinquent borrowers within 36 days of delinquency. Provide information about available loss mitigation options and how to contact the servicer.',
        },
      };
    }

    const elapsed = context.timestamp.getTime() - delinquentSince;
    if (elapsed <= THIRTY_SIX_DAYS_MS) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const attempted = context.data['earlyInterventionAttempted'] === true;
    if (attempted) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'RESPA-1024.39A',
        message: `Borrower delinquent for ${Math.round(elapsed / (24 * 60 * 60 * 1000))} days — no early intervention contact attempt on record.`,
        severity: this.severity,
        remediation:
          'Immediately attempt live contact with the borrower. Document all outreach attempts. Send written early intervention notice (12 CFR § 1024.39(b)) within 45 days of delinquency.',
      },
    };
  },
};

// ─── 12 CFR § 1024.41(b) — Loss Mitigation Acknowledgment ───────

/**
 * Upon receiving a loss mitigation application (complete or incomplete),
 * the servicer must send an acknowledgment notice within 5 business days.
 *
 * context.data:
 *   lossMitigationApplicationReceivedAt — Unix ms timestamp
 *   lossMitigationAcknowledgedAt        — Unix ms timestamp (optional)
 */
const RESPA_LOSS_MITIGATION_ACK: ComplianceRule = {
  id: 'RESPA_LOSS_MITIGATION_ACK',
  regulation: 'respa',
  name: 'Loss Mitigation Application — 5-Business-Day Acknowledgment',
  description:
    'Servicers must acknowledge receipt of a loss mitigation application within 5 business days of receiving it (12 CFR § 1024.41(b)(2)).',
  severity: 'high',
  evaluate(context) {
    const receivedAt = context.data['lossMitigationApplicationReceivedAt'];
    if (typeof receivedAt !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const ackedAt = context.data['lossMitigationAcknowledgedAt'];
    if (typeof ackedAt === 'number') {
      const gap = ackedAt - receivedAt;
      if (gap <= FIVE_BUSINESS_DAYS_MS) {
        return { ruleId: this.id, regulation: this.regulation, passed: true };
      }
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'RESPA-1024.41B',
          message: `Loss mitigation acknowledgment sent ${Math.round(gap / (24 * 60 * 60 * 1000))} days after application receipt — exceeds 5-business-day limit.`,
          severity: this.severity,
          remediation:
            'Send loss mitigation acknowledgment letters within 5 business days of receiving any loss mitigation documentation. Include the acknowledgment date in servicing notes.',
        },
      };
    }

    const elapsed = context.timestamp.getTime() - receivedAt;
    if (elapsed <= FIVE_BUSINESS_DAYS_MS) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'RESPA-1024.41B',
        message: `Loss mitigation application received ${Math.round(elapsed / (24 * 60 * 60 * 1000))} days ago — acknowledgment not sent.`,
        severity: this.severity,
        remediation:
          "Send an acknowledgment notice immediately. The notice must include the servicer's contact information and a description of any additional documents needed to complete the application.",
      },
    };
  },
};

// ─── 12 CFR § 1024.41(c) — Loss Mitigation Evaluation ───────────

/**
 * Once a complete loss mitigation application is received, the servicer must
 * evaluate it and notify the borrower of available options within 30 calendar days.
 *
 * context.data:
 *   completeLmaReceivedAt     — Unix ms timestamp when the complete application was received
 *   lossMitigationEvaluatedAt — Unix ms timestamp when evaluation notice was sent (optional)
 */
const RESPA_LOSS_MITIGATION_EVALUATION: ComplianceRule = {
  id: 'RESPA_LOSS_MITIGATION_EVALUATION',
  regulation: 'respa',
  name: 'Loss Mitigation Evaluation — 30-Day Deadline',
  description:
    'Servicers must evaluate a complete loss mitigation application and notify the borrower of available options within 30 calendar days (12 CFR § 1024.41(c)(1)).',
  severity: 'critical',
  evaluate(context) {
    const completedAt = context.data['completeLmaReceivedAt'];
    if (typeof completedAt !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const evaluatedAt = context.data['lossMitigationEvaluatedAt'];
    if (typeof evaluatedAt === 'number') {
      const gap = evaluatedAt - completedAt;
      if (gap <= THIRTY_DAYS_MS) {
        return { ruleId: this.id, regulation: this.regulation, passed: true };
      }
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'RESPA-1024.41C',
          message: `Loss mitigation evaluation notice sent ${Math.round(gap / (24 * 60 * 60 * 1000))} days after complete application receipt — exceeds 30-day limit.`,
          severity: this.severity,
          remediation:
            'Evaluate complete loss mitigation applications and send written determination notices within 30 days. Include all available options and the terms of each.',
        },
      };
    }

    const elapsed = context.timestamp.getTime() - completedAt;
    if (elapsed <= THIRTY_DAYS_MS) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'RESPA-1024.41C',
        message: `Complete loss mitigation application received ${Math.round(elapsed / (24 * 60 * 60 * 1000))} days ago — evaluation notice not sent.`,
        severity: this.severity,
        remediation:
          'Send a written notice to the borrower identifying all available loss mitigation options and the terms of each. If no options are available, provide written notice of the denial with the reason.',
      },
    };
  },
};

// ─── 12 U.S.C. § 2607 (Section 8) — Kickback Prohibition ────────

/**
 * RESPA Section 8 prohibits giving or accepting any fee, kickback, or
 * thing of value for the referral of settlement service business.
 * Violators face criminal penalties and treble damages.
 *
 * context.data:
 *   settlementServiceReferral — true if a referral is being made to a settlement service provider
 *   referralFeeAccepted       — true if any compensation was accepted for the referral
 *   marketingServiceAgreement — true if an MSA (marketing service agreement) is in place
 *   msaIsLegitimate           — true if the MSA reflects fair market value for actual services
 */
const RESPA_KICKBACK_PROHIBITION: ComplianceRule = {
  id: 'RESPA_KICKBACK_PROHIBITION',
  regulation: 'respa',
  name: 'Section 8 — Referral Fee / Kickback Prohibition',
  description:
    'No person may give or receive any fee, kickback, or thing of value for the referral of settlement service business (12 U.S.C. § 2607(a)).',
  severity: 'critical',
  evaluate(context) {
    const isReferral = context.data['settlementServiceReferral'];
    if (isReferral !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const feeAccepted = context.data['referralFeeAccepted'] === true;
    if (!feeAccepted) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    // Marketing service agreements may be permissible if they reflect fair market value
    const hasMsa = context.data['marketingServiceAgreement'] === true;
    const msaLegitimate = context.data['msaIsLegitimate'] === true;
    if (hasMsa && msaLegitimate) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'RESPA-2607',
        message:
          'Referral fee or kickback accepted for settlement service referral — prohibited under RESPA Section 8.',
        severity: this.severity,
        remediation:
          'Cease all referral fee arrangements immediately. Marketing service agreements must reflect fair market value for actual, documented services. Consult CFPB guidance on permissible affiliated business arrangements. Violations carry criminal penalties and treble damages.',
      },
    };
  },
};

// ─── 12 CFR § 1024.37 — Force-Placed Insurance Notice ───────────

/**
 * Before charging a borrower for force-placed insurance, the servicer must:
 *   1. Send an initial notice at least 45 days before imposing the charge.
 *   2. Send a reminder notice at least 30 days after the initial notice.
 *   3. Send a second reminder at least 15 days before the charge.
 *
 * context.data:
 *   forcePlacedInsuranceIntended — true when force-placed insurance is being imposed
 *   initialNoticesSentAt         — Unix ms timestamp of initial 45-day notice
 *   chargePlannedAt              — Unix ms timestamp when charge will be imposed
 */
const RESPA_FORCE_PLACED_INSURANCE: ComplianceRule = {
  id: 'RESPA_FORCE_PLACED_INSURANCE',
  regulation: 'respa',
  name: 'Force-Placed Insurance — 45-Day Advance Notice',
  description:
    'Servicers must provide at least 45 days advance written notice before imposing a force-placed insurance charge on a borrower (12 CFR § 1024.37(c)).',
  severity: 'high',
  evaluate(context) {
    const fpiIntended = context.data['forcePlacedInsuranceIntended'];
    if (fpiIntended !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const noticeSentAt = context.data['initialNoticeSentAt'];
    const chargePlannedAt = context.data['chargePlannedAt'];

    if (typeof noticeSentAt !== 'number' || typeof chargePlannedAt !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const noticeLead = chargePlannedAt - noticeSentAt;
    if (noticeLead >= FORTY_FIVE_DAYS_MS) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'RESPA-1024.37C',
        message: `Force-placed insurance initial notice sent only ${Math.round(noticeLead / (24 * 60 * 60 * 1000))} days before the charge — minimum 45 days required.`,
        severity: this.severity,
        remediation:
          'Reschedule the force-placed insurance charge to at least 45 days after the initial notice. Also send a reminder notice 30 days after the initial notice and a final notice at least 15 days before the charge.',
      },
    };
  },
};

// ─── 12 CFR § 1024.40 — Continuity of Contact ───────────────────

/**
 * During loss mitigation, servicers must assign a single point of contact (SPOC)
 * to each borrower who requests loss mitigation or is 45+ days delinquent.
 * The SPOC must have access to current information about available options.
 *
 * context.data:
 *   lossmitigationActive   — true when the borrower is in active loss mitigation
 *   singlePointOfContact   — true if a SPOC has been assigned
 *   singlePointOfContactId — string identifier for the assigned SPOC
 */
const RESPA_CONTINUITY_OF_CONTACT: ComplianceRule = {
  id: 'RESPA_CONTINUITY_OF_CONTACT',
  regulation: 'respa',
  name: 'Continuity of Contact — Single Point of Contact Required',
  description:
    'Servicers must assign a designated single point of contact to each borrower who is in active loss mitigation or 45+ days delinquent (12 CFR § 1024.40).',
  severity: 'high',
  evaluate(context) {
    const lmActive = context.data['lossmitigationActive'];
    if (lmActive !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const spocAssigned = context.data['singlePointOfContact'] === true;
    const spocId = context.data['singlePointOfContactId'];
    const hasSPOC = spocAssigned && typeof spocId === 'string' && spocId.trim().length > 0;

    if (hasSPOC) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'RESPA-1024.40',
        message:
          'Borrower is in active loss mitigation but no single point of contact (SPOC) has been assigned.',
        severity: this.severity,
        remediation:
          "Assign a designated SPOC to the borrower immediately. Provide the borrower with the SPOC's direct contact information. The SPOC must have access to current information about all available loss mitigation options.",
      },
    };
  },
};

// ─── 12 CFR § 1026.41 — Periodic Statement ──────────────────────

/**
 * Servicers of closed-end consumer credit transactions secured by a dwelling
 * must send periodic billing statements for each billing cycle.
 * Statement must be sent within a reasonable time before payment is due.
 *
 * context.data:
 *   mortgageLoanServicing       — true when servicing a closed-end consumer mortgage
 *   periodicStatementSent       — true if a statement was sent for the current billing cycle
 *   daysSinceLastStatement      — number of days since the last periodic statement
 */
const RESPA_PERIODIC_STATEMENT: ComplianceRule = {
  id: 'RESPA_PERIODIC_STATEMENT',
  regulation: 'respa',
  name: 'Periodic Billing Statement Required',
  description:
    'Mortgage servicers must send periodic billing statements to borrowers for each billing cycle. Statements must include payment amount, due date, and account information (12 CFR § 1026.41).',
  severity: 'high',
  evaluate(context) {
    const isServicing = context.data['mortgageLoanServicing'];
    if (isServicing !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const statementSent = context.data['periodicStatementSent'];
    if (statementSent === true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const daysSince = context.data['daysSinceLastStatement'];
    if (typeof daysSince === 'number' && daysSince <= 35) {
      // Within one billing cycle plus 5 days — not yet overdue
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'RESPA-1026.41',
        message:
          typeof daysSince === 'number'
            ? `No periodic mortgage statement sent in ${daysSince} days — exceeds one billing cycle.`
            : 'No periodic mortgage billing statement on record for the current cycle.',
        severity: this.severity,
        remediation:
          'Send a periodic billing statement for the current cycle. Statements must include: payment amount, due date, late payment information, amount of past due payments, transaction activity since last statement, partial payment allocation information, and contact information.',
      },
    };
  },
};

// ─── Rule Array ──────────────────────────────────────────────────

export const RESPA_RULES: ReadonlyArray<ComplianceRule> = [
  RESPA_EARLY_INTERVENTION,
  RESPA_LOSS_MITIGATION_ACK,
  RESPA_LOSS_MITIGATION_EVALUATION,
  RESPA_KICKBACK_PROHIBITION,
  RESPA_FORCE_PLACED_INSURANCE,
  RESPA_CONTINUITY_OF_CONTACT,
  RESPA_PERIODIC_STATEMENT,
];
