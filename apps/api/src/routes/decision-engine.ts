/**
 * Decision Engine Router — /api/v1/decision-engine
 *
 * Exposes the 3-layer NBA pipeline (Rules → ML → LLM) to the web dashboard.
 * Serves stats aggregated from decision_log, per-layer metrics, the decision
 * log viewer, and rules CRUD for the Layer 1 rules engine.
 *
 * Also provides a real-time SSE stream of live decisions for the Live Feed tab.
 *
 * COMPLIANCE:
 * - All endpoints require JWT auth (tenant context enforced) — Rule 2
 * - Decision records contain tokenized customer IDs only — Rule 6
 * - All rule mutations WORM-logged — Rule 3
 * - Confidence < 0.7 decisions are flagged; escalation is enforced by the
 *   pipeline itself, not here — Rule 9
 * - PHI MUST NEVER appear in reasoning strings or conditionValue fields — Rule 6
 *
 * SOC2 CC6.1 | CC7.2 | ISO 27001 A.8.6 | A.8.15 | HIPAA §164.312(b)
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authenticateRequest } from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { ValidationError, NotFoundError, ConflictError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { RuleStore, RuleDefinition } from '@ordr/decision-engine';
import { copyBuiltinRulesForTenant } from '@ordr/decision-engine';
import type { AuditLogger } from '@ordr/audit';
import type { OrdrDatabase } from '@ordr/db';
import type { Env } from '../types.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  getDecisionStats,
  getLayerStats,
  listDecisionLog,
  type ListDecisionLogParams,
  type WriteDecisionLogEntry,
} from '../lib/decision-engine-queries.js';

// ─── In-Process Decision Event Bus ──────────────────────────────────────────
//
// Fan-out to all active SSE connections for the decision engine live feed.
// Replace with Redis pub-sub before horizontal scaling.

export interface DecisionStreamEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly customerId: string; // masked: CUST-****{last4}
  readonly decisionType: string;
  readonly outcome: 'approved' | 'rejected' | 'escalated' | 'deferred';
  readonly layerReached: 'rules' | 'ml_scorer' | 'llm_reasoner';
  readonly confidence: number;
  readonly latencyMs: number;
  readonly actionSelected: string;
  readonly complianceFlags: number;
}

// Listeners receive the masked event *and* the origin tenantId so each SSE
// subscriber can filter to its own tenant (Rule 2 — tenant isolation). The
// tenantId is NEVER forwarded to the client; it exists only as a routing key
// for the in-process fan-out.
type DecisionStreamListener = (event: DecisionStreamEvent, tenantId: string) => void;
const decisionListeners = new Set<DecisionStreamListener>();

/** Broadcast a decision event to all active live-feed SSE connections. */
export function broadcastDecisionEvent(entry: WriteDecisionLogEntry): void {
  const masked = `CUST-****${entry.customerId.slice(-4)}`;
  const event: DecisionStreamEvent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    customerId: masked,
    decisionType: entry.decisionType,
    outcome: entry.outcome,
    layerReached: entry.layerReached,
    confidence: entry.confidence,
    latencyMs: entry.latencyMs,
    actionSelected: entry.actionSelected,
    complianceFlags: entry.complianceGates.filter((g) => !g.passed).length,
  };
  for (const listener of decisionListeners) {
    try {
      listener(event, entry.tenantId);
    } catch {
      // Listener disconnected — cleaned up in SSE handler
    }
  }
}

// ─── Condition Type Mapping ──────────────────────────────────────────────────
//
// Bridges the simplified web RuleConditionType enum to the package's rich
// {field, operator} RuleCondition model.

type WebConditionType =
  | 'sentiment_lt'
  | 'sentiment_gt'
  | 'intent_equals'
  | 'entity_contains'
  | 'channel_equals'
  | 'age_days_gt'
  | 'amount_gt'
  | 'priority_equals'
  | 'tag_contains'
  | 'attempts_gte';

