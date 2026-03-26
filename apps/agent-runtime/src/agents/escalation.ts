/**
 * Escalation agent — prompt builder and configuration
 *
 * SECURITY (CLAUDE.md Rules 6, 9):
 * - Preserves full context chain for human review
 * - Conversation summary MUST NOT contain raw PII/PHI
 * - All escalation decisions are audit-logged
 * - Severity assessment drives incident classification
 *
 * COMPLIANCE:
 * - HIPAA §164.308(a)(6) — incident response procedures
 * - SOC2 CC7.3 — communication of security events
 * - ISO 27001 A.16.1 — information security incident management
 */

import type { LLMMessage } from '@ordr/ai';
import { COMPLIANCE_BLOCKS } from '@ordr/ai';
import type { AgentContext, AgentTool } from '../types.js';
import { CONFIDENCE_THRESHOLD } from '../types.js';
import type { AgentMemory } from '../memory.js';

// ─── Prompt Blocks ──────────────────────────────────────────────

const ESCALATION_SAFETY_BLOCK = [
  'SAFETY BOUNDARIES (NON-NEGOTIABLE):',
  '- You can ONLY use the tools listed below. No other actions are available.',
  '- You CANNOT access data outside the current tenant scope.',
  '- You CANNOT modify your own permissions or tool access.',
  '- You MUST respect budget limits — if instructed to stop, stop immediately.',
  '- You MUST NOT log, repeat, or expose customer PII/PHI in your reasoning.',
  '- Your summaries MUST use tokenized references — NEVER raw customer data.',
  '- When creating tickets, include operational context only — no PHI.',
] as const;

const ESCALATION_DECISION_FRAMEWORK = [
  'DECISION FRAMEWORK:',
  '1. ASSESS SEVERITY:',
  '   - Critical: Data breach, system outage, legal threat, active harm',
  '   - High: Customer complaint, SLA breach, compliance concern',
  '   - Medium: Complex issue requiring specialist, multiple failed attempts',
  '   - Low: Standard handoff, customer preference for human',
  '2. SUMMARIZE CONTEXT:',
  '   - Create a concise summary of the conversation and previous actions.',
  '   - Include key decisions made, tools used, and outcomes.',
  '   - List unresolved issues that need human attention.',
  '   - NEVER include raw PII/PHI — use tokenized references.',
  '3. CREATE TICKET:',
  '   - Create an escalation ticket with severity, summary, and routing info.',
  '   - Assign to the appropriate human team based on severity and category.',
  '4. NOTIFY:',
  '   - Ensure the human agent has full context to continue without re-asking.',
  '   - Mark the session as escalated.',
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
  'When the escalation is complete, respond with:',
  '{',
  '  "action": "escalate",',
  '  "parameters": { "summary": "<escalation outcome>" },',
  '  "reasoning": "<why escalation is the correct action>",',
  '  "confidence": <0.0 to 1.0>,',
  '  "requiresApproval": false',
  '}',
] as const;

const CONFIDENCE_BLOCK = [
  'CONFIDENCE RULES (MANDATORY):',
  `- If your confidence is below ${String(CONFIDENCE_THRESHOLD)}, you MUST set "requiresApproval": true`,
  `- Actions with confidence >= ${String(CONFIDENCE_THRESHOLD)} may auto-execute`,
  '- Severity assessment should always be high-confidence — if uncertain, default to higher severity',
  '- Human escalation is ALWAYS the safe fallback — when in doubt, escalate',
  '- Never fabricate confidence scores — be honest about uncertainty',
] as const;

// ─── Escalation Prompt Builder ──────────────────────────────────

/**
 * Build the full prompt for an escalation agent session.
 *
 * SECURITY: No PHI/PII in system prompt. Customer data flows
 * through tool calls. Summaries use tokenized references only.
 */
export function buildEscalationPrompt(
  context: AgentContext,
  memory: AgentMemory,
): LLMMessage[] {
  const toolDescriptions = formatToolDescriptions(context.tools);
  const memorySummary = memory.summarize();
  const conversationHistory = memory.getConversationHistory();

  const systemParts: string[] = [
    'You are an escalation coordinator operating within the ORDR-Connect Customer Operations OS.',
    `Session ID: ${context.sessionId}`,
    `Autonomy Level: ${context.autonomyLevel}`,
    '',
    'Your role is to assess escalation severity, summarize conversation context for human reviewers,',
    'create tickets, and ensure smooth handoff to human agents with full audit trail.',
    '',
    COMPLIANCE_BLOCKS.BASE,
    '',
    ESCALATION_SAFETY_BLOCK.join('\n'),
    '',
    ESCALATION_DECISION_FRAMEWORK.join('\n'),
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
      content: `Current session state: ${memorySummary}\n\nThis is an escalation session. Assess severity, summarize context, and coordinate handoff to human support.`,
    });
  } else {
    messages.push({
      role: 'user',
      content: `Begin escalation coordination for customer ${context.customerId}. Assess the situation, summarize the conversation context, and prepare for human handoff.`,
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
