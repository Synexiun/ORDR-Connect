/**
 * Route ticket tool — support ticket routing to appropriate teams/agents
 *
 * SECURITY (CLAUDE.md Rules 2, 6, 9):
 * - Routing decisions are audit-logged with full context
 * - Tenant isolation on all routing lookups
 * - NO customer content in audit logs — only routing metadata
 *
 * COMPLIANCE:
 * - Routing decisions traceable for SOC2 CC7.2
 * - Assignment audit trail for ISO 27001 A.9.2
 */

import { z } from 'zod';
import {
  type Result,
  ok,
  err,
  type AppError,
  ValidationError,
} from '@ordr/core';
import type { AgentTool, AgentContext } from '../types.js';

// ─── Tool Parameter Schema ──────────────────────────────────────

const routeTicketParamsSchema = z.object({
  category: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  customerId: z.string().min(1),
});

// ─── Routing Result ─────────────────────────────────────────────

export interface RouteResult {
  readonly assignedTo: string;
  readonly queuePosition: number;
  readonly estimatedWaitTime: number;
  readonly routingReason: string;
}

// ─── Dependency Interface ───────────────────────────────────────

export interface RouteTicketDeps {
  readonly routeToTeam: (
    category: string,
    priority: string,
    customerId: string,
    tenantId: string,
  ) => Promise<RouteResult>;
  readonly auditLog: (input: {
    readonly tenantId: string;
    readonly eventType: 'agent.action';
    readonly actorType: 'agent';
    readonly actorId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly action: string;
    readonly details: Record<string, unknown>;
    readonly timestamp: Date;
  }) => Promise<void>;
}

// ─── Tool Factory ───────────────────────────────────────────────

/**
 * Create the route-ticket tool with injected dependencies.
 *
 * SECURITY: Routing is tenant-isolated. Assignment decisions
 * are audit-logged for traceability.
 */
export function createRouteTicketTool(deps: RouteTicketDeps): AgentTool {
  return {
    name: 'route_ticket',
    description: 'Route a support ticket to the appropriate team or agent based on category and priority. Returns assignment details and estimated wait time.',
    parameters: routeTicketParamsSchema,
    execute: async (
      params: unknown,
      context: AgentContext,
    ): Promise<Result<unknown, AppError>> => {
      // ── Validate parameters ──
      const parsed = routeTicketParamsSchema.safeParse(params);
      if (!parsed.success) {
        return err(
          new ValidationError('Invalid routing parameters', {
            params: parsed.error.errors.map((e) => e.message),
          }),
        );
      }

      const { category, priority, customerId } = parsed.data;

      // ── Route to team — tenant-isolated ──
      const result = await deps.routeToTeam(
        category,
        priority,
        customerId,
        context.tenantId,
      );

      // ── Audit log — routing metadata only ──
      await deps.auditLog({
        tenantId: context.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: context.sessionId,
        resource: 'ticket_routing',
        resourceId: context.sessionId,
        action: 'route_ticket',
        details: {
          category,
          priority,
          assignedTo: result.assignedTo,
          queuePosition: result.queuePosition,
          estimatedWaitTime: result.estimatedWaitTime,
          sessionId: context.sessionId,
        },
        timestamp: new Date(),
      });

      return ok({
        assignedTo: result.assignedTo,
        queuePosition: result.queuePosition,
        estimatedWaitTime: result.estimatedWaitTime,
        routingReason: result.routingReason,
      });
    },
  };
}
