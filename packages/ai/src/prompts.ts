/**
 * Prompt template management — version-controlled templates for ORDR-Connect
 *
 * COMPLIANCE:
 * - Every template includes compliance guardrails in system prompts.
 * - Collections templates include Mini-Miranda disclosure (FDCPA).
 * - Templates NEVER contain real PII — only variable placeholders.
 * - Template rendering validates all required variables are provided.
 */

import {
  type Result,
  ok,
  err,
  ValidationError,
} from '@ordr/core';
import type { PromptTemplate } from './types.js';

// ─── Compliance System Prompt Blocks ─────────────────────────────

export const COMPLIANCE_BLOCKS = {
  /**
   * Base compliance block — included in ALL agent system prompts.
   */
  BASE: [
    'You are an AI assistant operating within a HIPAA, SOC2, and ISO 27001 compliant environment.',
    'RULES YOU MUST FOLLOW:',
    '- NEVER fabricate information. If you do not know, say so.',
    '- NEVER share customer data with unauthorized parties.',
    '- NEVER store or reference PII outside of the authorized context.',
    '- Log all actions through proper audit channels.',
    '- If confidence is below threshold, escalate to a human operator.',
  ].join('\n'),

  /**
   * FDCPA compliance — required for ALL collections-related templates.
   * Mini-Miranda disclosure: 15 USC 1692e(11).
   */
  FDCPA: [
    'FDCPA COMPLIANCE (MANDATORY):',
    '- You MUST include the Mini-Miranda disclosure in the first communication:',
    '  "This is an attempt to collect a debt. Any information obtained will be used for that purpose."',
    '- NEVER threaten arrest, imprisonment, or seizure of property unless legally applicable.',
    '- NEVER use obscene or profane language.',
    '- NEVER misrepresent the amount of the debt.',
    '- NEVER contact before 8:00 AM or after 9:00 PM in the debtor\'s time zone.',
    '- Respect cease-and-desist requests immediately.',
    '- Identify yourself and the creditor in every communication.',
  ].join('\n'),

  /**
   * Customer communication compliance.
   */
  CUSTOMER_COMMUNICATION: [
    'COMMUNICATION RULES:',
    '- Be professional, empathetic, and respectful at all times.',
    '- NEVER disclose that you are an AI in a way that evades regulatory requirements.',
    '- Provide accurate information only — do not speculate.',
    '- If the customer requests to speak with a human, escalate immediately.',
    '- Record the outcome of every interaction for audit purposes.',
  ].join('\n'),
} as const;

// ─── Built-in Collections Agent Templates ────────────────────────

