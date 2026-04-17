/**
 * Decision Engine Query Layer
 *
 * Drizzle-backed aggregation queries for the /api/v1/decision-engine/* endpoints.
 * All queries are tenant-scoped — no cross-tenant data access.
 *
 * SOC2 CC6.1 | ISO 27001 A.8.15 | HIPAA §164.312(b)
 */

import { eq, and, gte, sql, desc, count } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import * as schema from '@ordr/db';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DecisionEngineStats {
  readonly totalToday: number;
  readonly avgLatencyMs: number;
  readonly avgConfidence: number;
  readonly rulesLayerPct: number;
  readonly mlLayerPct: number;
  readonly llmLayerPct: number;
  readonly lowConfidenceCount: number;
  readonly complianceBlockedCount: number;
}

export interface LayerStat {
  readonly layer: 'rules' | 'ml_scorer' | 'llm_reasoner';
  readonly label: string;
  readonly hitCount: number;
  readonly hitRate: number;
  readonly avgLatencyMs: number;
  readonly avgConfidence: number;
}

export interface DecisionLogEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly decisionType: string;
  readonly outcome: 'approved' | 'rejected' | 'escalated' | 'deferred';
  readonly layerReached: 'rules' | 'ml_scorer' | 'llm_reasoner';
  readonly actionSelected: string;
  readonly confidence: number;
  readonly latencyMs: number;
  readonly reasoning: string;
  readonly ruleId: string | null;
  readonly actorId: string;
  readonly complianceGates: readonly {
    readonly ruleId: string;
    readonly regulation: string;
    readonly passed: boolean;
  }[];
  readonly auditEntryIds: readonly string[];
  readonly createdAt: string;
}

export interface ListDecisionLogParams {
  readonly decisionType?: string;
  readonly layer?: string;
  readonly outcome?: string;
  readonly limit?: number;
}

export interface WriteDecisionLogEntry {
  readonly tenantId: string;
  readonly customerId: string;
  readonly decisionType: string;
  readonly outcome: 'approved' | 'rejected' | 'escalated' | 'deferred';
  readonly layerReached: 'rules' | 'ml_scorer' | 'llm_reasoner';
  readonly actionSelected: string;
  readonly confidence: number;
  readonly latencyMs: number;
  readonly reasoning: string;
  readonly ruleId: string | null;
  readonly actorId: string;
  readonly complianceGates: readonly {
    readonly ruleId: string;
    readonly regulation: string;
    readonly passed: boolean;
  }[];
  readonly auditEntryIds: readonly string[];
}

// ── windowStart — 24h ago in UTC ─────────────────────────────────────────────

