/**
 * Agent system prompts — compliance-first prompt construction
 *
 * SECURITY (CLAUDE.md Rules 6, 9):
 * - System prompts NEVER contain real customer PII/PHI
 * - All prompts include compliance guardrails (FDCPA, TCPA, HIPAA)
 * - Tool usage format is structured JSON for deterministic parsing
 * - Confidence threshold rule is embedded in every prompt
 * - Mini-Miranda disclosure requirement is mandatory for collections
 *
 * COMPLIANCE:
 * - Contact timing restrictions (8AM-9PM local time)
 * - Cease communication respect
 * - TCPA consent verification
 * - FDCPA 7-in-7 frequency rule acknowledgment
 */

import type { LLMMessage } from '@ordr/ai';
import { COMPLIANCE_BLOCKS } from '@ordr/ai';
import type { AgentContext, AgentTool } from './types.js';
import { CONFIDENCE_THRESHOLD } from './types.js';
import type { AgentMemory } from './memory.js';

// ─── Prompt Blocks ──────────────────────────────────────────────

/**
 * Tool format instructions for structured JSON output.
 * The agent MUST respond in this format for all actions.
 */
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
  'When you want to report an observation or final outcome, respond with:',
  '{',
  '  "action": "respond",',
  '  "parameters": { "message": "<your response>" },',
  '  "reasoning": "<why this is the appropriate response>",',
  '  "confidence": <0.0 to 1.0>,',
  '  "requiresApproval": false',
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

/**
 * Confidence threshold enforcement block.
 */
const CONFIDENCE_BLOCK = [
  'CONFIDENCE RULES (MANDATORY):',
  `- If your confidence is below ${String(CONFIDENCE_THRESHOLD)}, you MUST set "requiresApproval": true`,
  `- Actions with confidence >= ${String(CONFIDENCE_THRESHOLD)} may auto-execute`,
  '- For financial actions (payments, settlements), ALWAYS set "requiresApproval": true',
  '- If you are uncertain about any customer data, set "requiresApproval": true',
  '- Never fabricate confidence scores — be honest about uncertainty',
] as const;

/**
 * Agent safety and boundary enforcement block.
 */
const SAFETY_BLOCK = [
  'SAFETY BOUNDARIES (NON-NEGOTIABLE):',
  '- You can ONLY use the tools listed below. No other actions are available.',
  '- You CANNOT access data outside the current tenant scope.',
  '- You CANNOT modify your own permissions or tool access.',
  '- You MUST respect budget limits — if instructed to stop, stop immediately.',
  '- You MUST NOT log, repeat, or expose customer PII/PHI in your reasoning.',
  '- If a customer requests to speak with a human, escalate immediately.',
  '- If a customer sends a cease-and-desist, stop all communication immediately.',
] as const;

/**
 * FDCPA-specific compliance block for collections agents.
 */
const FDCPA_AGENT_BLOCK = [
  'FDCPA COMPLIANCE (MANDATORY FOR COLLECTIONS):',
  '- Include Mini-Miranda disclosure in first communication:',
  '  "This is an attempt to collect a debt. Any information obtained will be used for that purpose."',
  '- NEVER contact before 8:00 AM or after 9:00 PM in the debtor\'s time zone.',
  '- Maximum 7 contact attempts per debt per 7-day rolling period.',
  '- Respect cease-and-desist requests immediately — no further contact.',
  '- NEVER threaten arrest, imprisonment, or seizure of property.',
  '- NEVER use obscene or profane language.',
  '- NEVER misrepresent the amount of the debt.',
  '- Identify yourself and the creditor in every communication.',
  '- If the debtor disputes the debt, note it and cease collection until verified.',
] as const;

/**
 * TCPA consent block for SMS/voice agents.
 */
const TCPA_BLOCK = [
  'TCPA COMPLIANCE (MANDATORY FOR SMS/VOICE):',
  '- TCPA consent MUST be verified before every outbound SMS or call.',
  '- If consent status is not "opted_in", do NOT send any message.',
  '- Respect opt-out keywords (STOP, UNSUBSCRIBE, CANCEL, etc.) immediately.',
  '- Include opt-out instructions in every SMS communication.',
] as const;

// ─── Collections Prompt Builder ─────────────────────────────────

/**
 * Build the full prompt for a collections agent session.
 *
 * SECURITY: No PHI/PII in system prompt. Customer data flows through
 * tool calls, not prompt construction.
 */
export function buildCollectionsPrompt(
  context: AgentContext,
  memory: AgentMemory,
): LLMMessage[] {
  const toolDescriptions = formatToolDescriptions(context.tools);
  const memorySummary = memory.summarize();
  const conversationHistory = memory.getConversationHistory();

  // ── System prompt: compliance + tools + format ──
  const systemParts: string[] = [
    `You are a ${context.agentRole} agent operating within the ORDR-Connect Customer Operations OS.`,
    `Session ID: ${context.sessionId}`,
    `Autonomy Level: ${context.autonomyLevel}`,
    '',
    COMPLIANCE_BLOCKS.BASE,
    '',
    FDCPA_AGENT_BLOCK.join('\n'),
    '',
    TCPA_BLOCK.join('\n'),
    '',
    SAFETY_BLOCK.join('\n'),
    '',
    CONFIDENCE_BLOCK.join('\n'),
    '',
    'AVAILABLE TOOLS:',
    toolDescriptions,
    '',
    TOOL_FORMAT_BLOCK.join('\n'),
  ];

  const systemPrompt = systemParts.join('\n');

  // ── Build message array ──
  const messages: LLMMessage[] = [];

  // System message
  messages.push({
    role: 'system',
    content: systemPrompt,
  });

  // Include conversation history from previous steps
  for (const msg of conversationHistory) {
    messages.push(msg);
  }

  // Current context message
  if (memorySummary.length > 0) {
    messages.push({
      role: 'user',
      content: `Current session state: ${memorySummary}\n\nProceed with the next action based on the current state.`,
    });
  } else {
    messages.push({
      role: 'user',
      content: `Begin the ${context.agentRole} task for customer ${context.customerId}. Start by looking up the customer information.`,
    });
  }

  return messages;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Format tool descriptions for inclusion in the system prompt.
 * Lists each tool with its name, description, and parameter schema summary.
 */
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

/**
 * Build a generic agent prompt (non-collections).
 * Used for support_triage, lead_qualifier, and other roles.
 */
export function buildGenericPrompt(
  context: AgentContext,
  memory: AgentMemory,
): LLMMessage[] {
  const toolDescriptions = formatToolDescriptions(context.tools);
  const memorySummary = memory.summarize();
  const conversationHistory = memory.getConversationHistory();

  const systemParts: string[] = [
    `You are a ${context.agentRole} agent operating within the ORDR-Connect Customer Operations OS.`,
    `Session ID: ${context.sessionId}`,
    `Autonomy Level: ${context.autonomyLevel}`,
    '',
    COMPLIANCE_BLOCKS.BASE,
    '',
    SAFETY_BLOCK.join('\n'),
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
      content: `Begin the ${context.agentRole} task for customer ${context.customerId}. Start by looking up the customer information.`,
    });
  }

  return messages;
}