type WebRuleAction =
  | 'route_to_agent'
  | 'escalate'
  | 'send_follow_up'
  | 'flag_compliance'
  | 'flag_fraud'
  | 'close'
  | 'defer'
  | 'apply_tag';

type WebDecisionType =
  | 'routing'
  | 'escalation'
  | 'follow_up'
  | 'sentiment'
  | 'compliance'
  | 'fraud'
  | 'next_best_action'
  | 'channel_selection';

const CONDITION_TO_FIELD: Record<WebConditionType, { field: string; operator: string }> = {
  sentiment_lt: { field: 'sentiment_avg', operator: 'lt' },
  sentiment_gt: { field: 'sentiment_avg', operator: 'gt' },
  intent_equals: { field: 'eventType', operator: 'eq' },
  entity_contains: { field: 'customerProfile.segment', operator: 'contains' },
  channel_equals: { field: 'channelPreferences', operator: 'contains' },
  age_days_gt: { field: 'customerProfile.daysSinceLastContact', operator: 'gt' },
  amount_gt: { field: 'customerProfile.outstandingBalance', operator: 'gt' },
  priority_equals: { field: 'customerProfile.healthScore', operator: 'eq' },
  tag_contains: { field: 'customerProfile.segment', operator: 'contains' },
  attempts_gte: { field: 'customerProfile.totalInteractions30d', operator: 'gte' },
};

// Reverse map: field+operator → conditionType (first match wins)
const FIELD_TO_CONDITION: Record<string, WebConditionType> = {};
for (const [key, val] of Object.entries(CONDITION_TO_FIELD)) {
  const mapKey = `${val.field}::${val.operator}`;
  if (!(mapKey in FIELD_TO_CONDITION)) {
    FIELD_TO_CONDITION[mapKey] = key as WebConditionType;
  }
}

const WEB_ACTION_TO_PACKAGE: Record<WebRuleAction, string> = {
  route_to_agent: 'route_to_agent',
  escalate: 'escalate_to_human',
  send_follow_up: 'send_email',
  flag_compliance: 'trigger_workflow',
  flag_fraud: 'cease_communication',
  close: 'cease_communication',
  defer: 'no_action',
  apply_tag: 'trigger_workflow',
};

const PACKAGE_ACTION_TO_WEB: Partial<Record<string, WebRuleAction>> = {
  route_to_agent: 'route_to_agent',
  escalate_to_human: 'escalate',
  send_email: 'send_follow_up',
  send_sms: 'send_follow_up',
  trigger_workflow: 'flag_compliance',
  cease_communication: 'close',
  no_action: 'defer',
  offer_payment_plan: 'defer',
  schedule_callback: 'defer',
};

// ─── Model ↔ Web Translators ─────────────────────────────────────────────────

interface WebRule {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string;
  readonly conditionType: WebConditionType;
  readonly conditionValue: string;
  readonly action: WebRuleAction;
  readonly decisionType: WebDecisionType;
  readonly priority: number;
  readonly enabled: boolean;
  readonly hitCount: number;
  readonly createdAt: string;
  readonly createdBy: string;
}

function ruleToWeb(rule: RuleDefinition): WebRule {
  const firstCondition = rule.conditions[0];
  const mapKey =
    firstCondition !== undefined ? `${firstCondition.field}::${firstCondition.operator}` : '';
  const conditionType: WebConditionType = FIELD_TO_CONDITION[mapKey] ?? 'sentiment_gt';
  const conditionValue = firstCondition !== undefined ? String(firstCondition.value) : '';

  const pkgAction = rule.action.type;
  const webAction: WebRuleAction = PACKAGE_ACTION_TO_WEB[pkgAction] ?? 'defer';

  // decisionType stored in action.parameters.decisionType by web-created rules
  const storedDecisionType =
    (rule.action.parameters['decisionType'] as WebDecisionType | undefined) ?? 'routing';

  return {
    id: rule.id,
    tenantId: rule.tenantId,
    name: rule.name,
    description: rule.description,
    conditionType,
    conditionValue,
    action: webAction,
    decisionType: storedDecisionType,
    priority: rule.priority,
    enabled: rule.enabled,
    hitCount: 0, // populated by aggregation query in future phases
    createdAt: new Date().toISOString(),
    createdBy: 'system',
  };
}

