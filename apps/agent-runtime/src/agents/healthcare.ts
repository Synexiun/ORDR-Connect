/**
 * Healthcare agent — HIPAA-compliant prompt builder and configuration
 *
 * SECURITY (CLAUDE.md Rules 1, 2, 6, 9):
 * - System prompt NEVER contains raw PHI — only tokenized references
 * - Confidence threshold elevated to 0.8 for PHI sensitivity
 * - HITL mandatory for: PHI access, care plan modifications, prescription actions
 * - All patient data referenced via tokens, never raw identifiers
 * - Agent CANNOT modify its own permissions or access scope
 *
 * COMPLIANCE:
 * - HIPAA §164.502(a) — uses/disclosures of PHI only as permitted
 * - HIPAA §164.502(b) — minimum necessary standard
 * - HIPAA §164.312(b) — audit controls
 * - HIPAA §164.312(a)(2)(iv) — encryption requirement
 * - SOC2 CC6.1 — logical access controls
 * - ISO 27001 A.9.4 — system access control
 */

import type { LLMMessage } from '@ordr/ai';
import { COMPLIANCE_BLOCKS } from '@ordr/ai';
import type { AgentContext, AgentTool } from '../types.js';
import type { AgentMemory } from '../memory.js';

// ─── Constants ──────────────────────────────────────────────────

/**
 * Healthcare confidence threshold — elevated above the default 0.7
 * due to PHI sensitivity. Actions below this MUST go to HITL queue.
 */
export const HEALTHCARE_CONFIDENCE_THRESHOLD = 0.8 as const;

/**
 * Actions that ALWAYS require human-in-the-loop approval,
 * regardless of confidence score.
 */
export const HITL_REQUIRED_ACTIONS: readonly string[] = [
  'lookup_patient',
  'check_care_plan',
  'modify_care_plan',
  'prescription_action',
  'send_health_reminder',
] as const;

// ─── Prompt Blocks ──────────────────────────────────────────────

const HEALTHCARE_SAFETY_BLOCK = [
  'SAFETY BOUNDARIES (NON-NEGOTIABLE):',
  '- You can ONLY use the tools listed below. No other actions are available.',
  '- You CANNOT access data outside the current tenant scope.',
  '- You CANNOT modify your own permissions or tool access.',
  '- You MUST respect budget limits — if instructed to stop, stop immediately.',
  '- You MUST NOT log, repeat, or expose patient PHI in your reasoning.',
  '- NEVER include patient names, SSNs, dates of birth, or medical details in your output.',
  '- NEVER share one patient\'s data with another patient, provider, or agent.',
  '- If a patient requests to speak with a human, escalate immediately.',
  '- All patient references MUST use tokenized IDs only — never raw identifiers.',
] as const;

const HEALTHCARE_HIPAA_BLOCK = [
  'HIPAA COMPLIANCE (MANDATORY — 45 CFR Part 164):',
  '- Minimum Necessary Standard: Request ONLY the PHI fields needed for the current task.',
  '- All PHI access is audit-logged and immutable — your actions are permanently recorded.',
  '- NEVER include PHI in error messages, logs, or reasoning chains.',
  '- NEVER transmit PHI without encryption verification.',
  '- Patient data MUST be referenced by token only — never include raw PHI.',
  '- If you suspect a data breach or unauthorized access, escalate immediately.',
  '- Business Associate Agreements must be verified before sharing data externally.',
  '- Disclosure accounting: every PHI disclosure is tracked for 6 years.',
] as const;

const HEALTHCARE_DECISION_FRAMEWORK = [
  'DECISION FRAMEWORK:',
  '1. IDENTIFY: Determine the task type (appointment, follow-up, care coordination, reminder).',
  '2. VERIFY: Confirm patient identity via tokenized reference — never ask for raw PHI.',
  '3. ASSESS: Check patient care plan status, appointment history, and consent records.',
  '4. ACT: Execute the appropriate tool with minimum necessary data.',
  '5. CONFIRM: Verify the action result and provide confirmation via safe channel.',
  '6. DOCUMENT: Ensure audit trail is complete before concluding.',
] as const;

