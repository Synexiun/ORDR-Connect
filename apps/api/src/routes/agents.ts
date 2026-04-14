/**
 * Agent Routes — trigger, monitor, and manage AI agent sessions
 *
 * SOC2 CC6.1 — Access control: tenant-scoped, role-checked.
 * SOC2 CC7.2 — Monitoring: full agent lifecycle logging.
 * ISO 27001 A.9.4.1 — Information access restriction.
 * HIPAA §164.312(b) — Audit controls on all agent actions.
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Agent trigger is async — returns session ID immediately
 * - Kill switch is synchronous — takes effect immediately
 * - Every state change publishes events to Kafka
 * - Full audit trail for every action
 * - HITL items are tenant-scoped
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AuditLogger } from '@ordr/audit';
import type { EventProducer } from '@ordr/events';
import { createEventEnvelope, TOPICS } from '@ordr/events';
import type { AgentEngine } from '@ordr/agent-runtime';
import type { HitlQueue } from '@ordr/agent-runtime';
import { ValidationError, NotFoundError, AuthorizationError, PAGINATION } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { NBAPipeline } from '@ordr/decision-engine';
import type { DecisionContext } from '@ordr/decision-engine';
import type { Env } from '../types.js';
import { requireAuth, requirePermissionMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { broadcastEvent } from './events.js';

// ---- Input Schemas ---------------------------------------------------------

const triggerAgentSchema = z.object({
  customerId: z.string().uuid(),
  agentRole: z.enum([
    'lead_qualifier',
    'follow_up',
    'meeting_prep',
    'churn_detection',
    'collections',
    'support_triage',
    'escalation',
    'executive_briefing',
  ]),
  autonomyLevel: z
    .enum(['rule_based', 'router', 'supervised', 'autonomous', 'full_autonomy'])
    .optional(),
});

const killSessionSchema = z.object({
  reason: z.string().min(1).max(1000),
});

const rejectHitlSchema = z.object({
  reason: z.string().min(1).max(1000),
});

const listSessionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  pageSize: z.coerce
    .number()
    .int()
    .min(PAGINATION.MIN_PAGE_SIZE)
    .max(PAGINATION.MAX_PAGE_SIZE)
    .default(PAGINATION.DEFAULT_PAGE_SIZE),
  status: z.enum(['active', 'completed', 'killed', 'escalated', 'failed']).optional(),
  agentRole: z
    .enum([
      'lead_qualifier',
      'follow_up',
      'meeting_prep',
      'churn_detection',
      'collections',
      'support_triage',
      'escalation',
      'executive_briefing',
    ])
    .optional(),
});

// ─── NBA evaluation body schema ──────────────────────────────────
// Accepts a partial DecisionContext — callers provide what they can;
// missing profile fields are filled with safe defaults.
const nbaEvaluateSchema = z.object({
  customerId: z.string().uuid(),
  eventType: z.string().min(1).max(100),
  eventPayload: z.record(z.unknown()).default({}),
  customerProfile: z
    .object({
      ltv: z.number().default(0),
      healthScore: z.number().min(0).max(100).default(50),
      lifecycleStage: z
        .enum(['prospect', 'onboarding', 'active', 'at_risk', 'churned'])
        .default('active'),
      segment: z.string().default('standard'),
      preferredChannel: z.enum(['sms', 'email', 'voice', 'chat', 'in_app']).optional(),
      outstandingBalance: z.number().default(0),
      maxBalance: z.number().default(0),
      daysSinceLastContact: z.number().default(0),
      sentimentAvg: z.number().min(-1).max(1).default(0),
      responseRate: z.number().min(0).max(1).default(0.5),
      totalInteractions30d: z.number().int().default(0),
    })
    .default({}),
  channelPreferences: z.array(z.enum(['sms', 'email', 'voice', 'chat'])).default([]),
  constraints: z
    .object({
      budgetCents: z.number().optional(),
      timeWindowMinutes: z.number().optional(),
      blockedChannels: z.array(z.enum(['sms', 'email', 'voice', 'chat'])).default([]),
      maxContactsPerWeek: z.number().int().default(7),
      maxSmsPerDay: z.number().int().default(3),
      maxEmailsPerWeek: z.number().int().default(5),
    })
    .default({}),
});

// ---- Dependencies (injected at startup) ------------------------------------

interface AgentSession {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly agentRole: string;
  readonly autonomyLevel: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface RoutingDecision {
  readonly id: string;
  readonly entityId: string;
  readonly entityType: 'customer';
  readonly selectedRoute: string;
  readonly channel: string | null;
  readonly confidence: number;
  readonly reasoning: string;
  readonly sessionId: string;
  readonly modelUsed: string;
  readonly timestamp: string;
}

interface AgentDependencies {
  readonly auditLogger: AuditLogger;
  readonly eventProducer: EventProducer;
  readonly agentEngine: AgentEngine;
  readonly hitlQueue: HitlQueue;
  readonly nbaPipeline: NBAPipeline;
  readonly findSessionById: (tenantId: string, sessionId: string) => Promise<AgentSession | null>;
  readonly listSessions: (
    tenantId: string,
    filters: {
      readonly page: number;
      readonly pageSize: number;
      readonly status?: string;
      readonly agentRole?: string;
    },
  ) => Promise<{ readonly data: readonly AgentSession[]; readonly total: number }>;
  readonly createSession: (session: AgentSession) => Promise<AgentSession>;
  readonly updateSessionStatus: (
    tenantId: string,
    sessionId: string,
    status: string,
  ) => Promise<AgentSession | null>;
  readonly listRoutingDecisions: (
    tenantId: string,
    customerId: string,
    limit: number,
  ) => Promise<readonly RoutingDecision[]>;
}

let deps: AgentDependencies | null = null;

export function configureAgentRoutes(dependencies: AgentDependencies): void {
  deps = dependencies;
}

// ---- Helpers ----------------------------------------------------------------

function ensureTenantContext(c: {
  get(key: 'tenantContext'): TenantContext | undefined;
  get(key: 'requestId'): string;
}): TenantContext {
  const ctx = c.get('tenantContext');
  if (!ctx) {
    throw new AuthorizationError('Tenant context required');
  }
  return ctx;
}

function parseValidationErrors(issues: readonly z.ZodIssue[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = issue.path.join('.');
    const existing = fieldErrors[field];
    if (existing) {
      existing.push(issue.message);
    } else {
      fieldErrors[field] = [issue.message];
    }
  }
  return fieldErrors;
}

// ---- Router ----------------------------------------------------------------

const agentsRouter = new Hono<Env>();

// All routes require authentication
agentsRouter.use('*', requireAuth());

// ---- POST / — trigger an agent session --------------------------------------

agentsRouter.post(
  '/trigger',
  rateLimit('write'),
  requirePermissionMiddleware('agents', 'create'),
  async (c) => {
    if (!deps) throw new Error('[ORDR:API] Agent routes not configured');

    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');

    // Validate input
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = triggerAgentSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid agent trigger request',
        parseValidationErrors(parsed.error.issues),
        requestId,
      );
    }

    const { customerId, agentRole, autonomyLevel } = parsed.data;
    const sessionId = randomUUID();
    const now = new Date();

    // Persist session record
    const session = await deps.createSession({
      sessionId,
      tenantId: ctx.tenantId,
      customerId,
      agentRole,
      autonomyLevel: autonomyLevel ?? 'supervised',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    // Audit log
    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'agent.action',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'agent_session',
      resourceId: sessionId,
      action: 'trigger',
      details: {
        customerId,
        agentRole,
        autonomyLevel: autonomyLevel ?? 'supervised',
      },
      timestamp: now,
    });

    // Publish agent.triggered event — worker picks it up asynchronously
    const event = createEventEnvelope(
      'agent.triggered',
      ctx.tenantId,
      {
        sessionId,
        customerId,
        agentRole,
        autonomyLevel: autonomyLevel ?? 'supervised',
      },
      {
        correlationId: requestId,
        userId: ctx.userId,
        source: 'api',
      },
    );

    await deps.eventProducer.publish(TOPICS.AGENT_EVENTS, event).catch((publishErr: unknown) => {
      console.error('[ORDR:API] Failed to publish agent.triggered event:', publishErr);
    });

    // Broadcast SSE event so connected dashboard clients update immediately
    broadcastEvent({
      type: 'agent.session_started',
      data: { tenantId: ctx.tenantId, sessionId, agentRole, customerId },
    });

    return c.json(
      {
        success: true as const,
        data: {
          sessionId: session.sessionId,
          status: session.status,
          agentRole: session.agentRole,
          customerId: session.customerId,
          createdAt: session.createdAt.toISOString(),
        },
      },
      201,
    );
  },
);

// ---- GET /sessions — list active agent sessions for tenant ------------------

agentsRouter.get(
  '/sessions',
  rateLimit('read'),
  requirePermissionMiddleware('agents', 'read'),
  async (c) => {
    if (!deps) throw new Error('[ORDR:API] Agent routes not configured');

    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');

    const queryParsed = listSessionsQuerySchema.safeParse({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      status: c.req.query('status'),
      agentRole: c.req.query('agentRole'),
    });

    if (!queryParsed.success) {
      throw new ValidationError(
        'Invalid query parameters',
        parseValidationErrors(queryParsed.error.issues),
        requestId,
      );
    }

    const filters = queryParsed.data;
    const result = await deps.listSessions(ctx.tenantId, {
      page: filters.page,
      pageSize: filters.pageSize,
      ...(filters.status !== undefined ? { status: filters.status } : {}),
      ...(filters.agentRole !== undefined ? { agentRole: filters.agentRole } : {}),
    });

    return c.json({
      success: true as const,
      data: result.data,
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / filters.pageSize),
      },
    });
  },
);

// ---- GET /sessions/:id — get session detail ---------------------------------

agentsRouter.get(
  '/sessions/:id',
  rateLimit('read'),
  requirePermissionMiddleware('agents', 'read'),
  async (c) => {
    if (!deps) throw new Error('[ORDR:API] Agent routes not configured');

    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');
    const sessionId = c.req.param('id');

    const session = await deps.findSessionById(ctx.tenantId, sessionId);
    if (!session) {
      throw new NotFoundError('Agent session not found', requestId);
    }

    return c.json({
      success: true as const,
      data: session,
    });
  },
);

// ---- POST /sessions/:id/kill — kill an active session -----------------------

agentsRouter.post(
  '/sessions/:id/kill',
  rateLimit('write'),
  requirePermissionMiddleware('agents', 'delete'),
  async (c) => {
    if (!deps) throw new Error('[ORDR:API] Agent routes not configured');

    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');
    const sessionId = c.req.param('id');

    // Validate body
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = killSessionSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid kill request',
        parseValidationErrors(parsed.error.issues),
        requestId,
      );
    }

    // Verify session exists and belongs to tenant
    const session = await deps.findSessionById(ctx.tenantId, sessionId);
    if (!session) {
      throw new NotFoundError('Agent session not found', requestId);
    }

    // Kill switch is synchronous — takes effect immediately
    deps.agentEngine.killSession(sessionId, parsed.data.reason);

    // Update session status
    await deps.updateSessionStatus(ctx.tenantId, sessionId, 'killed');

    // Audit log
    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'agent.killed',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'agent_session',
      resourceId: sessionId,
      action: 'kill',
      details: { reason: parsed.data.reason },
      timestamp: new Date(),
    });

    // Publish kill event
    const event = createEventEnvelope(
      'agent.killed',
      ctx.tenantId,
      { sessionId, reason: parsed.data.reason },
      {
        correlationId: requestId,
        userId: ctx.userId,
        source: 'api',
      },
    );

    await deps.eventProducer.publish(TOPICS.AGENT_EVENTS, event).catch((publishErr: unknown) => {
      console.error('[ORDR:API] Failed to publish agent.killed event:', publishErr);
    });

    // Broadcast SSE event — dashboard active-agent count updates immediately
    broadcastEvent({
      type: 'agent.session_completed',
      data: { tenantId: ctx.tenantId, sessionId, resolved: false },
    });

    return c.json({ success: true as const });
  },
);

// ---- GET /routing-decisions — entity routing history for a customer ---------
//
// Returns the history of agent sessions created for the given customer, ordered
// by most-recent. Backed by the agent_sessions table (real DB, not seed data).
//
// COMPLIANCE: No PHI returned — IDs, agent roles, confidence scores, timestamps only.

agentsRouter.get(
  '/routing-decisions',
  rateLimit('read'),
  requirePermissionMiddleware('agents', 'read'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Agent routes not configured');
    const ctx = ensureTenantContext(c);
    const correlationId = c.get('requestId');

    const customerId = new URL(c.req.url).searchParams.get('customerId');
    if (customerId === null || customerId === '') {
      throw new ValidationError(
        'customerId query parameter is required',
        { customerId: ['Required'] },
        correlationId,
      );
    }

    const decisions = await deps.listRoutingDecisions(ctx.tenantId, customerId, 20);

    return c.json({
      success: true as const,
      data: decisions,
      total: decisions.length,
    });
  },
);

// ---- POST /nba/evaluate — run Next-Best-Action pipeline for a customer -------
//
// Evaluates the 3-layer decision pipeline (Rules → ML → LLM) and returns
// the recommended action. Decision audit entries are written to decision_audit.
//
// COMPLIANCE: Input context must contain NO raw PHI — only tokenized IDs.
// SOC2 CC7.2 — AI decision monitoring. Rule 9 — agent safety.

agentsRouter.post(
  '/nba/evaluate',
  rateLimit('write'),
  requirePermissionMiddleware('agents', 'write'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Agent routes not configured');
    const ctx = ensureTenantContext(c);
    const correlationId = c.get('requestId');

    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = nbaEvaluateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid NBA evaluation parameters',
        parseValidationErrors(parsed.error.issues),
        correlationId,
      );
    }

    const {
      customerId,
      eventType,
      eventPayload,
      customerProfile,
      channelPreferences,
      constraints,
    } = parsed.data;

    const decisionContext: DecisionContext = {
      tenantId: ctx.tenantId,
      customerId,
      eventType,
      eventPayload,
      customerProfile: {
        ltv: customerProfile.ltv,
        healthScore: customerProfile.healthScore,
        lifecycleStage: customerProfile.lifecycleStage,
        segment: customerProfile.segment,
        preferredChannel: customerProfile.preferredChannel,
        outstandingBalance: customerProfile.outstandingBalance,
        maxBalance: customerProfile.maxBalance,
        daysSinceLastContact: customerProfile.daysSinceLastContact,
        sentimentAvg: customerProfile.sentimentAvg,
        responseRate: customerProfile.responseRate,
        totalInteractions30d: customerProfile.totalInteractions30d,
        paymentHistory: [],
      },
      channelPreferences,
      interactionHistory: [],
      constraints: {
        budgetCents: constraints.budgetCents,
        timeWindowMinutes: constraints.timeWindowMinutes,
        blockedChannels: constraints.blockedChannels,
        maxContactsPerWeek: constraints.maxContactsPerWeek,
        maxSmsPerDay: constraints.maxSmsPerDay,
        maxEmailsPerWeek: constraints.maxEmailsPerWeek,
      },
      timestamp: new Date(),
      correlationId,
    };

    const result = await deps.nbaPipeline.evaluate(decisionContext);
    if (!result.success) {
      return c.json(
        {
          success: false as const,
          error: { code: result.error.code, message: result.error.message },
        },
        422,
      );
    }

    const decision = result.data;

    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'agent.decision',
      actorId: ctx.userId,
      actorType: 'user',
      resource: 'nba_decision',
      resourceId: decision.id,
      action: 'evaluate',
      details: {
        customerId,
        action: decision.action,
        channel: decision.channel ?? null,
        confidence: decision.confidence,
        layersUsed: decision.layersUsed,
      },
      timestamp: new Date(),
    });

    return c.json({
      success: true as const,
      data: {
        id: decision.id,
        customerId: decision.customerId,
        action: decision.action,
        channel: decision.channel ?? null,
        confidence: decision.confidence,
        score: decision.score,
        reasoning: decision.reasoning,
        layersUsed: decision.layersUsed,
        evaluatedAt: decision.evaluatedAt.toISOString(),
        expiresAt: decision.expiresAt.toISOString(),
      },
    });
  },
);

// ---- GET /hitl — get pending HITL items for tenant --------------------------

agentsRouter.get('/hitl', rateLimit('read'), requirePermissionMiddleware('agents', 'read'), (c) => {
  if (!deps) throw new Error('[ORDR:API] Agent routes not configured');

  const ctx = ensureTenantContext(c);

  const pending = deps.hitlQueue.getPending(ctx.tenantId);

  return c.json({
    success: true as const,
    data: pending.map((item) => ({
      id: item.id,
      sessionId: item.sessionId,
      decision: {
        action: item.decision.action,
        reasoning: item.decision.reasoning,
        confidence: item.decision.confidence,
        requiresApproval: item.decision.requiresApproval,
      },
      context: item.context,
      createdAt: item.createdAt.toISOString(),
      status: item.status,
    })),
    total: pending.length,
  });
});

// ---- POST /hitl/:id/approve — approve a HITL item --------------------------

agentsRouter.post(
  '/hitl/:id/approve',
  rateLimit('write'),
  requirePermissionMiddleware('agents', 'update'),
  async (c) => {
    if (!deps) throw new Error('[ORDR:API] Agent routes not configured');

    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');
    const itemId = c.req.param('id');

    // Verify item exists
    const item = deps.hitlQueue.getItem(itemId);
    if (!item) {
      throw new NotFoundError('HITL item not found', requestId);
    }

    // Verify item belongs to tenant
    if (item.tenantId !== ctx.tenantId) {
      throw new NotFoundError('HITL item not found', requestId);
    }

    try {
      const decision = deps.hitlQueue.approve(itemId, ctx.userId);

      // Audit log
      await deps.auditLogger.log({
        tenantId: ctx.tenantId,
        eventType: 'agent.action',
        actorType: 'user',
        actorId: ctx.userId,
        resource: 'hitl_item',
        resourceId: itemId,
        action: 'approve',
        details: {
          sessionId: item.sessionId,
          decisionAction: decision.action,
          confidence: decision.confidence,
        },
        timestamp: new Date(),
      });

      // Broadcast SSE — HITL pending count decrements on all connected dashboards
      broadcastEvent({
        type: 'analytics.counters_updated',
        data: { tenantId: ctx.tenantId, event: 'hitl_resolved' },
      });

      return c.json({
        success: true as const,
        data: {
          id: itemId,
          status: 'approved' as const,
          decision: {
            action: decision.action,
            confidence: decision.confidence,
          },
        },
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('not pending')) {
        throw new ValidationError(
          'HITL item is not in pending state',
          {
            status: ['Item has already been reviewed'],
          },
          requestId,
        );
      }
      throw error;
    }
  },
);

// ---- POST /hitl/:id/reject — reject a HITL item ----------------------------

agentsRouter.post(
  '/hitl/:id/reject',
  rateLimit('write'),
  requirePermissionMiddleware('agents', 'update'),
  async (c) => {
    if (!deps) throw new Error('[ORDR:API] Agent routes not configured');

    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');
    const itemId = c.req.param('id');

    // Validate body
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = rejectHitlSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid rejection request',
        parseValidationErrors(parsed.error.issues),
        requestId,
      );
    }

    // Verify item exists
    const item = deps.hitlQueue.getItem(itemId);
    if (!item) {
      throw new NotFoundError('HITL item not found', requestId);
    }

    // Verify item belongs to tenant
    if (item.tenantId !== ctx.tenantId) {
      throw new NotFoundError('HITL item not found', requestId);
    }

    try {
      deps.hitlQueue.reject(itemId, ctx.userId, parsed.data.reason);

      // Audit log
      await deps.auditLogger.log({
        tenantId: ctx.tenantId,
        eventType: 'agent.action',
        actorType: 'user',
        actorId: ctx.userId,
        resource: 'hitl_item',
        resourceId: itemId,
        action: 'reject',
        details: {
          sessionId: item.sessionId,
          decisionAction: item.decision.action,
          reason: parsed.data.reason,
        },
        timestamp: new Date(),
      });

      // Broadcast SSE — HITL pending count decrements on all connected dashboards
      broadcastEvent({
        type: 'analytics.counters_updated',
        data: { tenantId: ctx.tenantId, event: 'hitl_resolved' },
      });

      return c.json({
        success: true as const,
        data: {
          id: itemId,
          status: 'rejected' as const,
          reason: parsed.data.reason,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('not pending')) {
        throw new ValidationError(
          'HITL item is not in pending state',
          {
            status: ['Item has already been reviewed'],
          },
          requestId,
        );
      }
      throw error;
    }
  },
);

export { agentsRouter };