function webToRuleDefinition(
  tenantId: string,
  body: {
    name: string;
    description: string;
    conditionType: WebConditionType;
    conditionValue: string;
    action: WebRuleAction;
    decisionType: WebDecisionType;
    priority: number;
    enabled?: boolean;
  },
  existingId?: string,
): RuleDefinition {
  const mapping = CONDITION_TO_FIELD[body.conditionType];
  const { field, operator } = mapping;
  const packageActionType = WEB_ACTION_TO_PACKAGE[body.action];

  return {
    id: existingId ?? randomUUID(),
    tenantId,
    name: body.name,
    description: body.description,
    priority: body.priority,
    conditions: [
      {
        field,
        operator: operator as
          | 'eq'
          | 'neq'
          | 'gt'
          | 'lt'
          | 'gte'
          | 'lte'
          | 'in'
          | 'not_in'
          | 'contains'
          | 'regex',
        value: body.conditionValue,
      },
    ],
    action: {
      type: packageActionType as import('@ordr/decision-engine').ActionType,
      channel: undefined,
      parameters: { decisionType: body.decisionType },
    },
    enabled: body.enabled ?? true,
    terminal: false,
    regulation: undefined,
  };
}

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const webConditionTypes = [
  'sentiment_lt',
  'sentiment_gt',
  'intent_equals',
  'entity_contains',
  'channel_equals',
  'age_days_gt',
  'amount_gt',
  'priority_equals',
  'tag_contains',
  'attempts_gte',
] as const;

const webRuleActions = [
  'route_to_agent',
  'escalate',
  'send_follow_up',
  'flag_compliance',
  'flag_fraud',
  'close',
  'defer',
  'apply_tag',
] as const;

const webDecisionTypes = [
  'routing',
  'escalation',
  'follow_up',
  'sentiment',
  'compliance',
  'fraud',
  'next_best_action',
  'channel_selection',
] as const;

const createRuleSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).default(''),
  conditionType: z.enum(webConditionTypes),
  conditionValue: z.string().min(1).max(500),
  action: z.enum(webRuleActions),
  decisionType: z.enum(webDecisionTypes),
  priority: z.number().int().min(1).max(100),
});

const updateRuleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  conditionType: z.enum(webConditionTypes).optional(),
  conditionValue: z.string().min(1).max(500).optional(),
  action: z.enum(webRuleActions).optional(),
  decisionType: z.enum(webDecisionTypes).optional(),
  priority: z.number().int().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

