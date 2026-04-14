/**
 * FEC rules — Federal Election Commission (52 U.S.C. § 30101 et seq.)
 * and implementing regulations at 11 CFR Part 110.
 *
 * Applies when tenants are federal political committees, campaigns, PACs,
 * or Super PACs using ORDR-Connect to communicate with voters or donors.
 *
 * Rules enforced:
 *   §30120 / 11 CFR 110.11   — Disclaimer required on political communications
 *   §30120(a)(3)              — Express advocacy materials must identify funding
 *   §30104(f)                 — Electioneering communication 30/60-day pre-election window
 *   §30121                   — Prohibited sources (foreign nationals, federal contractors)
 *   11 CFR 110.11(a)(1)      — Internet-based political ad disclaimers
 *   §30116(a)(7)             — Coordinated expenditure limits with candidate campaigns
 */

import type { ComplianceRule } from '../types.js';

// ─── §30120 / 11 CFR 110.11 — Disclaimer Required ────────────────

/**
 * Any communication that expressly advocates for the election or defeat of a
 * clearly identified federal candidate must include a "Paid for by" disclaimer
 * with the full name of the paying committee.
 *
 * context.data:
 *   politicalCommunication — true when the message is a federal political communication
 *   disclaimerPresent       — true if the required disclaimer text is included
 *   payingCommitteeName     — string name of the paying political committee
 */
const FEC_DISCLAIMER_REQUIRED: ComplianceRule = {
  id: 'FEC_DISCLAIMER_REQUIRED',
  regulation: 'fec',
  name: 'Political Communication Disclaimer Required',
  description:
    'All federal political communications must include a "Paid for by [committee name]" disclaimer and authorization statement (52 U.S.C. § 30120; 11 CFR 110.11).',
  severity: 'critical',
  evaluate(context) {
    const isPolitical = context.data['politicalCommunication'];
    if (isPolitical !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const disclaimerPresent = context.data['disclaimerPresent'] === true;
    const payingCommittee = context.data['payingCommitteeName'];
    const hasCommitteeName =
      typeof payingCommittee === 'string' && payingCommittee.trim().length > 0;

    if (disclaimerPresent && hasCommitteeName) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const issues: string[] = [];
    if (!disclaimerPresent) issues.push('disclaimer text missing');
    if (!hasCommitteeName) issues.push('paying committee name not specified');

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'FEC-30120',
        message: `Federal political communication lacks required elements: ${issues.join(', ')}.`,
        severity: this.severity,
        remediation:
          'Add "Paid for by [Full Committee Name]" and "Authorized by [Candidate Name]" to all federal political communications. Abbreviated versions are permitted for communications under 200 characters (11 CFR 110.11(c)(2)).',
      },
    };
  },
};

// ─── §30120(a)(3) — Express Advocacy Disclosure ──────────────────

/**
 * Communications that expressly advocate for or against a federal candidate
 * (using terms such as "vote for", "elect", "vote against", "defeat") must
 * clearly identify the responsible party.
 *
 * context.data:
 *   expressAdvocacy         — true if the message contains express advocacy language
 *   fundingSourceDisclosed  — true if the funding source is clearly identified
 */
const FEC_EXPRESS_ADVOCACY_DISCLOSURE: ComplianceRule = {
  id: 'FEC_EXPRESS_ADVOCACY_DISCLOSURE',
  regulation: 'fec',
  name: 'Express Advocacy Funding Disclosure',
  description:
    'Communications expressly advocating the election or defeat of a federal candidate must disclose the responsible funding source (52 U.S.C. § 30120(a)(3)).',
  severity: 'critical',
  evaluate(context) {
    const expressAdvocacy = context.data['expressAdvocacy'];
    if (expressAdvocacy !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const disclosed = context.data['fundingSourceDisclosed'] === true;
    if (disclosed) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'FEC-30120A3',
        message: 'Express advocacy communication does not disclose the responsible funding source.',
        severity: this.severity,
        remediation:
          'Include the full name and address of the political committee paying for the communication. For electronic communications, link to a publicly-accessible disclosure page is acceptable.',
      },
    };
  },
};

// ─── §30104(f) — Electioneering Communication Window ─────────────

