/**
 * CCPA / CPRA rules — California Consumer Privacy Act (Cal. Civ. Code §1798.100 et seq.)
 * as amended by the California Privacy Rights Act (effective 2023-01-01).
 *
 * Consumer rights enforced here:
 *   §1798.100   Right to Know / Access (45 days, one 45-day extension)
 *   §1798.105   Right to Delete (45 days, one 45-day extension)
 *   §1798.106   Right to Correct inaccurate PI (CPRA, 45 days)
 *   §1798.120   Right to Opt-Out of Sale/Sharing (15 business days ≈ 21 calendar days)
 *   §1798.120(c) Children's opt-in consent for sale (<16; <13 requires parental)
 *   §1798.121   Right to Limit Use of Sensitive PI (CPRA)
 *   §1798.125   Right to Non-Discrimination for exercising rights
 *   §1798.135(b) Global Privacy Control (GPC) must be honored as opt-out (CPRA)
 *   §1798.100(c) Data Minimization — reasonably necessary for disclosed purpose (CPRA)
 *   §1798.100(a)(3) Retention Disclosure required (CPRA)
 *   §1798.140(ag) Service Provider written contract required
 *   §1798.150   Consumer breach notification required
 */

import type { ComplianceRule } from '../types.js';

// ─── Timing constants ────────────────────────────────────────────

/** 45 calendar days — CCPA response deadline for Know/Delete/Correct. */
const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;

/** 90 calendar days — CCPA extended response deadline (45 + 45 extension). */
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * 21 calendar days — conservative approximation of "15 business days"
 * for opt-out processing (§1798.120 / CPPA guidance).
 */
const FIFTEEN_BUSINESS_DAYS_MS = 21 * 24 * 60 * 60 * 1000;

/** 30 calendar days — industry-standard breach notification timeline (§1798.150). */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ─── §1798.100 — Right to Know / Access ─────────────────────────

/**
 * Businesses must respond to access requests within 45 days.
 * One 45-day extension is permitted with prior notice (§1798.100(a)(2)).
 *
 * context.data:
 *   accessRequestedAt   — Unix ms timestamp of the request
 *   accessResponseProvidedAt — Unix ms timestamp of the response (optional)
 *   accessExtensionGranted — true if 45-day extension notice was sent
 */
const CCPA_RIGHT_TO_KNOW: ComplianceRule = {
  id: 'CCPA_RIGHT_TO_KNOW',
  regulation: 'ccpa',
  name: 'Right to Know / Access — 45-Day Response',
  description:
    "Businesses must respond to a consumer's right-to-know request within 45 days. One 45-day extension is permitted if the consumer is notified within the initial 45 days (Cal. Civ. Code §1798.100(a)).",
  severity: 'critical',
  evaluate(context) {
    const requestedAt = context.data['accessRequestedAt'];
    if (typeof requestedAt !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const responseAt = context.data['accessResponseProvidedAt'];
    if (typeof responseAt === 'number') {
      const gap = responseAt - requestedAt;
      const deadline =
        context.data['accessExtensionGranted'] === true ? NINETY_DAYS_MS : FORTY_FIVE_DAYS_MS;
      if (gap <= deadline) {
        return { ruleId: this.id, regulation: this.regulation, passed: true };
      }
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'CCPA-1798.100',
          message: `Access request responded ${Math.round(gap / (24 * 60 * 60 * 1000))} days after receipt — exceeds deadline.`,
          severity: this.severity,
          remediation:
            'Respond to consumer access requests within 45 days. If more time is needed, notify the consumer and invoke the 45-day extension.',
        },
      };
    }

    const elapsed = context.timestamp.getTime() - requestedAt;
    const deadline =
      context.data['accessExtensionGranted'] === true ? NINETY_DAYS_MS : FORTY_FIVE_DAYS_MS;
    if (elapsed <= deadline) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'CCPA-1798.100',
        message: `Access request pending for ${Math.round(elapsed / (24 * 60 * 60 * 1000))} days without response.`,
        severity: this.severity,
        remediation:
          "Provide the consumer's personal information or a denial with grounds immediately. If past 45 days, send an extension notice now.",
      },
    };
  },
};

// ─── §1798.105 — Right to Delete ────────────────────────────────

