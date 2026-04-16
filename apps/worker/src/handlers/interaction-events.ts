/**
 * Interaction Event Handlers — graph enrichment + NBA evaluation from interaction events
 *
 * SOC2 CC7.2 — Monitoring: process interaction events for relationship graph.
 * ISO 27001 A.12.4.1 — Event logging for all interaction data.
 * HIPAA §164.308(a)(1)(ii)(D) — Activity review: all agent-triggering decisions logged.
 *
 * Handlers:
 * - interaction.logged → GraphEnricher.handleInteractionLogged()
 *                      → NBAPipeline.evaluate() → build DecisionContext
 *                      → AgentOrchestrator.dispatch() if action != no_action
 *
 * SECURITY:
 * - All operations are tenant-scoped
 * - NEVER logs interaction content — only metadata (channel, direction, IDs)
 * - NBA evaluation is skipped for outbound events (avoid feedback loops)
 * - Failures are logged but do NOT crash the worker
 */

import type { EventEnvelope, InteractionLoggedPayload } from '@ordr/events';
import { createEventEnvelope, TOPICS, EventType } from '@ordr/events';
import type { EventProducer } from '@ordr/events';
import type { GraphEnricher } from '@ordr/graph';
import type { AuditLogger } from '@ordr/audit';
import type { AgentOutcome } from '@ordr/agent-runtime';
import type { Result } from '@ordr/core';

// ─── Narrow interface types ──────────────────────────────────────
// Using structural interfaces rather than importing the full classes
// keeps this handler testable without heavy dependencies.

/** Minimal customer profile shape for NBA context. */
export interface CustomerProfileSnapshot {
  readonly healthScore: number;
  readonly lifecycleStage: string;
  readonly segment: string;
  readonly ltv: number;
  readonly sentimentAvg: number;
  readonly responseRate: number;
  readonly preferredChannel: string | undefined;
  readonly outstandingBalance: number;
  readonly maxBalance: number;
  readonly daysSinceLastContact: number;
  readonly totalInteractions30d: number;
  readonly paymentHistory: readonly Record<string, unknown>[];
}

/** NBA pipeline evaluate interface (structurally compatible with NBAPipelineInterface). */
export interface NBAEvaluator {
  readonly evaluate: (context: {
    readonly tenantId: string;
    readonly customerId: string;
    readonly eventType: string;
    readonly eventPayload: Record<string, unknown>;
    readonly customerProfile: Record<string, unknown>;
    readonly channelPreferences: readonly string[];
    readonly interactionHistory: readonly Record<string, unknown>[];
    readonly constraints: Record<string, unknown>;
    readonly timestamp: Date;
    readonly correlationId: string;
  }) => Promise<
    Result<{
      readonly id: string;
      readonly tenantId: string;
      readonly customerId: string;
      readonly action: string;
      readonly channel: string | undefined;
      readonly parameters: Record<string, unknown>;
      readonly score: number;
      readonly confidence: number;
      readonly reasoning: string;
    }>
  >;
}

/** Agent orchestrator dispatch interface. */
export interface AgentDispatcher {
  readonly dispatch: (
    decision: {
      readonly id: string;
      readonly action: string;
      readonly channel?: string | undefined;
      readonly parameters: Record<string, unknown>;
      readonly score: number;
      readonly confidence: number;
      readonly reasoning: string;
    },
    tenantId: string,
    customerId: string,
  ) => Promise<Result<AgentOutcome>>;
}

// ─── Dependencies ────────────────────────────────────────────────

export interface InteractionEventsDeps {
  readonly graphEnricher: GraphEnricher;
  readonly auditLogger: AuditLogger;
  readonly nbaPipeline: NBAEvaluator;
  readonly orchestrator: AgentDispatcher;
  readonly eventProducer: EventProducer;
  /** Fetch a minimal customer profile for NBA context. Returns null if not found. */
  readonly getCustomerProfile: (
    tenantId: string,
    customerId: string,
  ) => Promise<CustomerProfileSnapshot | null>;
}

// ─── Default profile ─────────────────────────────────────────────
// Used when the customer profile cannot be fetched. Rules that compare
// profile fields will simply not fire; ML/LLM layers get neutral signals.

function defaultProfile(): CustomerProfileSnapshot {
  return {
    healthScore: 50,
    lifecycleStage: 'active',
    segment: 'standard',
    ltv: 0,
    sentimentAvg: 0,
    responseRate: 0,
    preferredChannel: undefined,
    outstandingBalance: 0,
    maxBalance: 0,
    daysSinceLastContact: 0,
    totalInteractions30d: 0,
    paymentHistory: [],
  };
}

// ─── Handler Factory ─────────────────────────────────────────────

