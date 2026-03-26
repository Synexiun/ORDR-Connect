/**
 * TCPA rules — Telephone Consumer Protection Act.
 *
 * Governs autodialed calls/texts, Do-Not-Call compliance,
 * opt-out processing, caller identification, and time restrictions.
 */

import type { ComplianceRule } from '../types.js';

/** Written consent required for autodialed or pre-recorded calls/texts. */
const TCPA_PRIOR_EXPRESS_CONSENT: ComplianceRule = {
  id: 'TCPA_PRIOR_EXPRESS_CONSENT',
  regulation: 'tcpa',
  name: 'Prior Express Written Consent',
  description:
    'Written consent required before placing autodialed or pre-recorded calls/texts (47 USC §227(b)(1)).',
  severity: 'critical',
  evaluate(context) {
    const hasConsent = context.data['priorExpressConsent'] === true;
    const isAutodialed = context.data['isAutodialed'] === true;

    // Only enforce when the contact is autodialed
    if (!isAutodialed || hasConsent) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'TCPA-227-B1',
        message: 'Autodialed contact attempted without prior express written consent.',
        severity: this.severity,
        remediation:
          'Obtain documented prior express written consent before placing autodialed calls or sending automated texts.',
      },
    };
  },
};

/** Must check the Do-Not-Call registry before calling. */
const TCPA_DNC_CHECK: ComplianceRule = {
  id: 'TCPA_DNC_CHECK',
  regulation: 'tcpa',
  name: 'Do-Not-Call Registry Check',
  description:
    'Must check the National Do-Not-Call Registry before placing calls (47 CFR §64.1200(c)(2)).',
  severity: 'critical',
  evaluate(context) {
    const isOnDnc = context.data['isOnDncList'] === true;

    if (!isOnDnc) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'TCPA-64.1200-C2',
        message: 'Contact attempted to a number on the Do-Not-Call registry.',
        severity: this.severity,
        remediation:
          'Remove this number from the call list immediately. Scrub all lists against the DNC registry at least every 31 days.',
      },
    };
  },
};

/** Opt-out requests must be processed (within 30 days maximum). */
const TCPA_OPT_OUT: ComplianceRule = {
  id: 'TCPA_OPT_OUT',
  regulation: 'tcpa',
  name: 'Opt-Out Processing',
  description:
    'Must honor opt-out requests and process them within 30 days (47 CFR §64.1200(d)).',
  severity: 'critical',
  evaluate(context) {
    const hasOptedOut = context.data['consumerOptedOut'] === true;

    if (!hasOptedOut) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'TCPA-64.1200-D',
        message: 'Contact attempted with a consumer who has opted out.',
        severity: this.severity,
        remediation:
          'Immediately cease contact. Ensure opt-out was processed and this number is suppressed from all future campaigns.',
      },
    };
  },
};

/** Must provide caller identification on every call. */
const TCPA_CALLER_ID: ComplianceRule = {
  id: 'TCPA_CALLER_ID',
  regulation: 'tcpa',
  name: 'Caller Identification Required',
  description:
    'Must transmit caller identification information with every call (47 CFR §64.1200(b)).',
  severity: 'high',
  evaluate(context) {
    const hasCallerId = context.data['callerIdProvided'] === true;

    // Only enforce for voice channel
    if (context.channel !== 'voice' && context.channel !== 'phone') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (hasCallerId) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'TCPA-64.1200-B',
        message: 'Outbound call placed without caller identification.',
        severity: this.severity,
        remediation:
          'Configure the telephony system to transmit valid caller ID information on every outbound call.',
      },
    };
  },
};

/** No calls before 8AM or after 9PM local time. */
const TCPA_TIME_RESTRICTIONS: ComplianceRule = {
  id: 'TCPA_TIME_RESTRICTIONS',
  regulation: 'tcpa',
  name: 'Calling Time Restrictions',
  description:
    'No telephone solicitations before 8:00 AM or after 9:00 PM local time (47 CFR §64.1200(c)(1)).',
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
        code: 'TCPA-64.1200-C1',
        message: `Call attempted at local hour ${localHour} — allowed only between 8:00 AM and 9:00 PM.`,
        severity: this.severity,
        remediation:
          'Reschedule the call within the permissible 8AM–9PM window in the consumer\'s local timezone.',
      },
    };
  },
};

export const TCPA_RULES: ReadonlyArray<ComplianceRule> = [
  TCPA_PRIOR_EXPRESS_CONSENT,
  TCPA_DNC_CHECK,
  TCPA_OPT_OUT,
  TCPA_CALLER_ID,
  TCPA_TIME_RESTRICTIONS,
];