/**
 * "Electioneering communications" — broadcast/cable/satellite ads referring to
 * a clearly identified federal candidate — are subject to heightened reporting and
 * disclaimer requirements when sent within:
 *   - 30 days before a federal primary election
 *   - 60 days before a federal general election
 *
 * context.data:
 *   electioneeringCommunication — true when the message is an electioneering communication
 *   daysBeforePrimary           — number of days until the next federal primary (if applicable)
 *   daysBeforeGeneral           — number of days until the next federal general election
 *   electioneeringDisclosureFiled — true if FEC disclosure (Form 9) has been filed
 */
const FEC_ELECTIONEERING_WINDOW: ComplianceRule = {
  id: 'FEC_ELECTIONEERING_WINDOW',
  regulation: 'fec',
  name: 'Electioneering Communication Pre-Election Window Disclosure',
  description:
    'Electioneering communications within 30 days of a federal primary or 60 days of a general election require immediate FEC disclosure filing (52 U.S.C. § 30104(f)).',
  severity: 'high',
  evaluate(context) {
    const isElectioneering = context.data['electioneeringCommunication'];
    if (isElectioneering !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const daysBeforePrimary = context.data['daysBeforePrimary'];
    const daysBeforeGeneral = context.data['daysBeforeGeneral'];

    const inPrimaryWindow =
      typeof daysBeforePrimary === 'number' && daysBeforePrimary >= 0 && daysBeforePrimary <= 30;
    const inGeneralWindow =
      typeof daysBeforeGeneral === 'number' && daysBeforeGeneral >= 0 && daysBeforeGeneral <= 60;

    if (!inPrimaryWindow && !inGeneralWindow) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const disclosureFiled = context.data['electioneeringDisclosureFiled'] === true;
    if (disclosureFiled) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const windowDesc = inGeneralWindow
      ? `${String(daysBeforeGeneral)} days before general election`
      : `${String(daysBeforePrimary)} days before primary`;

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'FEC-30104F',
        message: `Electioneering communication sent ${windowDesc} — FEC Form 9 disclosure not yet filed.`,
        severity: this.severity,
        remediation:
          'File FEC Form 9 (Electioneering Communication Disclosure) within 24 hours of making the communication. Report the name/address of the organization, date/amount of the disbursement, and a description of the communication.',
      },
    };
  },
};

// ─── §30121 — Prohibited Sources ─────────────────────────────────

/**
 * Federal law prohibits soliciting, accepting, or receiving contributions from:
 *   - Foreign nationals (non-citizens, non-permanent residents)
 *   - Federal government contractors during the performance of a contract
 *
 * context.data:
 *   contributionSolicitation — true when the message solicits a political contribution
 *   recipientIsForignNational — true if the communication targets a foreign national
 *   recipientIsFederalContractor — true if the recipient is a federal contractor
 */
const FEC_PROHIBITED_SOURCES: ComplianceRule = {
  id: 'FEC_PROHIBITED_SOURCES',
  regulation: 'fec',
  name: 'Contribution Solicitation from Prohibited Sources',
  description:
    'Political contribution solicitations must not target foreign nationals or federal contractors during the performance of a federal contract (52 U.S.C. § 30121).',
  severity: 'critical',
  evaluate(context) {
    const isSolicitation = context.data['contributionSolicitation'];
    if (isSolicitation !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const foreignNational = context.data['recipientIsForeignNational'] === true;
    const federalContractor = context.data['recipientIsFederalContractor'] === true;

    if (!foreignNational && !federalContractor) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const sources: string[] = [];
    if (foreignNational) sources.push('foreign national');
    if (federalContractor) sources.push('federal contractor');

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'FEC-30121',
        message: `Political contribution solicitation targeted at prohibited source(s): ${sources.join(', ')}.`,
        severity: this.severity,
        remediation:
          'Remove foreign nationals and active federal contractors from all political contribution solicitation lists. Implement nationality and contractor status screening before sending any fundraising communications.',
      },
    };
  },
};

// ─── 11 CFR 110.11(a)(1) — Internet Disclaimer ───────────────────

