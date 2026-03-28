/**
 * Agent Event Handlers — agent session orchestration from domain events
 *
 * SOC2 CC1.4 — Agent actions with confidence scores.
 * ISO 27001 A.12.4 — Full agent lifecycle logging.
 * HIPAA §164.312(b) — Audit controls on all agent actions.
 *
 * Handlers:
 * - agent.triggered → Start AgentEngine session → run loop → publish outcome
 * - agent.action_executed → GraphEnricher.handleAgentAction()
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Agent trigger is async — worker picks up event and runs loop
 * - Full audit trail: trigger → session → steps → outcome
 * - NEVER logs prompt/response content (may contain PHI)
 * - Budget enforcement is hard — exceed budget = session ends
 */

import type { EventEnvelope, AgentActionExecutedPayload } from '@ordr/events';
import { createEventEnvelope, TOPICS, EventType } from '@ordr/events';
import type { EventProducer } from '@ordr/events';
import type { AgentEngine } from '@ordr/agent-runtime';
import type { GraphEnricher } from '@ordr/graph';
import type { AuditLogger } from '@ordr/audit';
import type { AgentRole, AutonomyLevel } from '@ordr/core';
import type { NotificationWriter } from '../types.js';

// ─── Agent Triggered Payload ─────────────────────────────────────

interface AgentTriggeredPayload {
  readonly sessionId: string;
  readonly customerId: string;
  readonly agentRole: string;
  readonly autonomyLevel: string;
}

// ─── Dependencies ────────────────────────────────────────────────

export interface AgentEventsDeps {
  readonly agentEngine: AgentEngine;
  readonly graphEnricher: GraphEnricher;
  readonly eventProducer: EventProducer;
  readonly auditLogger: AuditLogger;
  readonly notificationWriter: NotificationWriter;
}

// ─── Handler Factory ─────────────────────────────────────────────