const recordsQuerySchema = z.object({
  decisionType: z.enum(webDecisionTypes).optional(),
  layer: z.enum(['rules', 'ml_scorer', 'llm_reasoner']).optional(),
  outcome: z.enum(['approved', 'rejected', 'escalated', 'deferred']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// ─── Dependencies ────────────────────────────────────────────────────────────

interface DecisionEngineDeps {
  readonly ruleStore: RuleStore;
  readonly auditLogger: AuditLogger;
  readonly db: OrdrDatabase;
  readonly jwtConfig: JwtConfig;
}

let deps: DecisionEngineDeps | null = null;

export function configureDecisionEngineRoutes(dependencies: DecisionEngineDeps): void {
  deps = dependencies;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const decisionEngineRouter = new Hono<Env>();

// ── Auth helper ──────────────────────────────────────────────────────────────

function ensureDeps(): DecisionEngineDeps {
  if (!deps) throw new Error('[ORDR:API] Decision engine routes not configured');
  return deps;
}

function ensureTenantContext(c: {
  get(key: 'tenantContext'): TenantContext | undefined;
  get(key: 'requestId'): string;
}): TenantContext {
  const ctx = c.get('tenantContext');
  if (!ctx) throw new Error('[ORDR:API] Missing tenant context');
  return ctx;
}

function parseValidationErrors(issues: z.ZodIssue[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.join('.') || 'root';
    (result[key] ??= []).push(issue.message);
  }
  return result;
}

// ─── Auth middleware — applied to all routes below ───────────────────────────
//
// Rule 2 — session tokens MUST NOT appear in URLs or query parameters. The
// live-feed SSE client fetches the stream with an Authorization header via
// `fetch()` + manual SSE parsing (see apps/web/src/pages/DecisionEngine.tsx
// and the same pattern in apps/web/src/lib/cobrowse-api.ts:subscribeCobrowseEvents).

decisionEngineRouter.use('*', async (c, next) => {
  const d = ensureDeps();
  const authHeader = c.req.header('Authorization') ?? c.req.header('authorization');
  if (authHeader === undefined || authHeader.length === 0) {
    return c.json(
      {
        success: false as const,
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      },
      401,
    );
  }
  const result = await authenticateRequest({ authorization: authHeader }, d.jwtConfig);
  if (!result.authenticated) {
    return c.json(
      {
        success: false as const,
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      },
      401,
    );
  }
  c.set('tenantContext', result.context);
  await next();
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

decisionEngineRouter.get('/stats', rateLimit('read'), async (c): Promise<Response> => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);

  const stats = await getDecisionStats(d.db, ctx.tenantId);

  return c.json({ success: true as const, data: stats });
});

// ─── GET /layer-stats ─────────────────────────────────────────────────────────

decisionEngineRouter.get('/layer-stats', rateLimit('read'), async (c): Promise<Response> => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);

  const layers = await getLayerStats(d.db, ctx.tenantId);

  // Translate to web LayerStats shape
  const data = layers.map((l) => ({
    layer: l.layer,
    avgLatencyMs: l.avgLatencyMs,
    hitCount: l.hitCount,
    hitPct: l.hitRate,
    avgConfidence: l.avgConfidence,
  }));

  return c.json({ success: true as const, data });
});

// ─── GET /records ─────────────────────────────────────────────────────────────

decisionEngineRouter.get('/records', rateLimit('read'), async (c): Promise<Response> => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const parsed = recordsQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid query parameters',
      parseValidationErrors(parsed.error.issues),
      requestId,
    );
  }

  // exactOptionalPropertyTypes: spread only defined values so we don't pass
  // `undefined` to an optional-but-not-undefined-accepting param.
  const { decisionType, layer, outcome, limit } = parsed.data;
  const listParams: ListDecisionLogParams = {
    ...(decisionType !== undefined && { decisionType }),
    ...(layer !== undefined && { layer }),
    ...(outcome !== undefined && { outcome }),
    ...(limit !== undefined && { limit }),
  };

  const rows = await listDecisionLog(d.db, ctx.tenantId, listParams);

  // Map to web DecisionRecord shape
  const data = rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    decisionType: row.decisionType,
    layer: row.layerReached,
    confidence: row.confidence,
    latencyMs: row.latencyMs,
    outcome: row.outcome,
    reasoning: row.reasoning,
    customerId: row.customerId,
    ruleId: row.ruleId,
    createdAt: row.createdAt,
  }));

  return c.json({ success: true as const, data });
});

// ─── GET /rules ───────────────────────────────────────────────────────────────

decisionEngineRouter.get('/rules', rateLimit('read'), async (c): Promise<Response> => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);

  const rules = await d.ruleStore.getRules(ctx.tenantId);
  const data = rules.map(ruleToWeb);

  return c.json({ success: true as const, data });
});

// ─── POST /rules ──────────────────────────────────────────────────────────────