export function createInteractionEventsHandler(
  deps: InteractionEventsDeps,
): (event: EventEnvelope<unknown>) => Promise<void> {
  return async (event: EventEnvelope<unknown>): Promise<void> => {
    const { type, tenantId, payload, metadata } = event;

    if (type !== 'interaction.logged') {
      console.warn(
        JSON.stringify({
          level: 'warn',
          component: 'interaction-events',
          event: 'unexpected_event_type',
          type,
        }),
      );
      return;
    }

    const data = payload as InteractionLoggedPayload;

    // ── 1. Graph enrichment ──────────────────────────────────────
    const graphResult = await deps.graphEnricher.handleInteractionLogged({
      interactionId: data.interactionId,
      customerId: data.customerId,
      channel: data.channel,
      direction: data.direction === 'inbound' ? 'inbound' : 'outbound',
      tenantId,
    });

    if (!graphResult.success) {
      console.error(
        JSON.stringify({
          level: 'error',
          component: 'interaction-events',
          event: 'graph_enrichment_failed',
          tenantId,
          interactionId: data.interactionId,
          error: graphResult.error.message,
        }),
      );
    }

    // Audit graph enrichment — NO content, only metadata
    await deps.auditLogger.log({
      tenantId,
      eventType: 'data.created',
      actorType: 'system',
      actorId: 'worker',
      resource: 'interaction_graph',
      resourceId: data.interactionId,
      action: 'graph_enrichment',
      details: {
        eventType: type,
        correlationId: metadata.correlationId,
        customerId: data.customerId,
        channel: data.channel,
        direction: data.direction,
        success: graphResult.success,
      },
      timestamp: new Date(),
    });

    // ── 2. NBA evaluation ────────────────────────────────────────
    // Only evaluate on inbound interactions — outbound messages we sent
    // don't need a new action decision (prevents feedback loops).
    if (data.direction !== 'inbound') {
      return;
    }

    // Fetch customer profile — fall back to neutral defaults if unavailable
    const profile: CustomerProfileSnapshot =
      (await deps.getCustomerProfile(tenantId, data.customerId)) ?? defaultProfile();

    const correlationId = metadata.correlationId;

    const nbaResult = await deps.nbaPipeline.evaluate({
      tenantId,
      customerId: data.customerId,
      eventType: type,
      eventPayload: {
        interactionId: data.interactionId,
        channel: data.channel,
        direction: data.direction,
        interactionType: data.type,
        sentiment: data.sentiment,
      },
      customerProfile: profile as unknown as Record<string, unknown>,
      channelPreferences: profile.preferredChannel !== undefined ? [profile.preferredChannel] : [],
      interactionHistory: [],
      constraints: {
        budgetCents: undefined,
        timeWindowMinutes: undefined,
        blockedChannels: [],
        maxContactsPerWeek: 7,
        maxSmsPerDay: 3,
        maxEmailsPerWeek: 5,
      },
      timestamp: new Date(),
      correlationId,
    });

    if (!nbaResult.success) {
      console.error(
        JSON.stringify({
          level: 'error',
          component: 'interaction-events',
          event: 'nba_evaluation_failed',
          tenantId,
          customerId: data.customerId,
          error: nbaResult.error.message,
        }),
      );
      await deps.auditLogger.log({
        tenantId,
        eventType: 'agent.decision',
        actorType: 'system',
        actorId: 'nba_pipeline',
        resource: 'nba_decision',
        resourceId: correlationId,
        action: 'nba_evaluation_failed',
        details: {
          customerId: data.customerId,
          correlationId,
          error: nbaResult.error.code,
        },
        timestamp: new Date(),
      });
      return;
    }

    const decision = nbaResult.data;

    // Audit NBA decision — no PHI, only scores and metadata
    await deps.auditLogger.log({
      tenantId,
      eventType: 'agent.decision',
      actorType: 'system',
      actorId: 'nba_pipeline',
      resource: 'nba_decision',
      resourceId: decision.id,
      action: 'nba_evaluated',
      details: {
        customerId: data.customerId,
        action: decision.action,
        channel: decision.channel,
        score: decision.score,
        confidence: decision.confidence,
        correlationId,
      },
      timestamp: new Date(),
    });

    // Skip dispatch for no_action decisions
    if (decision.action === 'no_action') {
      return;
    }

    // ── 3. Agent orchestrator dispatch ───────────────────────────
    const dispatchResult = await deps.orchestrator.dispatch(
      {
        id: decision.id,
        action: decision.action,
        channel: decision.channel,
        parameters: decision.parameters,
        score: decision.score,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
      },
      tenantId,
      data.customerId,
    );

    if (!dispatchResult.success) {
      console.error(
        JSON.stringify({
          level: 'error',
          component: 'interaction-events',
          event: 'agent_dispatch_failed',
          tenantId,
          action: decision.action,
          error: dispatchResult.error.message,
        }),
      );
      await deps.auditLogger.log({
        tenantId,
        eventType: 'agent.action',
        actorType: 'system',
        actorId: 'orchestrator',
        resource: 'agent_dispatch',
        resourceId: decision.id,
        action: 'dispatch_failed',
        details: {
          customerId: data.customerId,
          action: decision.action,
          correlationId,
          error: dispatchResult.error.code,
        },
        timestamp: new Date(),
      });
      return;
    }

    const outcome = dispatchResult.data;

    // Audit dispatch outcome
    await deps.auditLogger.log({
      tenantId,
      eventType: 'agent.action',
      actorType: 'system',
      actorId: 'orchestrator',
      resource: 'agent_dispatch',
      resourceId: decision.id,
      action: 'dispatch_completed',
      details: {
        customerId: data.customerId,
        action: decision.action,
        agentResult: outcome.result,
        totalSteps: outcome.totalSteps,
        correlationId,
      },
      timestamp: new Date(),
    });

    // Publish agent action executed event
    const actionEvent = createEventEnvelope(
      EventType.AGENT_ACTION_EXECUTED,
      tenantId,
      {
        actionId: decision.id,
        agentId: outcome.sessionId,
        agentRole: decision.action,
        actionType: outcome.result,
        confidence: decision.confidence,
        approved: true,
      },
      {
        correlationId,
        agentId: outcome.sessionId,
        source: 'worker',
      },
    );

    await deps.eventProducer
      .publish(TOPICS.AGENT_EVENTS, actionEvent)
      .catch((publishErr: unknown) => {
        console.error(
          JSON.stringify({
            level: 'error',
            component: 'interaction-events',
            event: 'publish_failed',
            topic: 'agent_events',
            error: publishErr instanceof Error ? publishErr.message : String(publishErr),
          }),
        );
      });
  };
}
