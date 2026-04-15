/* eslint-disable
   @typescript-eslint/no-unsafe-assignment
   --
   NOTE: These rules are disabled because @ordr/ai has not been compiled to dist/ yet,
   so TypeScript's project service cannot resolve its types. Re-enable once packages
   are built (tracked in build pipeline TODO). All security rules remain active.
*/
/**
 * AI Routes — Sentiment analysis, agent insights, entity routing
 *
 * POST /v1/ai/sentiment   — Batch sentiment analysis (budget tier, haiku)
 * POST /v1/ai/insights    — Agent insight generation (standard tier, sonnet)
 * POST /v1/ai/route       — Entity routing decision (standard tier, sonnet)
 *
 * SOC2 CC6.1 — Access control: tenant-scoped, role-checked.
 * SOC2 CC7.2 — AI monitoring: sentiment anomaly detection.
 * HIPAA §164.312 — No PHI in request/response bodies.
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Agent Safety: all inputs validated before LLM dispatch
 * - No PHI/PII in prompt payloads — callers pass sanitized text tokens
 * - Confidence scores returned for downstream HITL gate decisions
 * - All AI costs tracked and returned for budget enforcement
 * - Budget enforcement: max 50 texts per sentiment batch
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { SentimentAnalyzer, LlmSentimentBackend } from '@ordr/ai';
import type { LLMClient } from '@ordr/ai';
import { ValidationError, AuthorizationError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth, requirePermissionMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { featureGate, FEATURES } from '../middleware/plan-gate.js';
import { jsonErr } from '../lib/http.js';

// ─── Input Schemas ───────────────────────────────────────────────

const sentimentSchema = z.object({
  texts: z.array(z.string().min(1).max(10_000)).min(1).max(50),
});

const insightSchema = z.object({
  /** Tokenized customer reference — NOT the real name or identifier */
  customerId: z.string().uuid(),
  sessionId: z.string().uuid(),
  context: z.enum(['churn_risk', 'upsell', 'support', 'healthcare']),
});

const routeEntitySchema = z.object({
  entityId: z.string().uuid(),
  entityType: z.enum(['customer', 'interaction', 'session']),
  availableRoutes: z.array(z.string().min(1).max(100)).min(1).max(20),
});

// ─── Dependencies ────────────────────────────────────────────────

interface AIDependencies {
  readonly llmClient: LLMClient;
}

let deps: AIDependencies | null = null;

export function configureAiRoutes(dependencies: AIDependencies): void {
  deps = dependencies;
}

// ─── Helpers ─────────────────────────────────────────────────────

function ensureTenantContext(c: {
  get(key: 'tenantContext'): TenantContext | undefined;
}): TenantContext {
  const ctx = c.get('tenantContext');
  if (ctx === undefined) {
    throw new AuthorizationError('Tenant context required');
  }
  return ctx;
}

function ensureDeps(): AIDependencies {
  if (deps === null) throw new Error('[ORDR:API] AI routes not configured');
  return deps;
}

// ─── Router ──────────────────────────────────────────────────────

const aiRouter = new Hono<Env>();

// All AI routes require auth + agents:read permission + ai_agents plan feature
// (agents permission — AI features are agent-tier functionality)
aiRouter.use('*', requireAuth());
aiRouter.use('*', requirePermissionMiddleware('agents', 'read'));
aiRouter.use('*', featureGate(FEATURES.AI_AGENTS));

// ─── POST /sentiment — Batch sentiment analysis ──────────────────

aiRouter.post('/sentiment', rateLimit('agent'), async (c): Promise<Response> => {
  const { llmClient } = ensureDeps();
  const ctx = ensureTenantContext(c);
  const correlationId = c.get('requestId');

  const body = await c.req.json().catch(() => null);
  const parsed = sentimentSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid sentiment request',
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
      correlationId,
    );
  }

  const backend = new LlmSentimentBackend(llmClient, ctx.tenantId);
  const analyzer = new SentimentAnalyzer(backend);

  const batchResult = await analyzer.analyzeBatch(parsed.data.texts);
  if (!batchResult.success) {
    return jsonErr(c, batchResult.error);
  }

  // Estimate total cost (budget tier for all sentiment calls)
  const modelUsed = 'claude-haiku-4-5-20251001';
  const estimatedCostCents = batchResult.data.length * 0.05; // ~$0.0005 per call, rough estimate

  return c.json({
    success: true as const,
    data: {
      results: batchResult.data,
      modelUsed,
      costCents: Math.round(estimatedCostCents * 100) / 100,
    },
  });
});

// ─── POST /insights — Agent insight generation ───────────────────