/**
 * Internet-based political communications (email, text, social) that are
 * "public communications" require a disclaimer. For texts/email, the disclaimer
 * must appear in the communication itself (abbreviated form is permitted for
 * communications of 200 characters or fewer).
 *
 * context.data:
 *   internetPoliticalCommunication — true for internet-based political messages
 *   disclaimerPresent              — true if disclaimer is included
 *   characterCount                 — number of characters in the message
 *   abbreviatedDisclaimerPresent   — true if abbreviated "Pd for by [abbrev]" is included
 */
const FEC_INTERNET_DISCLAIMER: ComplianceRule = {
  id: 'FEC_INTERNET_DISCLAIMER',
  regulation: 'fec',
  name: 'Internet Political Communication Disclaimer',
  description:
    'Internet-based federal political communications must include a disclaimer. Abbreviated disclaimers are permitted for messages of 200 characters or fewer (11 CFR 110.11(a)(1)).',
  severity: 'high',
  evaluate(context) {
    const isInternet = context.data['internetPoliticalCommunication'];
    if (isInternet !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const fullDisclaimer = context.data['disclaimerPresent'] === true;
    if (fullDisclaimer) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    // Short messages may use abbreviated disclaimer
    const charCount = context.data['characterCount'];
    const abbreviated = context.data['abbreviatedDisclaimerPresent'] === true;
    if (typeof charCount === 'number' && charCount <= 200 && abbreviated) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'FEC-11CFR110.11A1',
        message: 'Internet-based political communication missing required disclaimer.',
        severity: this.severity,
        remediation:
          'Add "Paid for by [Committee Name]" to the message. For messages under 200 characters, an abbreviated form ("Pd for by [Abbrev]") is permitted. Link to a full disclosure page when space is limited.',
      },
    };
  },
};

// ─── §30116(a)(7) — Coordinated Expenditure Limit ────────────────

/**
 * Political party committees may make coordinated expenditures with
 * candidates, but only up to inflation-adjusted limits per election.
 * Exceeding limits transforms the expenditure into an in-kind contribution.
 *
 * context.data:
 *   coordinatedExpenditure     — true when the communication is a coordinated party expenditure
 *   coordinatedSpendThisCycle  — total coordinated expenditure for this candidate/cycle (USD)
 *   coordinatedExpenditureLimit — the applicable limit for this office/election cycle (USD)
 */
const FEC_COORDINATED_EXPENDITURE_LIMIT: ComplianceRule = {
  id: 'FEC_COORDINATED_EXPENDITURE_LIMIT',
  regulation: 'fec',
  name: 'Coordinated Expenditure Limit',
  description:
    'Political party committees making coordinated expenditures on behalf of federal candidates must not exceed the per-election limit. Excess amounts are treated as in-kind contributions (52 U.S.C. § 30116(a)(7)).',
  severity: 'high',
  evaluate(context) {
    const isCoordinated = context.data['coordinatedExpenditure'];
    if (isCoordinated !== true) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const spent = context.data['coordinatedSpendThisCycle'];
    const limit = context.data['coordinatedExpenditureLimit'];

    if (typeof spent !== 'number' || typeof limit !== 'number') {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    if (spent <= limit) {
      return { ruleId: this.id, regulation: this.regulation, passed: true };
    }

    const excess = spent - limit;
    return {
      ruleId: this.id,
      regulation: this.regulation,
      passed: false,
      violation: {
        code: 'FEC-30116A7',
        message: `Coordinated expenditure of $${spent.toFixed(2)} exceeds the $${limit.toFixed(2)} limit by $${excess.toFixed(2)}.`,
        severity: this.severity,
        remediation:
          'Halt coordinated expenditure activity for this candidate/cycle. The excess amount must be reported as an in-kind contribution subject to contribution limits. Consult FEC guidance on reclassification.',
      },
    };
  },
};

// ─── Rule Array ──────────────────────────────────────────────────

export const FEC_RULES: ReadonlyArray<ComplianceRule> = [
  FEC_DISCLAIMER_REQUIRED,
  FEC_EXPRESS_ADVOCACY_DISCLOSURE,
  FEC_ELECTIONEERING_WINDOW,
  FEC_PROHIBITED_SOURCES,
  FEC_INTERNET_DISCLAIMER,
  FEC_COORDINATED_EXPENDITURE_LIMIT,
];