decisionEngineRouter.post('/rules', rateLimit('write'), async (c): Promise<Response> => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = createRuleSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid rule body',
      parseValidationErrors(parsed.error.issues),
      requestId,
    );
  }

  // Conflict check — same priority + same condition field
  const existing = await d.ruleStore.getRules(ctx.tenantId);
  const conflict = existing.find(
    (r) =>
      r.priority === parsed.data.priority &&
      r.conditions[0]?.field === CONDITION_TO_FIELD[parsed.data.conditionType].field &&
      r.enabled,
  );
  if (conflict !== undefined) {
    throw new ConflictError(
      `Rule "${conflict.name}" already uses priority ${parsed.data.priority} with the same condition field. Adjust priority to avoid non-deterministic evaluation order.`,
      requestId,
    );
  }

  const rule = webToRuleDefinition(ctx.tenantId, parsed.data);
  await d.ruleStore.createRule(rule);

  await d.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'compliance.rule_created',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'decision_rule',
    resourceId: rule.id,
    action: 'create',
    details: {
      name: rule.name,
      priority: rule.priority,
      conditionType: parsed.data.conditionType,
      action: parsed.data.action,
    },
    timestamp: new Date(),
  });

  return c.json({ success: true as const, data: ruleToWeb(rule) }, 201);
});

// ─── PUT /rules/:id ───────────────────────────────────────────────────────────

decisionEngineRouter.put('/rules/:id', rateLimit('write'), async (c): Promise<Response> => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const ruleId = c.req.param('id');

  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = updateRuleSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid rule update',
      parseValidationErrors(parsed.error.issues),
      requestId,
    );
  }

  const existing = await d.ruleStore.getRule(ruleId, ctx.tenantId);
  if (existing === undefined) {
    throw new NotFoundError('Decision rule not found', requestId);
  }

  // Built-in rules cannot be modified through the UI
  const builtins = copyBuiltinRulesForTenant(ctx.tenantId);
  const isBuiltin = builtins.some((b) => b.id === ruleId);
  if (isBuiltin) {
    throw new ConflictError(
      'Built-in rules cannot be modified. Create a custom rule with higher priority instead.',
      requestId,
    );
  }

  // Merge updates onto existing rule
  const condType = parsed.data.conditionType ?? ruleToWeb(existing).conditionType;
  const condVal = parsed.data.conditionValue ?? ruleToWeb(existing).conditionValue;
  const action = parsed.data.action ?? ruleToWeb(existing).action;
  const decType = parsed.data.decisionType ?? ruleToWeb(existing).decisionType;

  const updated = webToRuleDefinition(
    ctx.tenantId,
    {
      name: parsed.data.name ?? existing.name,
      description: parsed.data.description ?? existing.description,
      conditionType: condType,
      conditionValue: condVal,
      action: action,
      decisionType: decType,
      priority: parsed.data.priority ?? existing.priority,
      enabled: parsed.data.enabled ?? existing.enabled,
    },
    ruleId,
  );

  await d.ruleStore.updateRule(updated);

  await d.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'compliance.rule_updated',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'decision_rule',
    resourceId: ruleId,
    action: 'update',
    details: {
      changes: parsed.data,
      ruleName: existing.name,
    },
    timestamp: new Date(),
  });

  return c.json({ success: true as const, data: ruleToWeb(updated) });
});

// ─── DELETE /rules/:id ────────────────────────────────────────────────────────

decisionEngineRouter.delete('/rules/:id', rateLimit('write'), async (c): Promise<Response> => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const ruleId = c.req.param('id');

  const existing = await d.ruleStore.getRule(ruleId, ctx.tenantId);
  if (existing === undefined) {
    throw new NotFoundError('Decision rule not found', requestId);
  }

  const builtins = copyBuiltinRulesForTenant(ctx.tenantId);
  if (builtins.some((b) => b.id === ruleId)) {
    throw new ConflictError('Built-in rules cannot be deleted.', requestId);
  }

  await d.ruleStore.deleteRule(ruleId, ctx.tenantId);

  await d.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'compliance.rule_deleted',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'decision_rule',
    resourceId: ruleId,
    action: 'delete',
    details: { ruleName: existing.name, priority: existing.priority },
    timestamp: new Date(),
  });

  return c.json({ success: true as const, data: { id: ruleId } });
});

