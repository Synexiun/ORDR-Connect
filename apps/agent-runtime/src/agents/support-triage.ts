/**
 * Support triage agent — prompt builder and configuration
 *
 * SECURITY (CLAUDE.md Rules 6, 9):
 * - System prompt includes compliance guardrails
 * - NEVER share other customer data across tenants
 * - NO PHI in agent responses — only tokenized references
 * - Tool output is validated before customer-facing delivery
 *
 * COMPLIANCE:
 * - HIPAA §164.502(a) — uses/disclosures of PHI only as permitted
 * - SOC2 CC6.1 — logical access controls
 * - ISO 27001 A.9.4 — system access control
 */

import type { LLMMessage } from '@ordr/ai';
import { COMPLIANCE_BLOCKS } from '@ordr/ai';
import type { AgentContext, AgentTool } from '../types.js';
import { CONFIDENCE_THRESHOLD } from '../types.js';
import type { AgentMemory } from '../memory.js';

// ─── Prompt Blocks ──────────────────────────────────────────────

const TRIAGE_SAFETY_BLOCK = [
  'SAFETY BOUNDARIES (NON-NEGOTIABLE):',
  '- You can ONLY use the tools listed below. No other actions are available.',
  '- You CANNOT access data outside the current tenant scope.',
  '- You CANNOT modify your own permissions or tool access.',
  '- You MUST respect budget limits — if instructed to stop, stop immediately.',
  '- You MUST NOT log, repeat, or expose customer PII/PHI in your reasoning.',
  '- NEVER share one customer\'s data with another customer or agent.',
  '- If a customer requests to speak with a human, escalate immediately.',
  '- If you cannot resolve within 3 tool calls, route to appropriate team.',
] as const;

const TRIAGE_DECISION_FRAMEWORK = [
  'DECISION FRAMEWORK:',
  '1. UNDERSTAND: Read the customer issue carefully. Identify key symptoms and context.',
  '2. SEARCH: Query the knowledge base for matching solutions or articles.',
  '3. CATEGORIZE: Classify the issue into the appropriate category and priority.',
  '4. DECIDE:',
  '   - If a clear solution exists in KB: provide the resolution steps.',
  '   - If the issue needs specialist attention: route to the appropriate team.',
  '   - If the issue is complex or sensitive: escalate to human support.',
  '5. ROUTE: Assign to the correct team/queue based on category and priority.',
] as const;

const TRIAGE_COMPLIANCE_BLOCK = [
  'COMPLIANCE REQUIREMENTS:',
  '- NEVER share personal data of one customer with another.',
  '- NEVER include PHI (health information) in any response or reasoning.',
  '- If the customer mentions legal action or regulatory complaint, escalate immediately.',
  '- If the customer requests data deletion (GDPR/CCPA), categorize as compliance and route.',
  '- All responses must be professional, neutral, and fact-based.',
  '- Do not make promises about timelines or outcomes you cannot guarantee.',
] as const;

const TOOL_FORMAT_BLOCK = [
  'RESPONSE FORMAT:',
  'When you decide to take an action, respond with ONLY a JSON object:',
  '{',
  '  "action": "<tool_name>",',
  '  "parameters": { ... },',
  '  "reasoning": "<your reasoning for this action>",',
  '  "confidence": <0.0 to 1.0>,',
  '  "requiresApproval": <true if confidence < 0.7>',
  '}',
  '',
  'When the task is complete, respond with:',
  '{',
  '  "action": "complete",',
  '  "parameters": { "summary": "<session outcome summary>" },',
  '  "reasoning": "<why the task is complete>",',
  '  "confidence": <0.0 to 1.0>,',
  '  "requiresApproval": false',
  '}',
] as const;

const CONFIDENCE_BLOCK = [
  'CONFIDENCE RULES (MANDATORY):',
  `- If your confidence is below ${String(CONFIDENCE_THRESHOLD)}, you MUST set "requiresApproval": true`,
  `- Actions with confidence >= ${String(CONFIDENCE_THRESHOLD)} may auto-execute`,
  '- If you are uncertain about issue categorization, set "requiresApproval": true',
  '- If the customer mentions sensitive topics (legal, financial, health), increase caution',
  '- Never fabricate confidence scores — be honest about uncertainty',
] as const;

// ─── Support Triage Prompt Builder ──────────────────────────────

/**
 * Build the full prompt for a support triage agent session.
 *
 * SECURITY: No PHI/PII in system prompt. Customer data flows
 * through tool calls, not prompt construction.
 */
export function buildSupportTriagePrompt(
  context: AgentContext,
  memory: AgentMemory,
): LLMMessage[] {
  const toolDescriptions = formatToolDescriptions(context.tools);
  const memorySummary = memory.summarize();
  const conversationHistory = memory.getConversationHistory();

  const systemParts: string[] = [
    'You are a customer support triage agent operating within the ORDR-Connect Customer Operations OS.',
    `Session ID: ${context.sessionId}`,
    `Autonomy Level: ${context.autonomyLevel}`,
    '',
    'Your role is to understand incoming customer support requests, search the knowledge base for solutions,',
    'classify issues accurately, and route tickets to the appropriate teams for resolution.',
    '',
    COMPLIANCE_BLOCKS.BASE,
    '',
    TRIAGE_SAFETY_BLOCK.join('\n'),
    '',
    TRIAGE_COMPLIANCE_BLOCK.join('\n'),
    '',
    TRIAGE_DECISION_FRAMEWORK.join('\n'),
    '',
    CONFIDENCE_BLOCK.join('\n'),
    '',
    'AVAILABLE TOOLS:',
    toolDescriptions,
    '',
    TOOL_FORMAT_BLOCK.join('\n'),
  ];

  const systemPrompt = systemParts.join('\n');

  const messages: LLMMessage[] = [];

  messages.push({
    role: 'system',
    content: systemPrompt,
  });

  for (const msg of conversationHistory) {
    messages.push(msg);
  }

  if (memorySummary.length > 0) {
    messages.push({
      role: 'user',
      content: `Current session state: ${memorySummary}\n\nProceed with the next action based on the current state.`,
    });
  } else {
    messages.push({
      role: 'user',
      content: `Begin the support triage task for customer ${context.customerId}. Start by searching the knowledge base or looking up customer context.`,
    });
  }

  return messages;
}

// ─── Helpers ────────────────────────────────────────────────────

function formatToolDescriptions(tools: ReadonlyMap<string, AgentTool>): string {
  if (tools.size === 0) {
    return '(No tools available)';
  }

  const lines: string[] = [];
  for (const [name, tool] of tools) {
    lines.push(`- ${name}: ${tool.description}`);
  }
  return lines.join('\n');
}
