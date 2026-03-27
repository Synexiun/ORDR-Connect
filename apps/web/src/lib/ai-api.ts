/**
 * AI API Service — Frontend wrappers for ORDR-Connect AI/ML endpoints.
 *
 * COMPLIANCE (CLAUDE.md Rule 6, 9):
 * - No PHI in request bodies — callers must pass sanitized text tokens or IDs only
 * - Sentiment analysis operates on non-PHI text; content resolution happens server-side
 * - Agent insights use customer IDs (not names) — no PHI in transit
 * - All AI costs are tracked and logged server-side per agent budget rules
 *
 * HIPAA §164.312 — PHI excluded from AI analysis pipeline.
 * SOC2 CC7.2 — Sentiment monitoring for anomaly detection.
 */

import { apiClient } from './api';

// ─── Sentiment Analysis ──────────────────────────────────────────────────────

export interface SentimentRequest {
  /** Sanitized text tokens — NO PHI, no customer names, no message content */
  readonly texts: string[];
}

export interface SentimentResultItem {
  readonly score: number; // -1.0 to 1.0
  readonly label: 'positive' | 'neutral' | 'negative';
  readonly confidence: number; // 0.0 to 1.0
}

export interface SentimentResponse {
  readonly results: SentimentResultItem[];
  readonly modelUsed: string;
  readonly costCents: number;
}

/**
 * Batch sentiment analysis on sanitized text.
 * Max 50 texts, max 10,000 chars each (enforced server-side).
 */
export function analyzeSentiment(body: SentimentRequest): Promise<SentimentResponse> {
  return apiClient.post<SentimentResponse>('/v1/ai/sentiment', body);
}

// ─── Agent Insights ──────────────────────────────────────────────────────────

export type InsightContext = 'churn_risk' | 'upsell' | 'support' | 'healthcare';

export interface AgentInsightRequest {
  /** Tokenized customer reference — NOT the real name (HIPAA safe) */
  readonly customerId: string;
  readonly sessionId: string;
  readonly context: InsightContext;
}

export interface AgentInsightResponse {
  readonly insight: string;
  readonly recommendedAction: string;
  readonly confidence: number;
  readonly modelUsed: string;
  readonly costCents: number;
}

/**
 * Generate an AI insight for a customer session.
 * Uses standard tier (claude-sonnet-4-6) for balanced cost/capability.
 * HITL mandatory for financial actions derived from insights (CLAUDE.md Rule 9).
 */
export function generateAgentInsight(body: AgentInsightRequest): Promise<AgentInsightResponse> {
  return apiClient.post<AgentInsightResponse>('/v1/ai/insights', body);
}

// ─── Entity Routing ──────────────────────────────────────────────────────────

export interface EntityRoutingRequest {
  /** Tokenized entity reference */
  readonly entityId: string;
  readonly entityType: 'customer' | 'interaction' | 'session';
  readonly availableRoutes: string[];
}

export interface EntityRoutingResponse {
  readonly selectedRoute: string;
  readonly confidence: number;
  readonly reasoning: string;
  readonly modelUsed: string;
}

/**
 * Route an entity to the most appropriate workflow.
 * Uses standard tier for routing decisions that need context comprehension.
 */
export function routeEntity(body: EntityRoutingRequest): Promise<EntityRoutingResponse> {
  return apiClient.post<EntityRoutingResponse>('/v1/ai/route', body);
}