/**
 * Deletion requests must be honored within 45 days.
 * One 45-day extension permitted with consumer notice (§1798.105(c)).
 *
 * context.data:
 *   deletionRequestedAt — Unix ms timestamp
 *   deletionCompletedAt — Unix ms timestamp (optional)
 *   deletionExtensionGranted — true if extension notice sent
 */
const CCPA_RIGHT_TO_DELETE: ComplianceRule = {
  id: 'CCPA_RIGHT_TO_DELETE',
  regulation: 'ccpa',
  name: 'Right to Delete — 45-Day Deadline',
  description:
    "Businesses must delete a consumer's personal information within 45 days of a deletion request. A one-time 45-day extension is allowed if the consumer is notified (Cal. Civ. Code §1798.105).",
  severity: 'critical',
  evaluate(context) {
    const requestedAt = context.data['deletionRequestedAt'];
    if (typeof requestedAt !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const completedAt = context.data['deletionCompletedAt'];
    if (typeof completedAt === 'number') {
      const gap = completedAt - requestedAt;
      const deadline =
        context.data['deletionExtensionGranted'] === true ? NINETY_DAYS_MS : FORTY_FIVE_DAYS_MS;
      if (gap <= deadline) {
        return { ruleId: this.id, regulation: this.regulation, passed: true };
      }
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'CCPA-1798.105',
          message: `Deletion request fulfilled ${Math.round(gap / (24 * 60 * 60 * 1000))} days after receipt — exceeds deadline.`,
          severity: this.severity,
          remediation:
            'Process deletion requests within 45 days. Notify the consumer within the initial period if an extension is required.',
        },
      };
    }

    const elapsed = context.timestamp.getTime() - requestedAt;
    const deadline =
      context.data['deletionExtensionGranted'] === true ? NINETY_DAYS_MS : FORTY_FIVE_DAYS_MS;
    if (elapsed <= deadline) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'CCPA-1798.105',
        message: `Deletion request pending for ${Math.round(elapsed / (24 * 60 * 60 * 1000))} days — exceeds 45-day limit.`,
        severity: this.severity,
        remediation:
          "Complete deletion of the consumer's personal information immediately and direct all service providers and contractors to do the same.",
      },
    };
  },
};

// ─── §1798.106 (CPRA) — Right to Correct ────────────────────────

/**
 * CPRA: Consumers may request correction of inaccurate PI.
 * Business must respond and correct within 45 days (one 45-day extension allowed).
 *
 * context.data:
 *   correctionRequestedAt — Unix ms timestamp
 *   correctionCompletedAt — Unix ms timestamp (optional)
 *   correctionExtensionGranted — true if extension notice sent
 */
const CCPA_RIGHT_TO_CORRECT: ComplianceRule = {
  id: 'CCPA_RIGHT_TO_CORRECT',
  regulation: 'ccpa',
  name: 'Right to Correct Inaccurate Personal Information (CPRA)',
  description:
    'Consumers have the right to correct inaccurate personal information. Businesses must process correction requests within 45 days (Cal. Civ. Code §1798.106, CPRA).',
  severity: 'high',
  evaluate(context) {
    const requestedAt = context.data['correctionRequestedAt'];
    if (typeof requestedAt !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const completedAt = context.data['correctionCompletedAt'];
    if (typeof completedAt === 'number') {
      const gap = completedAt - requestedAt;
      const deadline =
        context.data['correctionExtensionGranted'] === true ? NINETY_DAYS_MS : FORTY_FIVE_DAYS_MS;
      if (gap <= deadline) {
        return { ruleId: this.id, regulation: this.regulation, passed: true };
      }
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'CCPA-1798.106',
          message: `Correction request fulfilled ${Math.round(gap / (24 * 60 * 60 * 1000))} days after receipt.`,
          severity: this.severity,
          remediation:
            'Correct inaccurate personal information within 45 days and direct service providers to do the same.',
        },
      };
    }

    const elapsed = context.timestamp.getTime() - requestedAt;
    const deadline =
      context.data['correctionExtensionGranted'] === true ? NINETY_DAYS_MS : FORTY_FIVE_DAYS_MS;
    if (elapsed <= deadline) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'CCPA-1798.106',
        message: `Correction request pending for ${Math.round(elapsed / (24 * 60 * 60 * 1000))} days without action.`,
        severity: this.severity,
        remediation:
          'Process the correction request. If disputed, maintain both versions and inform downstream service providers of the dispute.',
      },
    };
  },
};

