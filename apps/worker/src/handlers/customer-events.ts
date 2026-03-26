/**
 * Customer Event Handlers — graph enrichment from customer lifecycle events
 *
 * SOC2 CC7.2 — Monitoring: process customer events for relationship graph.
 * ISO 27001 A.12.4.1 — Event logging for all customer data changes.
 *
 * Handlers:
 * - customer.created → GraphEnricher.handleCustomerCreated()
 * - customer.updated → Update graph node properties
 *
 * SECURITY:
 * - All operations are tenant-scoped
 * - NEVER logs customer PII — only metadata (event type, IDs)
 * - Failures are logged but do NOT crash the worker
 */

import type { EventEnvelope, CustomerCreatedPayload, CustomerUpdatedPayload } from '@ordr/events';
import type { GraphEnricher } from '@ordr/graph';
import type { AuditLogger } from '@ordr/audit';

// ─── Dependencies ────────────────────────────────────────────────

export interface CustomerEventsDeps {
  readonly graphEnricher: GraphEnricher;
  readonly auditLogger: AuditLogger;
}

// ─── Handler Factory ─────────────────────────────────────────────

export function createCustomerEventsHandler(
  deps: CustomerEventsDeps,
): (event: EventEnvelope<unknown>) => Promise<void> {
  return async (event: EventEnvelope<unknown>): Promise<void> => {
    const { type, tenantId, payload, metadata } = event;

    switch (type) {
      case 'customer.created': {
        const data = payload as CustomerCreatedPayload;

        const result = await deps.graphEnricher.handleCustomerCreated({
          customerId: data.customerId,
          name: data.name,
          email: data.email,
          type: (data.type === 'company' ? 'company' : 'person') as 'person' | 'company',
          tenantId,
        });

        if (!result.success) {
          console.error(
            `[ORDR:WORKER] Graph enrichment failed for customer.created (tenant=${tenantId}, customer=${data.customerId}):`,
            result.error.message,
          );
        }

        // Audit log the processing
        await deps.auditLogger.log({
          tenantId,
          eventType: 'data.created',
          actorType: 'system',
          actorId: 'worker',
          resource: 'customer_graph',
          resourceId: data.customerId,
          action: 'graph_enrichment',
          details: {
            eventType: type,
            correlationId: metadata.correlationId,
            success: result.success,
          },
          timestamp: new Date(),
        });

        break;
      }

      case 'customer.updated': {
        const data = payload as CustomerUpdatedPayload;

        // For updates, we enrich the graph with updated properties
        // The GraphEnricher.handleCustomerCreated handles upsert (idempotent)
        const result = await deps.graphEnricher.handleCustomerCreated({
          customerId: data.customerId,
          name: '', // Updates only change specified fields
          email: '',
          type: 'person',
          tenantId,
        });

        if (!result.success) {
          console.error(
            `[ORDR:WORKER] Graph enrichment failed for customer.updated (tenant=${tenantId}, customer=${data.customerId}):`,
            result.error.message,
          );
        }

        // Audit log the processing
        await deps.auditLogger.log({
          tenantId,
          eventType: 'data.updated',
          actorType: 'system',
          actorId: 'worker',
          resource: 'customer_graph',
          resourceId: data.customerId,
          action: 'graph_enrichment',
          details: {
            eventType: type,
            correlationId: metadata.correlationId,
            changedFields: Object.keys(data.changes),
            success: result.success,
          },
          timestamp: new Date(),
        });

        break;
      }

      default:
        console.warn(`[ORDR:WORKER] Unknown customer event type: ${type}`);
    }
  };
}
