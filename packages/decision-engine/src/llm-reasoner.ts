/**
 * @ordr/decision-engine — Layer 3: LLM Reasoning
 *
 * Contextual reasoning for complex decisions that Rules + ML cannot resolve.
 * Uses @ordr/ai LLMClient with structured JSON output.
 *
 * CRITICAL COMPLIANCE:
 * - PHI is NEVER sent to the LLM — only tokenized IDs, scores, and metadata
 * - All prompts are constructed from non-sensitive context
 * - LLM responses are validated against a strict JSON schema before use
 * - Confidence below 0.5 is rejected (too uncertain even for HITL)
 */

import { z } from 'zod';
import {
  type Result,
  ok,
  err,
  ValidationError,
  InternalError,
} from '@ordr/core';
import type { LLMClient, LLMMessage, ModelTier } from '@ordr/ai';
import type {
  DecisionContext,
  RuleResult,
  MLPrediction,
  Decision,
  ActionType,
  ChannelType,
  DecisionLayer,
} from './types.js';
import { ACTION_TYPES, CHANNEL_TYPES } from './types.js';

// ─── Constants ───────────────────────────────────────────────────

const CONFIDENCE_FLOOR = 0.5 as const;
const HIGH_VALUE_LTV_THRESHOLD = 50_000 as const;
const DEFAULT_MAX_TOKENS = 2048 as const;
const DEFAULT_TEMPERATURE = 0.1 as const;
const DECISION_EXPIRY_MINUTES = 60 as const;

// ─── LLM Response Schema ────────────────────────────────────────

const llmDecisionResponseSchema = z.object({
  action: z.enum(ACTION_TYPES as unknown as [string, ...string[]]),
  channel: z.enum(CHANNEL_TYPES as unknown as [string, ...string[]]).nullable(),
  parameters: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(2000),
});

type LLMDecisionResponse = z.infer<typeof llmDecisionResponseSchema>;

// ─── Prompt Registry Interface ───────────────────────────────────

/** Minimal interface for prompt template lookup. */
export interface PromptRegistryInterface {
  get(id: string): { readonly systemPrompt: string } | undefined;
}

// ─── LLM Reasoner ────────────────────────────────────────────────

export class LLMReasoner {
  private readonly llmClient: LLMClient;
  private readonly promptRegistry: PromptRegistryInterface;

  constructor(llmClient: LLMClient, promptRegistry: PromptRegistryInterface) {
    this.llmClient = llmClient;
    this.promptRegistry = promptRegistry;
  }

  /**
   * Invoke LLM reasoning to produce a decision.
   *
   * 1. Build prompt with context (NO raw PII/PHI)
   * 2. Include rule results and ML scores as context
   * 3. Request structured JSON response
   * 4. Validate response against schema
   * 5. Reject if confidence < 0.5
   *
   * Uses 'standard' tier by default, 'premium' for high-value customers.
   */
  async reason(
    context: DecisionContext,
    ruleResults: readonly RuleResult[],
    mlScores: readonly MLPrediction[],
  ): Promise<Result<Decision, ValidationError | InternalError>> {
    try {
      const messages = this.buildReasoningPrompt(context, ruleResults, mlScores);
      const modelTier = this.selectModelTier(context);

      const systemPromptTemplate = this.promptRegistry.get('decision_engine.reasoning');
      const systemPrompt = systemPromptTemplate?.systemPrompt ?? this.getDefaultSystemPrompt();

      const llmResult = await this.llmClient.complete({
        messages,
        modelTier,
        maxTokens: DEFAULT_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE,
        systemPrompt,
        metadata: {
          tenant_id: context.tenantId,
          correlation_id: context.correlationId,
          agent_id: 'decision-engine',
        },
      });

      if (!llmResult.success) {
        return err(new InternalError(
          `LLM reasoning failed: ${llmResult.error.message}`,
          context.correlationId,
        ));
      }

      // Parse and validate response
      const parsed = this.parseResponse(llmResult.data.content);
      if (!parsed.success) {
        return err(parsed.error);
      }

      const response = parsed.data;

      // Enforce confidence floor
      if (response.confidence < CONFIDENCE_FLOOR) {
        return err(new ValidationError(
          `LLM confidence ${String(response.confidence)} is below minimum threshold ${String(CONFIDENCE_FLOOR)}`,
          { confidence: [`Score ${String(response.confidence)} is below ${String(CONFIDENCE_FLOOR)}`] },
          context.correlationId,
        ));
      }

      // Build Decision
      const now = new Date();
      const expiresAt = new Date(now.getTime() + DECISION_EXPIRY_MINUTES * 60 * 1000);

      const layersUsed: DecisionLayer[] = ['rules', 'ml', 'llm'];

      const decision: Decision = {
        id: context.correlationId,
        tenantId: context.tenantId,
        customerId: context.customerId,
        action: response.action as ActionType,
        channel: (response.channel ?? undefined) as ChannelType | undefined,
        parameters: response.parameters as Record<string, unknown>,
        score: response.confidence,
        confidence: response.confidence,
        reasoning: response.reasoning,
        layersUsed,
        candidates: [],
        evaluatedAt: now,
        expiresAt,
      };

      return ok(decision);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown LLM reasoning error';
      return err(new InternalError(
        `LLM reasoning failed: ${message}`,
        context.correlationId,
      ));
    }
  }