// ─── §1798.120 — Right to Opt-Out of Sale/Sharing ───────────────

/**
 * Consumers may opt out of the sale or sharing of personal information.
 * Businesses must stop the sale within 15 business days (~21 calendar days).
 *
 * context.data:
 *   saleOptOutRequestedAt — Unix ms timestamp
 *   saleOptOutProcessedAt — Unix ms timestamp (optional, when opt-out was enacted)
 */
const CCPA_OPT_OUT_SALE: ComplianceRule = {
  id: 'CCPA_OPT_OUT_SALE',
  regulation: 'ccpa',
  name: 'Right to Opt-Out of Sale/Sharing — 15-Business-Day Processing',
  description:
    'Consumers have the right to opt out of the sale or sharing of their personal information. Businesses must stop selling/sharing within 15 business days of receiving the opt-out (Cal. Civ. Code §1798.120).',
  severity: 'critical',
  evaluate(context) {
    const requestedAt = context.data['saleOptOutRequestedAt'];
    if (typeof requestedAt !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const processedAt = context.data['saleOptOutProcessedAt'];
    if (typeof processedAt === 'number') {
      const gap = processedAt - requestedAt;
      if (gap <= FIFTEEN_BUSINESS_DAYS_MS) {
        return { ruleId: this.id, regulation: this.regulation, passed: true };
      }
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'CCPA-1798.120',
          message: `Opt-out of sale processed ${Math.round(gap / (24 * 60 * 60 * 1000))} days after request — exceeds 15-business-day limit.`,
          severity: this.severity,
          remediation:
            "Process opt-out of sale/sharing immediately and notify all third parties that received the consumer's data within the last 90 days.",
        },
      };
    }

    const elapsed = context.timestamp.getTime() - requestedAt;
    if (elapsed <= FIFTEEN_BUSINESS_DAYS_MS) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'CCPA-1798.120',
        message: `Opt-out of sale request pending for ${Math.round(elapsed / (24 * 60 * 60 * 1000))} days without processing.`,
        severity: this.severity,
        remediation:
          "Immediately cease selling/sharing the consumer's personal information and notify all third-party recipients of the opt-out.",
      },
    };
  },
};

// ─── §1798.120(c) — Children's Opt-In for Sale ──────────────────

/**
 * Selling/sharing personal information of a minor requires affirmative opt-in.
 *   - Under 13: opt-in consent must be given by a parent/guardian.
 *   - 13–15: opt-in consent must be given by the minor themselves.
 *
 * context.data:
 *   dataSubjectAge — numeric age of the consumer
 *   consentForSaleGiven — true if the minor (13–15) gave affirmative opt-in
 *   parentalConsentForSaleGiven — true if parent/guardian gave opt-in (<13)
 *   saleOrSharingIntended — true if data will be sold/shared
 */
const CCPA_CHILD_OPT_IN: ComplianceRule = {
  id: 'CCPA_CHILD_OPT_IN',
  regulation: 'ccpa',
  name: "Children's Opt-In Consent for Sale of Personal Information",
  description:
    "Selling or sharing personal information of consumers under 16 requires affirmative opt-in. Under 13: parental/guardian consent required. Age 13–15: minor's own affirmative opt-in required (Cal. Civ. Code §1798.120(c)).",
  severity: 'critical',
  evaluate(context) {
    const age = context.data['dataSubjectAge'];
    const saleIntended = context.data['saleOrSharingIntended'];

    if (typeof age !== 'number' || saleIntended !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (age >= 16) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (age < 13) {
      const parentalConsent = context.data['parentalConsentForSaleGiven'] === true;
      if (parentalConsent) {
        return { ruleId: this.id, regulation: this.regulation, passed: true };
      }
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'CCPA-1798.120C',
          message: `Consumer is ${age} years old — parental/guardian opt-in required before selling/sharing their personal information.`,
          severity: this.severity,
          remediation:
            'Obtain verifiable parental/guardian consent before selling or sharing personal information of consumers under 13.',
        },
      };
    }

    // Age 13–15
    const minorConsent = context.data['consentForSaleGiven'] === true;
    if (minorConsent) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'CCPA-1798.120C',
        message: `Consumer is ${age} years old — affirmative opt-in required from the minor before selling/sharing their personal information.`,
        severity: this.severity,
        remediation:
          'Obtain direct affirmative opt-in from the consumer (age 13–15) before selling or sharing their personal information.',
      },
    };
  },
};