aiRouter.post('/insights', rateLimit('agent'), async (c): Promise<Response> => {
  const { llmClient } = ensureDeps();
  const ctx = ensureTenantContext(c);
  const correlationId = c.get('requestId');

  const body = await c.req.json().catch(() => null);
  const parsed = insightSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid insight request',
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
      correlationId,
    );
  }

  const systemPrompt = `You are an AI operations analyst for a customer operations platform.
Analyze the customer context and provide a brief, actionable insight.
CRITICAL: Your response must be a JSON object with fields: insight (string, max 500 chars),
recommendedAction (string, max 200 chars), confidence (number 0.0–1.0).
Do NOT include any customer names, PII, or PHI in your response.`;

  const userPrompt = `Context: ${parsed.data.context}
CustomerID: ${parsed.data.customerId}
SessionID: ${parsed.data.sessionId}
Provide an operational insight and recommended action.`;

  const result = await llmClient.complete({
    messages: [{ role: 'user', content: userPrompt }],
    modelTier: 'standard',
    maxTokens: 256,
    temperature: 0.1,
    systemPrompt,
    metadata: {
      tenant_id: ctx.tenantId,
      correlation_id: correlationId,
      agent_id: 'insight-generator',
    },
  });

  if (!result.success) {
    return jsonErr(c, result.error);
  }

  try {
    const parsed2 = JSON.parse(result.data.content) as unknown;
    if (
      typeof parsed2 !== 'object' ||
      parsed2 === null ||
      typeof (parsed2 as Record<string, unknown>)['insight'] !== 'string' ||
      typeof (parsed2 as Record<string, unknown>)['recommendedAction'] !== 'string' ||
      typeof (parsed2 as Record<string, unknown>)['confidence'] !== 'number'
    ) {
      throw new Error('Invalid response schema');
    }
    const typed = parsed2 as { insight: string; recommendedAction: string; confidence: number };
    return c.json({
      success: true as const,
      data: {
        insight: typed.insight.slice(0, 500),
        recommendedAction: typed.recommendedAction.slice(0, 200),
        confidence: Math.max(0, Math.min(1, typed.confidence)),
        modelUsed: 'claude-sonnet-4-6',
        costCents:
          result.data.tokenUsage.total > 0 ? Math.ceil(result.data.tokenUsage.total * 0.018) : 1,
      },
    });
  } catch {
    return jsonErr(
      c,
      new ValidationError('AI returned malformed insight response', {}, correlationId),
    );
  }
});

// ─── POST /route — Entity routing decision ───────────────────────

aiRouter.post('/route', rateLimit('agent'), async (c): Promise<Response> => {
  const { llmClient } = ensureDeps();
  const ctx = ensureTenantContext(c);
  const correlationId = c.get('requestId');

  const body = await c.req.json().catch(() => null);
  const parsed = routeEntitySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid routing request',
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
      correlationId,
    );
  }

  const systemPrompt = `You are an entity routing engine. Select the best route for the given entity.
Your response must be a JSON object: { selectedRoute: string, confidence: number (0.0-1.0), reasoning: string (max 200 chars) }
selectedRoute MUST be one of the available routes provided. No PII in reasoning.`;

  const userPrompt = `EntityType: ${parsed.data.entityType}
EntityID: ${parsed.data.entityId}
AvailableRoutes: ${parsed.data.availableRoutes.join(', ')}
Select the optimal route.`;

  const result = await llmClient.complete({
    messages: [{ role: 'user', content: userPrompt }],
    modelTier: 'standard',
    maxTokens: 128,
    temperature: 0,
    systemPrompt,
    metadata: {
      tenant_id: ctx.tenantId,
      correlation_id: correlationId,
      agent_id: 'entity-router',
    },
  });

  if (!result.success) {
    return jsonErr(c, result.error);
  }

  try {
    const parsed2 = JSON.parse(result.data.content) as unknown;
    if (
      typeof parsed2 !== 'object' ||
      parsed2 === null ||
      typeof (parsed2 as Record<string, unknown>)['selectedRoute'] !== 'string' ||
      typeof (parsed2 as Record<string, unknown>)['confidence'] !== 'number' ||
      typeof (parsed2 as Record<string, unknown>)['reasoning'] !== 'string'
    ) {
      throw new Error('Invalid response schema');
    }
    const typed = parsed2 as { selectedRoute: string; confidence: number; reasoning: string };
    // Validate selectedRoute is one of the available routes
    const selectedRoute = parsed.data.availableRoutes.includes(typed.selectedRoute)
      ? typed.selectedRoute
      : (parsed.data.availableRoutes[0] ?? 'default');

    return c.json({
      success: true as const,
      data: {
        selectedRoute,
        confidence: Math.max(0, Math.min(1, typed.confidence)),
        reasoning: typed.reasoning.slice(0, 200),
        modelUsed: 'claude-sonnet-4-6',
      },
    });
  } catch {
    return jsonErr(
      c,
      new ValidationError('AI returned malformed routing response', {}, correlationId),
    );
  }
});

export { aiRouter };
