/**
 * Event-driven graph enrichment — builds the customer graph from domain events
 *
 * Listens for domain events (customer created, interaction logged, agent actions)
 * and materializes them as graph nodes and edges. All handlers are idempotent
 * (MERGE-based upsert, not blind INSERT).
 *
 * SECURITY:
 * - All operations are tenant-scoped
 * - PII is stored in the graph with the same tenant isolation as the source
 * - Event data is validated before graph writes
 */

import {
  type Result,
  err,
  ValidationError,
  type AppError,
} from '@ordr/core';
import type { GraphOperations } from './operations.js';
import type {
  CustomerCreatedEvent,
  InteractionLoggedEvent,
  AgentActionEvent,
  GraphNode,
  GraphEdge,
} from './types.js';

// ─── Enricher ────────────────────────────────────────────────────

export class GraphEnricher {
  private readonly operations: GraphOperations;

  constructor(operations: GraphOperations) {
    this.operations = operations;
  }

  /**
   * Handle customer.created event — create a Person or Company node.
   * Idempotent: checks for existing node before creation.
   */
  async handleCustomerCreated(
    event: CustomerCreatedEvent,
  ): Promise<Result<GraphNode, AppError>> {
    if (!event.tenantId || event.tenantId.trim().length === 0) {
      return err(
        new ValidationError('tenantId is required', {
          tenantId: ['tenantId must be a non-empty string'],
        }),
      );
    }

    if (!event.customerId || event.customerId.trim().length === 0) {
      return err(
        new ValidationError('customerId is required', {
          customerId: ['customerId must be a non-empty string'],
        }),
      );
    }

    // Idempotency check — see if node already exists
    const existing = await this.operations.getNode(
      event.customerId,
      event.tenantId,
    );

    if (existing.success && existing.data !== null) {
      // Node already exists — update properties (upsert behavior)
      return this.operations.updateNode(
        event.customerId,
        event.tenantId,
        {
          name: event.name,
          email: event.email,
          customerType: event.type,
        },
      );
    }

    // Determine node type from event
    const nodeType = event.type === 'company' ? 'Company' as const : 'Person' as const;

    return this.operations.createNode({
      type: nodeType,
      tenantId: event.tenantId,
      properties: {
        name: event.name,
        email: event.email,
        customerType: event.type,
        externalId: event.customerId,
      },
    });
  }

  /**
   * Handle interaction.logged event — create Interaction node + CONTACTED edge.
   * Idempotent: uses interactionId as the node key.
   */
  async handleInteractionLogged(
    event: InteractionLoggedEvent,
  ): Promise<Result<GraphEdge, AppError>> {
    if (!event.tenantId || event.tenantId.trim().length === 0) {
      return err(
        new ValidationError('tenantId is required', {
          tenantId: ['tenantId must be a non-empty string'],
        }),
      );
    }

    if (!event.interactionId || event.interactionId.trim().length === 0) {
      return err(
        new ValidationError('interactionId is required', {
          interactionId: ['interactionId must be a non-empty string'],
        }),
      );
    }

    if (!event.customerId || event.customerId.trim().length === 0) {
      return err(
        new ValidationError('customerId is required', {
          customerId: ['customerId must be a non-empty string'],
        }),
      );
    }

    // Idempotency check — see if interaction node already exists
    const existingInteraction = await this.operations.getNode(
      event.interactionId,
      event.tenantId,
    );

    if (!existingInteraction.success) {
      return existingInteraction;
    }

    // Create Interaction node if it doesn't exist
    if (existingInteraction.data === null) {
      const nodeResult = await this.operations.createNode({
        type: 'Interaction',
        tenantId: event.tenantId,
        properties: {
          channel: event.channel,
          direction: event.direction,
          externalId: event.interactionId,
        },
      });

      if (!nodeResult.success) {
        return nodeResult;
      }
    }

    // Create CONTACTED edge from customer to interaction
    // Direction: customer CONTACTED interaction (regardless of inbound/outbound)
    const edgeResult = await this.operations.createEdge({
      type: 'CONTACTED',
      sourceId: event.customerId,
      targetId: event.interactionId,
      tenantId: event.tenantId,
      properties: {
        channel: event.channel,
        direction: event.direction,
      },
      weight: 1,
    });

    return edgeResult;
  }

  /**
   * Handle agent.action event — create/update Agent node + edges.
   * Idempotent: uses agentId for the Agent node, creates new action edge.
   */
  async handleAgentAction(
    event: AgentActionEvent,
  ): Promise<Result<GraphEdge, AppError>> {
    if (!event.tenantId || event.tenantId.trim().length === 0) {
      return err(
        new ValidationError('tenantId is required', {
          tenantId: ['tenantId must be a non-empty string'],
        }),
      );
    }

    if (!event.agentId || event.agentId.trim().length === 0) {
      return err(
        new ValidationError('agentId is required', {
          agentId: ['agentId must be a non-empty string'],
        }),
      );
    }

    if (!event.customerId || event.customerId.trim().length === 0) {
      return err(
        new ValidationError('customerId is required', {
          customerId: ['customerId must be a non-empty string'],
        }),
      );
    }

    // Ensure Agent node exists (idempotent upsert)
    const existingAgent = await this.operations.getNode(
      event.agentId,
      event.tenantId,
    );

    if (!existingAgent.success) {
      return existingAgent;
    }

    if (existingAgent.data === null) {
      const agentResult = await this.operations.createNode({
        type: 'Agent',
        tenantId: event.tenantId,
        properties: {
          externalId: event.agentId,
          lastActionType: event.actionType,
        },
      });

      if (!agentResult.success) {
        return agentResult;
      }
    } else {
      // Update last action type
      const updateResult = await this.operations.updateNode(
        event.agentId,
        event.tenantId,
        { lastActionType: event.actionType },
      );

      if (!updateResult.success) {
        return updateResult;
      }
    }

    // Create ASSIGNED_TO edge from agent to customer
    const edgeResult = await this.operations.createEdge({
      type: 'ASSIGNED_TO',
      sourceId: event.agentId,
      targetId: event.customerId,
      tenantId: event.tenantId,
      properties: {
        actionId: event.actionId,
        actionType: event.actionType,
      },
      weight: 1,
    });

    return edgeResult;
  }
}