// ─── §1798.121 (CPRA) — Sensitive Personal Information ──────────

/**
 * CPRA §1798.121: Sensitive PI (SPI) may only be used to:
 *   - Perform services or provide goods reasonably expected by the consumer
 *   - Detect security incidents, fraud, or illegal activity
 *   - Ensure physical safety
 *   - Perform short-term transient use
 *   - Perform internal research (de-identified / aggregated)
 *   - Maintain or service accounts, transactions, or customer relationships
 * Any other use requires separate consent.
 *
 * context.data:
 *   sensitivePersonalInfo — true when the data being processed is SPI
 *   sensitiveProcessingPurpose — string describing the purpose
 *   sensitiveConsentObtained — true if consumer consented to broader use
 */
const CCPA_SENSITIVE_PI_LIMIT: ComplianceRule = {
  id: 'CCPA_SENSITIVE_PI_LIMIT',
  regulation: 'ccpa',
  name: 'Sensitive Personal Information — Limited Use (CPRA)',
  description:
    'Sensitive personal information (SPI) may only be used for specific purposes listed in §1798.121. Any other use requires explicit consumer consent to limit further use (Cal. Civ. Code §1798.121, CPRA).',
  severity: 'critical',
  evaluate(context) {
    const isSpi = context.data['sensitivePersonalInfo'];
    if (isSpi !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const purpose = context.data['sensitiveProcessingPurpose'];
    if (typeof purpose !== 'string') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const allowedPurposes = [
      'service_provision',
      'security_fraud_detection',
      'physical_safety',
      'transient_use',
      'internal_research',
      'account_maintenance',
    ];

    if (allowedPurposes.includes(purpose)) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const consentObtained = context.data['sensitiveConsentObtained'] === true;
    if (consentObtained) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'CCPA-1798.121',
        message: `Sensitive personal information processed for purpose "${purpose}" which is not a permitted use under CPRA §1798.121.`,
        severity: this.severity,
        remediation:
          'Limit sensitive PI processing to the permitted purposes (service provision, security, safety, transient use, internal research, account maintenance), or obtain explicit consumer consent.',
      },
    };
  },
};

// ─── §1798.125 — Non-Discrimination ─────────────────────────────

/**
 * Consumers cannot be discriminated against for exercising CCPA rights.
 * Prohibited: denying goods/services, charging different prices, providing
 * lower quality, or suggesting any of the above.
 *
 * context.data:
 *   ccpaRightExercised — true if the consumer exercised a CCPA right
 *   serviceDenied — true if service was denied after exercising
 *   pricePenaltyApplied — true if a price penalty was applied
 *   qualityDegraded — true if service quality was degraded
 */
const CCPA_NON_DISCRIMINATION: ComplianceRule = {
  id: 'CCPA_NON_DISCRIMINATION',
  regulation: 'ccpa',
  name: 'Non-Discrimination for Exercising Privacy Rights',
  description:
    'Businesses may not discriminate against consumers who exercise their CCPA rights by denying goods/services, charging different prices, or providing lower quality (Cal. Civ. Code §1798.125).',
  severity: 'critical',
  evaluate(context) {
    const rightExercised = context.data['ccpaRightExercised'];
    if (rightExercised !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const denied = context.data['serviceDenied'] === true;
    const priceHit = context.data['pricePenaltyApplied'] === true;
    const qualityHit = context.data['qualityDegraded'] === true;

    if (!denied && !priceHit && !qualityHit) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const issues: string[] = [];
    if (denied) issues.push('service denied');
    if (priceHit) issues.push('price penalty applied');
    if (qualityHit) issues.push('service quality degraded');

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'CCPA-1798.125',
        message: `Discriminatory treatment detected after consumer exercised CCPA right: ${issues.join(', ')}.`,
        severity: this.severity,
        remediation:
          'Remove any discriminatory treatment immediately. Do not deny goods, charge different prices, or provide lower quality to consumers who exercise their CCPA rights.',
      },
    };
  },
};

// ─── §1798.135(b) (CPRA) — Global Privacy Control ───────────────

