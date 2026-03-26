/**
 * Predefined analytics queries — tenant-isolated OLAP query library
 *
 * SECURITY:
 * - ALL queries enforce tenantId — no cross-tenant data access (SOC2 CC6.1)
 * - Query parameters are NEVER logged (PII/PHI risk)
 * - Parameterized queries ONLY — zero string concatenation
 * - Time ranges are validated before execution
 *
 * ISO 27001 A.9.4.1 — Information access restriction: tenant boundary enforced.
 * HIPAA §164.312(a)(1) — Access control: aggregated metrics only, no raw PHI.
 */

import {
  type Result,
  ok,
  err,
  ValidationError,
} from '@ordr/core';
import type { AppError } from '@ordr/core';
import type { AnalyticsStore } from './client.js';
import type {
  TimeRange,
  ChannelMetrics,
  AgentMetrics,
  ComplianceMetrics,
  DashboardSummary,
  MetricValue,
  MetricName,
} from './types.js';

// ─── Analytics Queries ───────────────────────────────────────────

export class AnalyticsQueries {
  private readonly store: AnalyticsStore;

  constructor(store: AnalyticsStore) {
    this.store = store;
  }

  /**
   * Get delivery metrics per channel for a time range.
   * Aggregates sent/delivered/failed counts by channel.
   */
  async getChannelMetrics(
    tenantId: string,
    timeRange: TimeRange,
  ): Promise<Result<readonly ChannelMetrics[], AppError>> {
    const validation = validateQueryInputs(tenantId, timeRange);
    if (validation !== null) return validation as Result<readonly ChannelMetrics[], AppError>;

    const result = await this.store.query<{
      channel: string;
      metric: string;
      value: number;
      dimensions: Record<string, string>;
    }>(
      'SELECT * FROM metrics WHERE tenant_id = {tenantId:String} AND metric IN ({metrics:Array(String)}) AND timestamp >= {from:DateTime} AND timestamp <= {to:DateTime}',
      {
        tenantId,
        metrics: ['messages_sent', 'messages_delivered', 'messages_failed', 'cost_per_interaction'],
        from: timeRange.from,
        to: timeRange.to,
      },
      tenantId,
    );

    if (!result.success) return result as Result<readonly ChannelMetrics[], AppError>;

    // Aggregate by channel
    const channelMap = new Map<string, { sent: number; delivered: number; failed: number; totalCost: number; costCount: number }>();

    for (const row of result.data) {
      const channel = row.dimensions?.['channel'] ?? 'unknown';
      const existing = channelMap.get(channel) ?? { sent: 0, delivered: 0, failed: 0, totalCost: 0, costCount: 0 };

      switch (row.metric) {
        case 'messages_sent':
          existing.sent += row.value;
          break;
        case 'messages_delivered':
          existing.delivered += row.value;
          break;
        case 'messages_failed':
          existing.failed += row.value;
          break;
        case 'cost_per_interaction':
          existing.totalCost += row.value;
          existing.costCount += 1;
          break;
      }

      channelMap.set(channel, existing);
    }

    const metrics: ChannelMetrics[] = [];
    for (const [channel, data] of channelMap) {
      const total = data.sent + data.delivered + data.failed;
      metrics.push({
        channel,
        sent: data.sent,
        delivered: data.delivered,
        failed: data.failed,
        deliveryRate: total > 0 ? data.delivered / total : 0,
        avgCost: data.costCount > 0 ? data.totalCost / data.costCount : 0,
      });
    }

    return ok(metrics);
  }