export function createAgentEventsHandler(
  deps: AgentEventsDeps,
): (event: EventEnvelope<unknown>) => Promise<void> {
  return async (event: EventEnvelope<unknown>): Promise<void> => {
    const { type, tenantId, payload, metadata } = event;

    switch (type) {
      case 'agent.triggered': {
        const data = payload as AgentTriggeredPayload;

        // Start agent session via engine
        const sessionResult = await deps.agentEngine.startSession(
          tenantId,
          data.customerId,
          data.agentRole as AgentRole,
          event.id,
          data.autonomyLevel as AutonomyLevel,
        );

        if (!sessionResult.success) {
          console.error(
            `[ORDR:WORKER] Failed to start agent session (tenant=${tenantId}, role=${data.agentRole}):`,
            sessionResult.error.message,
          );

          // Audit log failure
          await deps.auditLogger.log({
            tenantId,
            eventType: 'agent.action',
            actorType: 'system',
            actorId: 'worker',
            resource: 'agent_session',
            resourceId: data.sessionId,
            action: 'session_start_failed',
            details: {
              agentRole: data.agentRole,
              correlationId: metadata.correlationId,
              error: sessionResult.error.code,
            },
            timestamp: new Date(),
          });

          await deps.notificationWriter
            .insert({
              tenantId,
              type: 'system',
              severity: 'high',
              title: 'Agent session could not start',
              description: `Agent role "${data.agentRole}" failed to initialise. Session ID: ${data.sessionId}. Error: ${sessionResult.error.code}.`,
              actionLabel: 'View agent activity',
              actionRoute: '/agent-activity',
              metadata: {
                sessionId: data.sessionId,
                agentRole: data.agentRole,
                error: sessionResult.error.code,
              },
            })
            .catch((notifErr: unknown) => {
              console.error(
                '[ORDR:WORKER] Failed to write session_start_failed notification:',
                notifErr,
              );
            });

          return;
        }

        const context = sessionResult.data;

        // Run the agent loop
        const outcomeResult = await deps.agentEngine.runLoop(context);

        if (!outcomeResult.success) {
          console.error(
            `[ORDR:WORKER] Agent loop failed (tenant=${tenantId}, session=${context.sessionId}):`,
            outcomeResult.error.message,
          );
          return;
        }

        const outcome = outcomeResult.data;

        // Audit log outcome
        await deps.auditLogger.log({
          tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: context.sessionId,
          resource: 'agent_session',
          resourceId: context.sessionId,
          action: `session_${outcome.result}`,
          details: {
            result: outcome.result,
            totalSteps: outcome.totalSteps,
            totalCost: outcome.totalCost,
            totalTokens: outcome.totalTokens,
            description: outcome.description,
          },
          timestamp: new Date(),
        });

        // Notify on actionable outcomes: escalation, failure, or timeout
        if (outcome.result === 'escalated') {
          await deps.notificationWriter
            .insert({
              tenantId,
              type: 'hitl',
              severity: 'high',
              title: 'Agent escalated: human review required',
              description: `Agent role "${data.agentRole}" escalated after ${String(outcome.totalSteps)} step(s) and requires human review. Session ID: ${context.sessionId}.`,
              actionLabel: 'Review session',
              actionRoute: '/agent-activity',
              metadata: { sessionId: context.sessionId, agentRole: data.agentRole },
            })
            .catch((notifErr: unknown) => {
              console.error('[ORDR:WORKER] Failed to write escalated notification:', notifErr);
            });
        } else if (outcome.result === 'failed') {
          await deps.notificationWriter
            .insert({
              tenantId,
              type: 'system',
              severity: 'high',
              title: 'Agent session failed',
              description: `Agent role "${data.agentRole}" session ended with a failure after ${String(outcome.totalSteps)} step(s). Session ID: ${context.sessionId}.`,
              actionLabel: 'View agent activity',
              actionRoute: '/agent-activity',
              metadata: { sessionId: context.sessionId, agentRole: data.agentRole },
            })
            .catch((notifErr: unknown) => {
              console.error('[ORDR:WORKER] Failed to write failed notification:', notifErr);
            });
        } else if (outcome.result === 'timeout') {
          await deps.notificationWriter
            .insert({
              tenantId,
              type: 'system',
              severity: 'medium',
              title: 'Agent session timed out',
              description: `Agent role "${data.agentRole}" session exceeded the time budget after ${String(outcome.totalSteps)} step(s). Session ID: ${context.sessionId}.`,
              actionLabel: 'View agent activity',
              actionRoute: '/agent-activity',
              metadata: { sessionId: context.sessionId, agentRole: data.agentRole },
            })
            .catch((notifErr: unknown) => {
              console.error('[ORDR:WORKER] Failed to write timeout notification:', notifErr);
            });
        }

        // Publish agent outcome event
        const outcomeEvent = createEventEnvelope(
          EventType.AGENT_ACTION_EXECUTED,
          tenantId,
          {
            actionId: context.sessionId,
            agentId: context.sessionId,
            agentRole: data.agentRole,
            actionType: `session_${outcome.result}`,
            confidence: 1.0,
            approved: true,
          },
          {
            correlationId: metadata.correlationId,
            agentId: context.sessionId,
            source: 'worker',
          },
        );

        await deps.eventProducer
          .publish(TOPICS.AGENT_EVENTS, outcomeEvent)
          .catch((publishErr: unknown) => {
            console.error('[ORDR:WORKER] Failed to publish agent outcome event:', publishErr);
          });

        break;
      }

      case 'agent.action_executed': {
        const data = payload as AgentActionExecutedPayload;

        // Enrich graph with agent action
        const result = await deps.graphEnricher.handleAgentAction({
          actionId: data.actionId,
          agentId: data.agentId,
          customerId: '', // Not available in this event type — graph will use agentId
          actionType: data.actionType,
          tenantId,
        });

        if (!result.success) {
          console.error(
            `[ORDR:WORKER] Graph enrichment failed for agent.action_executed (tenant=${tenantId}, action=${data.actionId}):`,
            result.error.message,
          );
        }

        // Audit log
        await deps.auditLogger.log({
          tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: data.agentId,
          resource: 'agent_action_graph',
          resourceId: data.actionId,
          action: 'graph_enrichment',
          details: {
            actionType: data.actionType,
            confidence: data.confidence,
            correlationId: metadata.correlationId,
            success: result.success,
          },
          timestamp: new Date(),
        });

        break;
      }

      default:
        console.warn(`[ORDR:WORKER] Unknown agent event type: ${type}`);
    }
  };
}