/**
 * CPRA §1798.135(b): Businesses must honor the GPC browser signal
 * as a valid opt-out of sale/sharing of personal information.
 *
 * context.data:
 *   gpcSignalDetected — true if GPC header/signal was present in the request
 *   gpcSignalHonored — true if the opt-out was processed
 */
const CCPA_GPC_SIGNAL: ComplianceRule = {
  id: 'CCPA_GPC_SIGNAL',
  regulation: 'ccpa',
  name: 'Global Privacy Control (GPC) Signal Must Be Honored (CPRA)',
  description:
    'The Global Privacy Control browser signal must be honored as a valid opt-out from sale and sharing of personal information (Cal. Civ. Code §1798.135(b), CPRA).',
  severity: 'high',
  evaluate(context) {
    const gpcDetected = context.data['gpcSignalDetected'];
    if (gpcDetected !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const gpcHonored = context.data['gpcSignalHonored'] === true;
    if (gpcHonored) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'CCPA-1798.135B',
        message:
          'Global Privacy Control (GPC) signal detected but not honored as opt-out from sale/sharing.',
        severity: this.severity,
        remediation:
          'Detect the Sec-GPC HTTP header and treat its presence as an opt-out from sale/sharing of personal information. Implement GPC detection in your web layer.',
      },
    };
  },
};

// ─── §1798.100(c) (CPRA) — Data Minimization ────────────────────

/**
 * CPRA §1798.100(c): Collection and use of personal information must be
 * reasonably necessary and proportionate to the disclosed purpose.
 *
 * context.data:
 *   collectedFields — string[] of fields collected
 *   necessaryFields — string[] of fields required for the stated purpose
 */
const CCPA_DATA_MINIMIZATION: ComplianceRule = {
  id: 'CCPA_DATA_MINIMIZATION',
  regulation: 'ccpa',
  name: 'Data Minimization — Reasonably Necessary Collection (CPRA)',
  description:
    'Personal information collection must be reasonably necessary and proportionate to the purposes for which it is used (Cal. Civ. Code §1798.100(c), CPRA).',
  severity: 'medium',
  evaluate(context) {
    const collected = context.data['collectedFields'];
    const necessary = context.data['necessaryFields'];

    if (!Array.isArray(collected) || !Array.isArray(necessary)) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const excess = (collected as string[]).filter((f) => !(necessary as string[]).includes(f));
    if (excess.length === 0) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'CCPA-1798.100C',
        message: `Excessive personal information collected beyond stated purpose: ${excess.join(', ')}.`,
        severity: this.severity,
        remediation:
          'Limit data collection to fields reasonably necessary for the disclosed purpose. Update your privacy notice if additional fields are genuinely required.',
      },
    };
  },
};

// ─── §1798.100(a)(3) (CPRA) — Retention Disclosure ──────────────

/**
 * CPRA §1798.100(a)(3): Businesses must disclose how long each category of
 * personal information is retained, or the criteria for determining retention.
 *
 * context.data:
 *   retentionPeriodDisclosed — true if retention is disclosed in the privacy notice
 */
const CCPA_RETENTION_DISCLOSURE: ComplianceRule = {
  id: 'CCPA_RETENTION_DISCLOSURE',
  regulation: 'ccpa',
  name: 'Retention Period Disclosure Required (CPRA)',
  description:
    'Businesses must disclose the length of time personal information will be retained, or the criteria used to determine retention (Cal. Civ. Code §1798.100(a)(3), CPRA).',
  severity: 'medium',
  evaluate(context) {
    const disclosed = context.data['retentionPeriodDisclosed'];
    if (disclosed === undefined) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    if (disclosed === true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'CCPA-1798.100A3',
        message:
          'Privacy notice does not disclose data retention periods or determination criteria.',
        severity: this.severity,
        remediation:
          'Add a retention period disclosure to your privacy policy for each category of personal information collected, or describe the criteria used to determine retention.',
      },
    };
  },
};

// ─── §1798.140(ag) — Service Provider Written Contract ──────────

/**
 * CCPA §1798.140(ag): Personal information may only be disclosed to a
 * "service provider" if a written contract prohibits the service provider
 * from retaining, using, or disclosing the data outside the scope of service.
 *
 * context.data:
 *   serviceProviderRelationship — true if data is being shared with a service provider
 *   dataServiceAgreementInPlace — true if a compliant written contract exists
 */