  /**
   * Get agent performance metrics for a time range.
   * Aggregates sessions, resolutions, confidence, cost, and duration by agent role.
   */
  async getAgentMetrics(
    tenantId: string,
    timeRange: TimeRange,
  ): Promise<Result<readonly AgentMetrics[], AppError>> {
    const validation = validateQueryInputs(tenantId, timeRange);
    if (validation !== null) return validation as Result<readonly AgentMetrics[], AppError>;

    const result = await this.store.query<{
      metric: string;
      value: number;
      dimensions: Record<string, string>;
    }>(
      'SELECT * FROM metrics WHERE tenant_id = {tenantId:String} AND metric IN ({metrics:Array(String)}) AND timestamp >= {from:DateTime} AND timestamp <= {to:DateTime}',
      {
        tenantId,
        metrics: ['agent_sessions', 'agent_resolutions', 'avg_response_time', 'cost_per_interaction'],
        from: timeRange.from,
        to: timeRange.to,
      },
      tenantId,
    );

    if (!result.success) return result as Result<readonly AgentMetrics[], AppError>;

    // Aggregate by agent_role
    const roleMap = new Map<string, {
      sessions: number;
      resolutions: number;
      totalConfidence: number;
      totalSteps: number;
      totalCost: number;
      totalDuration: number;
      durationCount: number;
    }>();

    for (const row of result.data) {
      const role = row.dimensions?.['agent_role'] ?? 'unknown';
      const existing = roleMap.get(role) ?? {
        sessions: 0,
        resolutions: 0,
        totalConfidence: 0,
        totalSteps: 0,
        totalCost: 0,
        totalDuration: 0,
        durationCount: 0,
      };

      switch (row.metric) {
        case 'agent_sessions': {
          existing.sessions += row.value;
          const conf = parseFloat(row.dimensions?.['confidence'] ?? '0');
          existing.totalConfidence += conf;
          break;
        }
        case 'agent_resolutions':
          existing.resolutions += row.value;
          break;
        case 'avg_response_time': {
          existing.totalDuration += row.value;
          existing.durationCount += 1;
          const steps = parseInt(row.dimensions?.['steps'] ?? '0', 10);
          existing.totalSteps += steps;
          break;
        }
        case 'cost_per_interaction':
          existing.totalCost += row.value;
          break;
      }

      roleMap.set(role, existing);
    }

    const metrics: AgentMetrics[] = [];
    for (const [role, data] of roleMap) {
      metrics.push({
        agentRole: role,
        sessions: data.sessions,
        resolutions: data.resolutions,
        resolutionRate: data.sessions > 0 ? data.resolutions / data.sessions : 0,
        avgConfidence: data.sessions > 0 ? data.totalConfidence / data.sessions : 0,
        avgSteps: data.durationCount > 0 ? data.totalSteps / data.durationCount : 0,
        avgCostCents: data.sessions > 0 ? data.totalCost / data.sessions : 0,
        avgDurationMs: data.durationCount > 0 ? data.totalDuration / data.durationCount : 0,
      });
    }

    return ok(metrics);
  }

  /**
   * Get compliance metrics for a time range.
   * Aggregates check/violation counts by regulation.
   */
  async getComplianceMetrics(
    tenantId: string,
    timeRange: TimeRange,
  ): Promise<Result<readonly ComplianceMetrics[], AppError>> {
    const validation = validateQueryInputs(tenantId, timeRange);
    if (validation !== null) return validation as Result<readonly ComplianceMetrics[], AppError>;

    const result = await this.store.query<{
      metric: string;
      value: number;
      dimensions: Record<string, string>;
    }>(
      'SELECT * FROM metrics WHERE tenant_id = {tenantId:String} AND metric IN ({metrics:Array(String)}) AND timestamp >= {from:DateTime} AND timestamp <= {to:DateTime}',
      {
        tenantId,
        metrics: ['compliance_violations'],
        from: timeRange.from,
        to: timeRange.to,
      },
      tenantId,
    );

    if (!result.success) return result as Result<readonly ComplianceMetrics[], AppError>;

    // Aggregate by regulation
    const regMap = new Map<string, { checks: number; violations: number }>();

    for (const row of result.data) {
      const regulation = row.dimensions?.['regulation'] ?? 'unknown';
      const existing = regMap.get(regulation) ?? { checks: 0, violations: 0 };

      // Each compliance event represents a check
      existing.checks += 1;
      if (row.metric === 'compliance_violations') {
        existing.violations += row.value;
      }

      regMap.set(regulation, existing);
    }

    const metrics: ComplianceMetrics[] = [];
    for (const [regulation, data] of regMap) {
      metrics.push({
        regulation,
        checks: data.checks,
        violations: data.violations,
        complianceRate: data.checks > 0 ? 1 - data.violations / data.checks : 1,
      });
    }

    return ok(metrics);
  }

