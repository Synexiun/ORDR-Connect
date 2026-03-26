/**
 * Interaction Event Handlers — graph enrichment from interaction events
 *
 * SOC2 CC7.2 — Monitoring: process interaction events for relationship graph.
 * ISO 27001 A.12.4.1 — Event logging for all interaction data.
 *
 * Handlers:
 * - interaction.logged → GraphEnricher.handleInteractionLogged()
 *
 * SECURITY:
 * - All operations are tenant-scoped
 * - NEVER logs interaction content — only metadata (channel, direction, IDs)
 * - Failures are logged but do NOT crash the worker
 */

import type { EventEnvelope, InteractionLoggedPayload } from '@ordr/events';
import type { GraphEnricher } from '@ordr/graph';
import type { AuditLogger } from '@ordr/audit';

// ─── Dependencies ────────────────────────────────────────────────

export interface InteractionEventsDeps {
  readonly graphEnricher: GraphEnricher;
  readonly auditLogger: AuditLogger;
}

// ─── Handler Factory ─────────────────────────────────────────────

export function createInteractionEventsHandler(
  deps: InteractionEventsDeps,
): (event: EventEnvelope<unknown>) => Promise<void> {
  return async (event: EventEnvelope<unknown>): Promise<void> => {
    const { type, tenantId, payload, metadata } = event;

    if (type !== 'interaction.logged') {
      console.warn(`[ORDR:WORKER] Unexpected interaction event type: ${type}`);
      return;
    }

    const data = payload as InteractionLoggedPayload;

    // Enrich graph with interaction data
    const result = await deps.graphEnricher.handleInteractionLogged({
      interactionId: data.interactionId,
      customerId: data.customerId,
      channel: data.channel,
      direction: (data.direction === 'inbound' ? 'inbound' : 'outbound') as 'inbound' | 'outbound',
      tenantId,
    });

    if (!result.success) {
      console.error(
        `[ORDR:WORKER] Graph enrichment failed for interaction.logged (tenant=${tenantId}, interaction=${data.interactionId}):`,
        result.error.message,
      );
    }

    // Audit log the processing — NO content, only metadata
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
        success: result.success,
      },
      timestamp: new Date(),
    });
  };
}