  /**
   * Build the reasoning prompt from context, rule results, and ML scores.
   *
   * CRITICAL: NO PHI in any message. Only tokenized customer ID,
   * numeric scores, and categorical metadata.
   */
  buildReasoningPrompt(
    context: DecisionContext,
    ruleResults: readonly RuleResult[],
    mlScores: readonly MLPrediction[],
  ): readonly LLMMessage[] {
    const matchedRules = ruleResults.filter((r) => r.matched);
    const rulesSection = matchedRules.length > 0
      ? matchedRules.map((r) => `  - Rule "${r.ruleName}": score=${String(r.score)}, action=${r.action?.type ?? 'none'}`).join('\n')
      : '  No rules matched.';

    const mlSection = mlScores.length > 0
      ? mlScores.map((s) => `  - Model "${s.modelName}": score=${s.score.toFixed(3)}, confidence=${s.confidence.toFixed(3)}`).join('\n')
      : '  No ML scores available.';

    const blockedChannels = context.constraints.blockedChannels.length > 0
      ? context.constraints.blockedChannels.join(', ')
      : 'none';

    const userMessage = [
      'Determine the Next-Best-Action for this customer interaction.',
      '',
      '## Customer Context (tokenized — no PII)',
      `- Customer ID: ${context.customerId}`,
      `- Event Type: ${context.eventType}`,
      `- Health Score: ${String(context.customerProfile.healthScore)}/100`,
      `- Lifecycle Stage: ${context.customerProfile.lifecycleStage}`,
      `- Segment: ${context.customerProfile.segment}`,
      `- Sentiment Average: ${context.customerProfile.sentimentAvg.toFixed(2)}`,
      `- Response Rate: ${(context.customerProfile.responseRate * 100).toFixed(1)}%`,
      `- Outstanding Balance: ${context.customerProfile.outstandingBalance > 0 ? 'yes' : 'no'}`,
      `- Days Since Last Contact: ${String(context.customerProfile.daysSinceLastContact)}`,
      `- Recent Interactions (30d): ${String(context.customerProfile.totalInteractions30d)}`,
      `- LTV Tier: ${context.customerProfile.ltv > HIGH_VALUE_LTV_THRESHOLD ? 'high' : 'standard'}`,
      '',
      '## Constraints',
      `- Budget: ${context.constraints.budgetCents !== undefined ? `${String(context.constraints.budgetCents)} cents` : 'unlimited'}`,
      `- Blocked Channels: ${blockedChannels}`,
      `- Max Contacts/Week: ${String(context.constraints.maxContactsPerWeek)}`,
      '',
      '## Rules Engine Results (Layer 1)',
      rulesSection,
      '',
      '## ML Scores (Layer 2)',
      mlSection,
      '',
      '## Instructions',
      'Respond with a JSON object containing:',
      '- "action": one of [send_sms, send_email, send_voice, route_to_agent, escalate_to_human, offer_payment_plan, cease_communication, schedule_callback, trigger_workflow, no_action]',
      '- "channel": one of [sms, email, voice, chat, in_app] or null',
      '- "parameters": object with action-specific parameters',
      '- "confidence": number 0.0-1.0 representing your confidence',
      '- "reasoning": explanation of your recommendation (max 2000 chars)',
      '',
      'IMPORTANT: Only output valid JSON. No markdown, no explanation outside the JSON.',
    ].join('\n');

    return [
      { role: 'user' as const, content: userMessage },
    ];
  }

  /**
   * Select model tier based on customer value.
   * High-LTV customers get premium (Opus), others get standard (Sonnet).
   */
  private selectModelTier(context: DecisionContext): ModelTier {
    if (context.customerProfile.ltv > HIGH_VALUE_LTV_THRESHOLD) {
      return 'premium';
    }
    return 'standard';
  }

  /**
   * Parse and validate the LLM response against the expected schema.
   */
  private parseResponse(
    content: string,
  ): Result<LLMDecisionResponse, ValidationError> {
    // Extract JSON from response (handles markdown code blocks)
    const jsonStr = this.extractJson(content);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return err(new ValidationError(
        'LLM response is not valid JSON',
        { content: ['Failed to parse JSON from LLM response'] },
      ));
    }

    const validation = llmDecisionResponseSchema.safeParse(parsed);
    if (!validation.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of validation.error.issues) {
        const path = issue.path.join('.');
        const key = path || '_root';
        if (fieldErrors[key] === undefined) {
          fieldErrors[key] = [];
        }
        fieldErrors[key].push(issue.message);
      }
      return err(new ValidationError('LLM response failed schema validation', fieldErrors));
    }

    return ok(validation.data);
  }

  /**
   * Extract JSON from LLM response, handling markdown code blocks.
   */
  private extractJson(content: string): string {
    const trimmed = content.trim();

    // Try to extract from markdown code block
    const codeBlockMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/u.exec(trimmed);
    if (codeBlockMatch?.[1] !== undefined) {
      return codeBlockMatch[1].trim();
    }

    // If it starts with { assume raw JSON
    if (trimmed.startsWith('{')) {
      return trimmed;
    }

    // Last resort: find first { to last }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1);
    }

    return trimmed;
  }

  /**
   * Default system prompt for decision reasoning.
   */
  private getDefaultSystemPrompt(): string {
    return [
      'You are the ORDR-Connect Decision Engine — an AI system that determines the Next-Best-Action for customer interactions.',
      '',
      'RULES:',
      '- NEVER fabricate data. Use only the provided context.',
      '- NEVER include PII or PHI in your response.',
      '- Respond ONLY with valid JSON matching the required schema.',
      '- Your confidence score MUST accurately reflect your certainty.',
      '- If you are unsure, set confidence below 0.5 to trigger human review.',
      '- Consider compliance requirements (FDCPA, TCPA, HIPAA) in your reasoning.',
      '- Respect blocked channels and contact frequency constraints.',
      '- Prioritize customer experience and regulatory compliance over revenue.',
    ].join('\n');
  }
}