  /**
   * Get a full dashboard summary for a tenant.
   * Combines channel, agent, and compliance metrics with totals.
   */
  async getDashboardSummary(
    tenantId: string,
  ): Promise<Result<DashboardSummary, AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(
        new ValidationError('tenantId is required', {
          tenantId: ['tenantId must be a non-empty string'],
        }),
      );
    }

    // Use last 30 days as dashboard time range
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const timeRange: TimeRange = {
      from: thirtyDaysAgo,
      to: now,
      granularity: 'day',
    };

    const [channelResult, agentResult, complianceResult] = await Promise.all([
      this.getChannelMetrics(tenantId, timeRange),
      this.getAgentMetrics(tenantId, timeRange),
      this.getComplianceMetrics(tenantId, timeRange),
    ]);

    const channelMetrics = channelResult.success ? channelResult.data : [];
    const agentMetrics = agentResult.success ? agentResult.data : [];
    const complianceMetrics = complianceResult.success ? complianceResult.data : [];

    // Calculate totals
    let totalRevenue = 0;
    let totalChecks = 0;
    let totalViolations = 0;

    for (const cm of complianceMetrics) {
      totalChecks += cm.checks;
      totalViolations += cm.violations;
    }

    // Query revenue metric separately
    const revenueResult = await this.store.query<{ value: number }>(
      'SELECT * FROM metrics WHERE tenant_id = {tenantId:String} AND metric = {metric:String} AND timestamp >= {from:DateTime} AND timestamp <= {to:DateTime}',
      { tenantId, metric: 'revenue_collected', from: timeRange.from, to: timeRange.to },
      tenantId,
    );

    if (revenueResult.success) {
      for (const row of revenueResult.data) {
        totalRevenue += row.value;
      }
    }

    const activeAgents = agentMetrics.reduce((sum, am) => sum + am.sessions, 0);
    const complianceScore = totalChecks > 0 ? (1 - totalViolations / totalChecks) * 100 : 100;

    // Get unique customer count from metrics
    const customerResult = await this.store.query<{ value: number }>(
      'SELECT * FROM metrics WHERE tenant_id = {tenantId:String} AND metric = {metric:String}',
      { tenantId, metric: 'messages_sent' },
      tenantId,
    );

    const totalCustomers = customerResult.success ? customerResult.data.length : 0;

    return ok({
      totalCustomers,
      activeAgents,
      complianceScore,
      revenueCollected: totalRevenue,
      channelMetrics,
      agentMetrics,
      complianceMetrics,
    });
  }

  /**
   * Get delivery trend over time for a specific channel (or all channels).
   */
  async getDeliveryTrend(
    tenantId: string,
    timeRange: TimeRange,
    channel?: string | undefined,
  ): Promise<Result<readonly MetricValue[], AppError>> {
    const validation = validateQueryInputs(tenantId, timeRange);
    if (validation !== null) return validation as Result<readonly MetricValue[], AppError>;

    const params: Record<string, unknown> = {
      tenantId,
      metrics: ['messages_sent', 'messages_delivered', 'messages_failed'],
      from: timeRange.from,
      to: timeRange.to,
    };

    if (channel !== undefined) {
      params['channel'] = channel;
    }

    const result = await this.store.query<{
      metric: MetricName;
      value: number;
      timestamp: Date;
      dimensions: Record<string, string>;
    }>(
      'SELECT * FROM metrics WHERE tenant_id = {tenantId:String} AND metric IN ({metrics:Array(String)}) AND timestamp >= {from:DateTime} AND timestamp <= {to:DateTime}',
      params,
      tenantId,
    );

    if (!result.success) return result as Result<readonly MetricValue[], AppError>;

    const values: MetricValue[] = result.data.map((row) => ({
      metric: row.metric,
      value: row.value,
      timestamp: row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp),
      dimensions: row.dimensions ?? {},
    }));

    return ok(values);
  }

  /**
   * Get agent performance trend over time for a specific role (or all roles).
   */
  async getAgentPerformanceTrend(
    tenantId: string,
    timeRange: TimeRange,
    agentRole?: string | undefined,
  ): Promise<Result<readonly MetricValue[], AppError>> {
    const validation = validateQueryInputs(tenantId, timeRange);
    if (validation !== null) return validation as Result<readonly MetricValue[], AppError>;

    const params: Record<string, unknown> = {
      tenantId,
      metrics: ['agent_sessions', 'agent_resolutions'],
      from: timeRange.from,
      to: timeRange.to,
    };

    if (agentRole !== undefined) {
      params['agent_role'] = agentRole;
    }

    const result = await this.store.query<{
      metric: MetricName;
      value: number;
      timestamp: Date;
      dimensions: Record<string, string>;
    }>(
      'SELECT * FROM metrics WHERE tenant_id = {tenantId:String} AND metric IN ({metrics:Array(String)}) AND timestamp >= {from:DateTime} AND timestamp <= {to:DateTime}',
      params,
      tenantId,
    );

    if (!result.success) return result as Result<readonly MetricValue[], AppError>;

    const values: MetricValue[] = result.data.map((row) => ({
      metric: row.metric,
      value: row.value,
      timestamp: row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp),
      dimensions: row.dimensions ?? {},
    }));

    return ok(values);
  }

  /**
   * Get compliance trend over time for a specific regulation (or all).
   */
  async getComplianceTrend(
    tenantId: string,
    timeRange: TimeRange,
    regulation?: string | undefined,
  ): Promise<Result<readonly MetricValue[], AppError>> {
    const validation = validateQueryInputs(tenantId, timeRange);
    if (validation !== null) return validation as Result<readonly MetricValue[], AppError>;

    const params: Record<string, unknown> = {
      tenantId,
      metrics: ['compliance_violations'],
      from: timeRange.from,
      to: timeRange.to,
    };

    if (regulation !== undefined) {
      params['regulation'] = regulation;
    }

    const result = await this.store.query<{
      metric: MetricName;
      value: number;
      timestamp: Date;
      dimensions: Record<string, string>;
    }>(
      'SELECT * FROM metrics WHERE tenant_id = {tenantId:String} AND metric IN ({metrics:Array(String)}) AND timestamp >= {from:DateTime} AND timestamp <= {to:DateTime}',
      params,
      tenantId,
    );

    if (!result.success) return result as Result<readonly MetricValue[], AppError>;

    const values: MetricValue[] = result.data.map((row) => ({
      metric: row.metric,
      value: row.value,
      timestamp: row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp),
      dimensions: row.dimensions ?? {},
    }));

    return ok(values);
  }

  /**
   * Get customer engagement trend (response rate over time).
   */
  async getCustomerEngagementTrend(
    tenantId: string,
    timeRange: TimeRange,
  ): Promise<Result<readonly MetricValue[], AppError>> {
    const validation = validateQueryInputs(tenantId, timeRange);
    if (validation !== null) return validation as Result<readonly MetricValue[], AppError>;

    const result = await this.store.query<{
      metric: MetricName;
      value: number;
      timestamp: Date;
      dimensions: Record<string, string>;
    }>(
      'SELECT * FROM metrics WHERE tenant_id = {tenantId:String} AND metric IN ({metrics:Array(String)}) AND timestamp >= {from:DateTime} AND timestamp <= {to:DateTime}',
      {
        tenantId,
        metrics: ['response_rate', 'messages_delivered', 'messages_sent'],
        from: timeRange.from,
        to: timeRange.to,
      },
      tenantId,
    );

    if (!result.success) return result as Result<readonly MetricValue[], AppError>;

    const values: MetricValue[] = result.data.map((row) => ({
      metric: row.metric,
      value: row.value,
      timestamp: row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp),
      dimensions: row.dimensions ?? {},
    }));

    return ok(values);
  }
}

// ─── Validation Helpers ──────────────────────────────────────────

function validateQueryInputs(
  tenantId: string,
  timeRange: TimeRange,
): Result<never, AppError> | null {
  if (!tenantId || tenantId.trim().length === 0) {
    return err(
      new ValidationError('tenantId is required for all analytics queries', {
        tenantId: ['tenantId must be a non-empty string'],
      }),
    );
  }

  if (timeRange.from >= timeRange.to) {
    return err(
      new ValidationError('Invalid time range', {
        timeRange: ['from must be before to'],
      }),
    );
  }

  return null;
}