export const BUILT_IN_TEMPLATES: readonly PromptTemplate[] = [
  {
    id: 'collections.payment_reminder',
    name: 'Payment Reminder',
    version: 1,
    systemPrompt: [COMPLIANCE_BLOCKS.BASE, COMPLIANCE_BLOCKS.FDCPA, COMPLIANCE_BLOCKS.CUSTOMER_COMMUNICATION].join('\n\n'),
    userTemplate: [
      'Generate a professional payment reminder for the following account:',
      '',
      'Customer Name: {{customer_name}}',
      'Account Number: {{account_number}}',
      'Amount Due: {{amount_due}}',
      'Due Date: {{due_date}}',
      'Days Past Due: {{days_past_due}}',
      '',
      'Include the Mini-Miranda disclosure. Tone should be firm but empathetic.',
      'Offer assistance if the customer is experiencing financial hardship.',
    ].join('\n'),
    variables: ['customer_name', 'account_number', 'amount_due', 'due_date', 'days_past_due'],
  },
  {
    id: 'collections.negotiation',
    name: 'Payment Negotiation',
    version: 1,
    systemPrompt: [COMPLIANCE_BLOCKS.BASE, COMPLIANCE_BLOCKS.FDCPA, COMPLIANCE_BLOCKS.CUSTOMER_COMMUNICATION].join('\n\n'),
    userTemplate: [
      'Assist with payment negotiation for the following account:',
      '',
      'Customer Name: {{customer_name}}',
      'Total Owed: {{total_owed}}',
      'Customer Offer: {{customer_offer}}',
      'Minimum Acceptable: {{minimum_acceptable}}',
      'Account History: {{account_history}}',
      '',
      'Evaluate the customer\'s offer against the minimum acceptable amount.',
      'If the offer is below minimum, suggest a counter-offer.',
      'If the offer is acceptable, prepare a settlement agreement summary.',
      'Always maintain a professional and solution-oriented tone.',
    ].join('\n'),
    variables: ['customer_name', 'total_owed', 'customer_offer', 'minimum_acceptable', 'account_history'],
  },
  {
    id: 'collections.payment_plan',
    name: 'Payment Plan Proposal',
    version: 1,
    systemPrompt: [COMPLIANCE_BLOCKS.BASE, COMPLIANCE_BLOCKS.FDCPA, COMPLIANCE_BLOCKS.CUSTOMER_COMMUNICATION].join('\n\n'),
    userTemplate: [
      'Create a payment plan proposal for:',
      '',
      'Customer Name: {{customer_name}}',
      'Total Amount: {{total_amount}}',
      'Preferred Monthly Payment: {{preferred_monthly}}',
      'Maximum Term (months): {{max_term_months}}',
      'Interest Rate: {{interest_rate}}',
      '',
      'Generate a structured payment plan with:',
      '- Monthly payment amount',
      '- Number of installments',
      '- Total cost including any interest',
      '- Payment schedule start date',
      'Ensure the plan is realistic and compliant with applicable regulations.',
    ].join('\n'),
    variables: ['customer_name', 'total_amount', 'preferred_monthly', 'max_term_months', 'interest_rate'],
  },
  {
    id: 'collections.escalation_summary',
    name: 'Escalation Summary',
    version: 1,
    systemPrompt: [COMPLIANCE_BLOCKS.BASE, COMPLIANCE_BLOCKS.CUSTOMER_COMMUNICATION].join('\n\n'),
    userTemplate: [
      'Prepare an escalation summary for a human supervisor:',
      '',
      'Customer Name: {{customer_name}}',
      'Account Number: {{account_number}}',
      'Escalation Reason: {{escalation_reason}}',
      'Interaction History: {{interaction_history}}',
      'Agent Confidence Score: {{confidence_score}}',
      '',
      'Summarize the situation concisely for a human reviewer.',
      'Include recommended next steps and any compliance concerns.',
      'Flag any potential FDCPA or regulatory issues encountered.',
    ].join('\n'),
    variables: ['customer_name', 'account_number', 'escalation_reason', 'interaction_history', 'confidence_score'],
  },
] as const;

// ─── Prompt Registry ─────────────────────────────────────────────

/**
 * Registry for managing prompt templates with version control.
 *
 * Templates are registered by ID and can be rendered with variable substitution.
 * All built-in templates are pre-registered on construction.
 */
export class PromptRegistry {
  private readonly templates: Map<string, PromptTemplate>;

  constructor() {
    this.templates = new Map();
    // Register all built-in templates
    for (const template of BUILT_IN_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  /**
   * Register a new template or overwrite an existing one.
   * Returns the previous template if one existed with the same ID.
   */
  register(template: PromptTemplate): PromptTemplate | undefined {
    const previous = this.templates.get(template.id);
    this.templates.set(template.id, template);
    return previous;
  }

  /**
   * Retrieve a template by ID.
   */
  get(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * List all registered template IDs.
   */
  list(): readonly string[] {
    return [...this.templates.keys()];
  }

  /**
   * Check if a template is registered.
   */
  has(id: string): boolean {
    return this.templates.has(id);
  }

  /**
   * Returns total number of registered templates.
   */
  get size(): number {
    return this.templates.size;
  }

  /**
   * Render a template by substituting variables into the user template.
   *
   * SECURITY: Validates all required variables are provided.
   * Returns Result to prevent silent failures.
   *
   * Variables use {{variable_name}} syntax — double-brace to avoid
   * confusion with single-brace object literals.
   */
  render(
    id: string,
    variables: Readonly<Record<string, string>>,
  ): Result<{ readonly systemPrompt: string; readonly userPrompt: string }, ValidationError> {
    const template = this.templates.get(id);
    if (!template) {
      return err(new ValidationError(`Template '${id}' not found`, { id: ['Template not found'] }));
    }

    // Validate all required variables are present
    const missing: string[] = [];
    for (const varName of template.variables) {
      if (!(varName in variables)) {
        missing.push(varName);
      }
    }

    if (missing.length > 0) {
      return err(
        new ValidationError(
          `Missing required variables: ${missing.join(', ')}`,
          { variables: missing.map((v) => `Missing required variable: ${v}`) },
        ),
      );
    }

    // Substitute variables in user template
    let userPrompt = template.userTemplate;
    for (const [key, value] of Object.entries(variables)) {
      userPrompt = userPrompt.replaceAll(`{{${key}}}`, value);
    }

    return ok({
      systemPrompt: template.systemPrompt,
      userPrompt,
    });
  }
}