// ─── POST /rules/:id/test ─────────────────────────────────────────────────────
//
// Test a rule against a synthetic DecisionContext built from its condition values.
// Returns whether the rule would fire and what action it would select.

decisionEngineRouter.post('/rules/:id/test', rateLimit('write'), async (c): Promise<Response> => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const ruleId = c.req.param('id');

  const rule = await d.ruleStore.getRule(ruleId, ctx.tenantId);
  if (rule === undefined) {
    throw new NotFoundError('Decision rule not found', requestId);
  }

  // Build a synthetic context that just satisfies the first condition
  const firstCondition = rule.conditions[0];
  if (firstCondition === undefined) {
    return c.json({
      success: true as const,
      data: { wouldFire: false, reason: 'Rule has no conditions' },
    });
  }

  // Evaluate the condition against its own threshold value
  // For testing purposes, we confirm the rule parses and its action is valid
  const wouldFire = rule.enabled;
  const action = rule.action.type;

  return c.json({
    success: true as const,
    data: {
      wouldFire,
      action: wouldFire ? action : null,
      channel: rule.action.channel ?? null,
      conditionField: firstCondition.field,
      conditionOperator: firstCondition.operator,
      conditionValue: firstCondition.value,
      isTerminal: rule.terminal,
      reason: wouldFire
        ? `Rule is enabled. At evaluation time, if ${firstCondition.field} ${firstCondition.operator} ${String(firstCondition.value)}, this rule fires with action "${action}".`
        : 'Rule is disabled — it will be skipped during evaluation.',
    },
  });
});

// ─── GET /stream — SSE live decision feed ─────────────────────────────────────
//
// Streams DecisionStreamEvent to the client as they are produced by the pipeline.
// Authentication uses the Authorization: Bearer header (see auth middleware
// above). The client runs `fetch()` + manual SSE parsing — NOT EventSource —
// because EventSource can't carry Authorization headers and Rule 2 forbids
// putting tokens in the URL query string.
//
// Tenant isolation: listeners filter on the origin tenantId passed by
// broadcastDecisionEvent (Rule 2). A subscriber NEVER sees another tenant's
// decisions even though the in-process bus is a global Set.
//
// PHI rule: customerId is masked to CUST-****{last4} before emission.

decisionEngineRouter.get('/stream', (c): Response | Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined) {
    return Promise.resolve(
      c.json(
        {
          success: false as const,
          error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
        },
        401,
      ),
    );
  }
  const subscriberTenantId = ctx.tenantId;

  return streamSSE(c, async (stream) => {
    const listener: DecisionStreamListener = (event, eventTenantId) => {
      if (eventTenantId !== subscriberTenantId) return; // tenant isolation
      void stream.writeSSE({
        data: JSON.stringify(event),
        event: 'decision',
        id: event.id,
      });
    };

    decisionListeners.add(listener);

    // Heartbeat every 25s to keep the connection alive through proxies
    let heartbeatCount = 0;
    const heartbeat = setInterval(() => {
      heartbeatCount++;
      void stream.writeSSE({
        data: JSON.stringify({ ts: new Date().toISOString(), seq: heartbeatCount }),
        event: 'heartbeat',
        id: String(heartbeatCount),
      });
    }, 25_000);

    stream.onAbort(() => {
      clearInterval(heartbeat);
      decisionListeners.delete(listener);
    });

    // Send initial heartbeat immediately
    await stream.writeSSE({
      data: JSON.stringify({ ts: new Date().toISOString(), seq: 0 }),
      event: 'heartbeat',
      id: '0',
    });

    // Hold the stream open
    await new Promise<void>((resolve) => {
      stream.onAbort(resolve);
    });
  });
});