function windowStart(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

// ── getDecisionStats ──────────────────────────────────────────────────────────

export async function getDecisionStats(
  db: OrdrDatabase,
  tenantId: string,
): Promise<DecisionEngineStats> {
  const since = windowStart();

  const [totals] = await db
    .select({
      total: count(),
      avgLatency: sql<number>`coalesce(avg(latency_ms), 0)`,
      avgConf: sql<number>`coalesce(avg(confidence), 0)`,
      rulesHits: sql<number>`count(*) filter (where layer_reached = 'rules')`,
      mlHits: sql<number>`count(*) filter (where layer_reached = 'ml_scorer')`,
      llmHits: sql<number>`count(*) filter (where layer_reached = 'llm_reasoner')`,
      lowConf: sql<number>`count(*) filter (where confidence < 0.7)`,
      blocked: sql<number>`count(*) filter (where outcome = 'rejected')`,
    })
    .from(schema.decisionLog)
    .where(
      and(eq(schema.decisionLog.tenantId, tenantId), gte(schema.decisionLog.createdAt, since)),
    );

  const total = totals?.total ?? 0;
  const rulesHits = totals?.rulesHits ?? 0;
  const mlHits = totals?.mlHits ?? 0;
  const llmHits = totals?.llmHits ?? 0;

  return {
    totalToday: total,
    avgLatencyMs: Math.round(totals?.avgLatency ?? 0),
    avgConfidence: Number((totals?.avgConf ?? 0).toFixed(3)),
    rulesLayerPct: total > 0 ? Math.round((rulesHits / total) * 100) : 0,
    mlLayerPct: total > 0 ? Math.round((mlHits / total) * 100) : 0,
    llmLayerPct: total > 0 ? Math.round((llmHits / total) * 100) : 0,
    lowConfidenceCount: totals?.lowConf ?? 0,
    complianceBlockedCount: totals?.blocked ?? 0,
  };
}

// ── getLayerStats ─────────────────────────────────────────────────────────────

const LAYER_LABELS: Record<string, string> = {
  rules: 'Rules Engine',
  ml_scorer: 'ML Scorer',
  llm_reasoner: 'LLM Reasoner',
};

export async function getLayerStats(
  db: OrdrDatabase,
  tenantId: string,
): Promise<readonly LayerStat[]> {
  const since = windowStart();

  const rows = await db
    .select({
      layer: schema.decisionLog.layerReached,
      hitCount: count(),
      avgLatency: sql<number>`coalesce(avg(latency_ms), 0)`,
      avgConf: sql<number>`coalesce(avg(confidence), 0)`,
    })
    .from(schema.decisionLog)
    .where(and(eq(schema.decisionLog.tenantId, tenantId), gte(schema.decisionLog.createdAt, since)))
    .groupBy(schema.decisionLog.layerReached);

  const total = rows.reduce((sum, r) => sum + r.hitCount, 0);

  const layerOrder: Array<'rules' | 'ml_scorer' | 'llm_reasoner'> = [
    'rules',
    'ml_scorer',
    'llm_reasoner',
  ];

  return layerOrder.map((layer) => {
    const row = rows.find((r) => r.layer === layer);
    const hitCount = row?.hitCount ?? 0;
    return {
      layer,
      label: LAYER_LABELS[layer] ?? layer,
      hitCount,
      hitRate: total > 0 ? Math.round((hitCount / total) * 100) : 0,
      avgLatencyMs: Math.round(row?.avgLatency ?? 0),
      avgConfidence: Number((row?.avgConf ?? 0).toFixed(3)),
    };
  });
}

// ── listDecisionLog ───────────────────────────────────────────────────────────

export async function listDecisionLog(
  db: OrdrDatabase,
  tenantId: string,
  params: ListDecisionLogParams,
): Promise<readonly DecisionLogEntry[]> {
  const conditions = [eq(schema.decisionLog.tenantId, tenantId)];

  if (params.decisionType !== undefined && params.decisionType !== '') {
    conditions.push(eq(schema.decisionLog.decisionType, params.decisionType));
  }
  if (params.layer !== undefined && params.layer !== '') {
    conditions.push(
      eq(schema.decisionLog.layerReached, params.layer as 'rules' | 'ml_scorer' | 'llm_reasoner'),
    );
  }
  if (params.outcome !== undefined && params.outcome !== '') {
    conditions.push(
      eq(
        schema.decisionLog.outcome,
        params.outcome as 'approved' | 'rejected' | 'escalated' | 'deferred',
      ),
    );
  }

  const rows = await db
    .select()
    .from(schema.decisionLog)
    .where(and(...conditions))
    .orderBy(desc(schema.decisionLog.createdAt))
    .limit(Math.min(params.limit ?? 50, 200));

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    decisionType: row.decisionType,
    outcome: row.outcome as 'approved' | 'rejected' | 'escalated' | 'deferred',
    layerReached: row.layerReached as 'rules' | 'ml_scorer' | 'llm_reasoner',
    actionSelected: row.actionSelected,
    confidence: row.confidence,
    latencyMs: row.latencyMs,
    reasoning: row.reasoning,
    ruleId: row.ruleId ?? null,
    actorId: row.actorId,
    complianceGates: row.complianceGates as readonly {
      ruleId: string;
      regulation: string;
      passed: boolean;
    }[],
    auditEntryIds: row.auditEntryIds as readonly string[],
    createdAt: row.createdAt.toISOString(),
  }));
}

// ── writeDecisionLog ──────────────────────────────────────────────────────────

export async function writeDecisionLog(
  db: OrdrDatabase,
  entry: WriteDecisionLogEntry,
): Promise<void> {
  await db.insert(schema.decisionLog).values({
    tenantId: entry.tenantId,
    customerId: entry.customerId,
    decisionType: entry.decisionType,
    outcome: entry.outcome,
    layerReached: entry.layerReached,
    actionSelected: entry.actionSelected,
    confidence: entry.confidence,
    latencyMs: entry.latencyMs,
    reasoning: entry.reasoning,
    ruleId: entry.ruleId ?? null,
    actorId: entry.actorId,
    complianceGates: entry.complianceGates as unknown,
    auditEntryIds: entry.auditEntryIds as unknown,
  });
}
