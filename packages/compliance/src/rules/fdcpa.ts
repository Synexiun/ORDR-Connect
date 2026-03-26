/**
 * FDCPA / Regulation F rules — Fair Debt Collection Practices Act.
 *
 * Governs debt collector contact frequency, timing, disclosures,
 * harassment prevention, cease-communication, and third-party disclosure.
 */

import type { ComplianceRule } from '../types.js';

/** Max 7 contact attempts per debt per 7-day rolling period. */
const FDCPA_CONTACT_FREQUENCY: ComplianceRule = {
  id: 'FDCPA_CONTACT_FREQUENCY',
  regulation: 'fdcpa',
  name: 'Contact Frequency Limit (Regulation F)',
  description:
    'No more than 7 contact attempts per debt within a 7-day rolling period (12 CFR §1006.14(b)(2)).',
  severity: 'critical',
  evaluate(context) {
    const contactAttempts = context.data['contactAttemptsLast7Days'];
    if (typeof contactAttempts !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (contactAttempts < 7) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'FDCPA-1006.14-B2',
        message: `${contactAttempts} contact attempts in last 7 days — maximum is 7.`,
        severity: this.severity,
        remediation:
          'Suspend outbound contact for this debt until the 7-day rolling window allows additional attempts.',
      },
    };
  },
};

/** No contact before 8AM or after 9PM in the customer's local timezone. */
const FDCPA_CONTACT_TIMING: ComplianceRule = {
  id: 'FDCPA_CONTACT_TIMING',
  regulation: 'fdcpa',
  name: 'Contact Time Restrictions',
  description:
    'No contact before 8:00 AM or after 9:00 PM in the consumer\'s local time (15 USC §1692c(a)(1)).',
  severity: 'critical',
  evaluate(context) {
    const localHour = context.data['localHour'];
    if (typeof localHour !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (localHour >= 8 && localHour < 21) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'FDCPA-1692C-A1',
        message: `Contact attempted at local hour ${localHour} — allowed only between 8:00 AM and 9:00 PM.`,
        severity: this.severity,
        remediation:
          'Reschedule the contact attempt within the permissible 8AM–9PM window in the consumer\'s timezone.',
      },
    };
  },
};

/** Every communication must include the Mini-Miranda disclosure. */
const FDCPA_MINI_MIRANDA: ComplianceRule = {
  id: 'FDCPA_MINI_MIRANDA',
  regulation: 'fdcpa',
  name: 'Mini-Miranda Disclosure',
  description:
    'Every communication must state that the debt collector is attempting to collect a debt (15 USC §1692e(11)).',
  severity: 'high',
  evaluate(context) {
    const hasMiniMiranda = context.data['miniMirandaIncluded'] === true;

    if (hasMiniMiranda) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'FDCPA-1692E-11',
        message: 'Communication missing required Mini-Miranda disclosure.',
        severity: this.severity,
        remediation:
          'Include the statement: "This is an attempt to collect a debt. Any information obtained will be used for that purpose."',
      },
    };
  },
};

/** No threats, obscene language, or repeated calls intended to annoy. */
const FDCPA_HARASSMENT_PREVENTION: ComplianceRule = {
  id: 'FDCPA_HARASSMENT_PREVENTION',
  regulation: 'fdcpa',
  name: 'Harassment Prevention',
  description:
    'Prohibits threats of violence, obscene language, and repeated calls to annoy or harass (15 USC §1692d).',
  severity: 'critical',
  evaluate(context) {
    const flaggedContent = context.data['contentFlagged'] === true;
    const repeatedCallsToAnnoy = context.data['repeatedCallsToAnnoy'] === true;

    if (!flaggedContent && !repeatedCallsToAnnoy) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'FDCPA-1692D',
        message: 'Communication flagged for potential harassment or abusive content.',
        severity: this.severity,
        remediation:
          'Review and remove threatening, obscene, or repetitively harassing content before sending.',
      },
    };
  },
};

/** Must honor written cease-and-desist requests. */
const FDCPA_CEASE_COMMUNICATION: ComplianceRule = {
  id: 'FDCPA_CEASE_COMMUNICATION',
  regulation: 'fdcpa',
  name: 'Cease Communication Compliance',
  description:
    'Must stop all communication when consumer sends a written cease-and-desist (15 USC §1692c(c)).',
  severity: 'critical',
  evaluate(context) {
    const ceaseRequested = context.data['ceaseAndDesistOnFile'] === true;

    if (!ceaseRequested) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'FDCPA-1692C-C',
        message: 'Contact attempted with consumer who has filed a cease-and-desist request.',
        severity: this.severity,
        remediation:
          'Cease all communication with this consumer immediately. Only permissible contact is to advise of specific action (e.g., legal proceedings).',
      },
    };
  },
};

/** Cannot disclose debt information to third parties. */
const FDCPA_THIRD_PARTY_DISCLOSURE: ComplianceRule = {
  id: 'FDCPA_THIRD_PARTY_DISCLOSURE',
  regulation: 'fdcpa',
  name: 'Third-Party Disclosure Prohibition',
  description:
    'Cannot communicate about a debt with any person other than the consumer, their attorney, or a credit bureau (15 USC §1692c(b)).',
  severity: 'critical',
  evaluate(context) {
    const isThirdParty = context.data['recipientIsThirdParty'] === true;

    if (!isThirdParty) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'FDCPA-1692C-B',
        message: 'Attempted disclosure of debt information to a third party.',
        severity: this.severity,
        remediation:
          'Only communicate debt information directly to the consumer, their attorney, a consumer reporting agency, the creditor, or the creditor\'s attorney.',
      },
    };
  },
};

export const FDCPA_RULES: ReadonlyArray<ComplianceRule> = [
  FDCPA_CONTACT_FREQUENCY,
  FDCPA_CONTACT_TIMING,
  FDCPA_MINI_MIRANDA,
  FDCPA_HARASSMENT_PREVENTION,
  FDCPA_CEASE_COMMUNICATION,
  FDCPA_THIRD_PARTY_DISCLOSURE,
];