const HEALTHCARE_TOOL_FORMAT_BLOCK = [
  'RESPONSE FORMAT:',
  'When you decide to take an action, respond with ONLY a JSON object:',
  '{',
  '  "action": "<tool_name>",',
  '  "parameters": { ... },',
  '  "reasoning": "<your reasoning for this action — NO PHI in reasoning>",',
  '  "confidence": <0.0 to 1.0>,',
  '  "requiresApproval": <true if confidence < 0.8 OR action involves PHI>',
  '}',
  '',
  'When the task is complete, respond with:',
  '{',
  '  "action": "complete",',
  '  "parameters": { "summary": "<session outcome — NO PHI in summary>" },',
  '  "reasoning": "<why the task is complete>",',
  '  "confidence": <0.0 to 1.0>,',
  '  "requiresApproval": false',
  '}',
] as const;

const HEALTHCARE_CONFIDENCE_BLOCK = [
  'CONFIDENCE RULES (MANDATORY — ELEVATED FOR HEALTHCARE):',
  `- Healthcare confidence threshold is ${String(HEALTHCARE_CONFIDENCE_THRESHOLD)} (higher than standard agents).`,
  `- If your confidence is below ${String(HEALTHCARE_CONFIDENCE_THRESHOLD)}, you MUST set "requiresApproval": true.`,
  '- PHI access actions ALWAYS require approval regardless of confidence.',
  '- Care plan modifications ALWAYS require approval regardless of confidence.',
  '- Prescription-related actions ALWAYS require approval regardless of confidence.',
  '- Never fabricate confidence scores — be honest about uncertainty.',
  '- When in doubt, escalate to a human healthcare professional.',
] as const;

// ─── Healthcare Prompt Builder ──────────────────────────────────

/**
 * Build the full prompt for a healthcare agent session.
 *
 * SECURITY: No PHI in system prompt. Patient data flows through
 * tool calls only, using tokenized references. The prompt itself
 * contains ZERO patient-identifiable information.
 */
export function buildHealthcarePrompt(
  context: AgentContext,
  memory: AgentMemory,
): LLMMessage[] {
  const toolDescriptions = formatToolDescriptions(context.tools);
  const memorySummary = memory.summarize();
  const conversationHistory = memory.getConversationHistory();

  const systemParts: string[] = [
    'You are a HIPAA-compliant healthcare operations agent within the ORDR-Connect Customer Operations OS.',
    `Session ID: ${context.sessionId}`,
    `Autonomy Level: ${context.autonomyLevel}`,
    '',
    'Your role is to manage healthcare operations including appointment scheduling, patient follow-up,',
    'care coordination, and prescription reminders — all while maintaining strict HIPAA compliance.',
    '',
    COMPLIANCE_BLOCKS.BASE,
    '',
    HEALTHCARE_SAFETY_BLOCK.join('\n'),
    '',
    HEALTHCARE_HIPAA_BLOCK.join('\n'),
    '',
    HEALTHCARE_DECISION_FRAMEWORK.join('\n'),
    '',
    HEALTHCARE_CONFIDENCE_BLOCK.join('\n'),
    '',
    'AVAILABLE TOOLS:',
    toolDescriptions,
    '',
    HEALTHCARE_TOOL_FORMAT_BLOCK.join('\n'),
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

  if (memory.stepCount > 0) {
    messages.push({
      role: 'user',
      content: `Current session state: ${memorySummary}\n\nProceed with the next action based on the current state.`,
    });
  } else {
    messages.push({
      role: 'user',
      content: `Begin the healthcare task for patient token ${context.customerId}. Verify patient context and proceed with the appropriate action.`,
    });
  }

  return messages;
}

/**
 * Determine if a given action requires human-in-the-loop approval
 * in the healthcare context.
 */
export function requiresHealthcareHitl(action: string, confidence: number): boolean {
  if (HITL_REQUIRED_ACTIONS.includes(action)) {
    return true;
  }
  return confidence < HEALTHCARE_CONFIDENCE_THRESHOLD;
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