const CCPA_SERVICE_PROVIDER_CONTRACT: ComplianceRule = {
  id: 'CCPA_SERVICE_PROVIDER_CONTRACT',
  regulation: 'ccpa',
  name: 'Service Provider Written Contract Required',
  description:
    'Disclosing personal information to a service provider requires a written contract prohibiting retention, use, or disclosure of the data outside the service scope (Cal. Civ. Code §1798.140(ag)).',
  severity: 'high',
  evaluate(context) {
    const isServiceProvider = context.data['serviceProviderRelationship'];
    if (isServiceProvider !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const dsaInPlace = context.data['dataServiceAgreementInPlace'] === true;
    if (dsaInPlace) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'CCPA-1798.140AG',
        message:
          'Personal information shared with a service provider without a CCPA-compliant written contract.',
        severity: this.severity,
        remediation:
          'Execute a Data Service Agreement (DSA) with the service provider that includes CCPA-required restrictions before sharing personal information.',
      },
    };
  },
};

// ─── §1798.150 — Consumer Breach Notification ───────────────────

/**
 * CCPA §1798.150: Consumers have a private right of action when unencrypted,
 * non-redacted personal information is subject to unauthorized access.
 * Businesses should notify affected consumers promptly (AG guidance: 30 days).
 *
 * context.data:
 *   consumerBreachOccurred — true if a breach affecting consumer PI occurred
 *   breachDetectedAt — Unix ms timestamp of breach discovery
 *   consumerNotificationSentAt — Unix ms timestamp when notification was sent (optional)
 */
const CCPA_BREACH_NOTIFICATION: ComplianceRule = {
  id: 'CCPA_BREACH_NOTIFICATION',
  regulation: 'ccpa',
  name: 'Consumer Breach Notification',
  description:
    'Businesses must notify affected consumers of unauthorized access to unencrypted personal information. AG guidance recommends notification within 30 days (Cal. Civ. Code §1798.150).',
  severity: 'critical',
  evaluate(context) {
    const breachOccurred = context.data['consumerBreachOccurred'];
    if (breachOccurred !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const detectedAt = context.data['breachDetectedAt'];
    if (typeof detectedAt !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const notifiedAt = context.data['consumerNotificationSentAt'];
    if (typeof notifiedAt === 'number') {
      const gap = notifiedAt - detectedAt;
      if (gap <= THIRTY_DAYS_MS) {
        return { ruleId: this.id, regulation: this.regulation, passed: true };
      }
      return {
        ruleId: this.id,
        regulation: this.regulation,
        passed: false,
        violation: {
          code: 'CCPA-1798.150',
          message: `Consumer breach notification sent ${Math.round(gap / (24 * 60 * 60 * 1000))} days after breach discovery.`,
          severity: this.severity,
          remediation:
            'Notify affected consumers within 30 days of discovering a breach of unencrypted personal information. Ensure notifications include the required disclosures.',
        },
      };
    }

    const elapsed = context.timestamp.getTime() - detectedAt;
    if (elapsed <= THIRTY_DAYS_MS) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'CCPA-1798.150',
        message: `Consumer breach discovered ${Math.round(elapsed / (24 * 60 * 60 * 1000))} days ago — notification not yet sent.`,
        severity: this.severity,
        remediation:
          'Send breach notification to all affected consumers immediately. Notifications must include: nature of the breach, PI categories affected, date of breach, and contact information.',
      },
    };
  },
};

// ─── Rule Array ──────────────────────────────────────────────────

export const CCPA_RULES: ReadonlyArray<ComplianceRule> = [
  CCPA_RIGHT_TO_KNOW,
  CCPA_RIGHT_TO_DELETE,
  CCPA_RIGHT_TO_CORRECT,
  CCPA_OPT_OUT_SALE,
  CCPA_CHILD_OPT_IN,
  CCPA_SENSITIVE_PI_LIMIT,
  CCPA_NON_DISCRIMINATION,
  CCPA_GPC_SIGNAL,
  CCPA_DATA_MINIMIZATION,
  CCPA_RETENTION_DISCLOSURE,
  CCPA_SERVICE_PROVIDER_CONTRACT,
  CCPA_BREACH_NOTIFICATION,
];
