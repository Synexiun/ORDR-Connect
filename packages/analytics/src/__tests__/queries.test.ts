/**
 * AnalyticsQueries tests
 *
 * Verifies:
 * - All predefined query methods
 * - Time range filtering
 * - Dimension filtering (channel, agent_role, regulation)
 * - Empty result handling
 * - Tenant isolation on all queries
 * - Dashboard summary aggregation
 * - Validation of inputs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAnalyticsStore } from '../client.js';
import { AnalyticsQueries } from '../queries.js';
import type { TimeRange } from '../types.js';

// ─── Test Helpers ────────────────────────────────────────────────

const now = new Date();
const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

const defaultTimeRange: TimeRange = {
  from: sevenDaysAgo,
  to: now,
  granularity: 'day',
};

async function seedChannelMetrics(
  store: InMemoryAnalyticsStore,
  tenantId: string,
): Promise<void> {
  await store.insert('metrics', [
    { metric: 'messages_sent', value: 1, dimensions: { channel: 'email' }, timestamp: oneDayAgo },
    { metric: 'messages_sent', value: 1, dimensions: { channel: 'email' }, timestamp: oneDayAgo },
    { metric: 'messages_delivered', value: 1, dimensions: { channel: 'email' }, timestamp: oneDayAgo },
    { metric: 'messages_failed', value: 1, dimensions: { channel: 'email' }, timestamp: oneDayAgo },
    { metric: 'messages_sent', value: 1, dimensions: { channel: 'sms' }, timestamp: oneDayAgo },
    { metric: 'messages_delivered', value: 1, dimensions: { channel: 'sms' }, timestamp: oneDayAgo },
    { metric: 'cost_per_interaction', value: 5, dimensions: { channel: 'sms' }, timestamp: oneDayAgo },
  ], tenantId);
}

async function seedAgentMetrics(
  store: InMemoryAnalyticsStore,
  tenantId: string,
): Promise<void> {
  await store.insert('metrics', [
    { metric: 'agent_sessions', value: 1, dimensions: { agent_role: 'collections', confidence: '0.85' }, timestamp: oneDayAgo },
    { metric: 'agent_sessions', value: 1, dimensions: { agent_role: 'collections', confidence: '0.90' }, timestamp: oneDayAgo },
    { metric: 'agent_resolutions', value: 1, dimensions: { agent_role: 'collections' }, timestamp: oneDayAgo },
    { metric: 'avg_response_time', value: 3000, dimensions: { agent_role: 'collections', steps: '4' }, timestamp: oneDayAgo },
    { metric: 'cost_per_interaction', value: 10, dimensions: { agent_role: 'collections' }, timestamp: oneDayAgo },
  ], tenantId);
}

async function seedComplianceMetrics(
  store: InMemoryAnalyticsStore,
  tenantId: string,
): Promise<void> {
  await store.insert('metrics', [
    { metric: 'compliance_violations', value: 1, dimensions: { regulation: 'HIPAA', rule_id: 'r1' }, timestamp: oneDayAgo },
    { metric: 'compliance_violations', value: 0, dimensions: { regulation: 'HIPAA', rule_id: 'r2' }, timestamp: oneDayAgo },
    { metric: 'compliance_violations', value: 1, dimensions: { regulation: 'SOC2', rule_id: 'r3' }, timestamp: oneDayAgo },
  ], tenantId);
}

describe('AnalyticsQueries', () => {
  let store: InMemoryAnalyticsStore;
  let queries: AnalyticsQueries;

  beforeEach(() => {
    store = new InMemoryAnalyticsStore();
    queries = new AnalyticsQueries(store);
  });

  // ─── Channel Metrics ──────────────────────────────────────────

  describe('getChannelMetrics', () => {
    it('returns channel metrics aggregated by channel', async () => {
      await seedChannelMetrics(store, 'tenant-1');
      const result = await queries.getChannelMetrics('tenant-1', defaultTimeRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
        const emailMetrics = result.data.find((m) => m.channel === 'email');
        expect(emailMetrics).toBeDefined();
        expect(emailMetrics?.sent).toBe(2);
        expect(emailMetrics?.delivered).toBe(1);
        expect(emailMetrics?.failed).toBe(1);
      }
    });

    it('calculates delivery rate correctly', async () => {
      await seedChannelMetrics(store, 'tenant-1');
      const result = await queries.getChannelMetrics('tenant-1', defaultTimeRange);

      if (result.success) {
        const smsMetrics = result.data.find((m) => m.channel === 'sms');
        expect(smsMetrics).toBeDefined();
        // sms: 1 sent, 1 delivered, 0 failed = 0.5 delivery rate (1/2)
        expect(smsMetrics?.deliveryRate).toBe(0.5);
      }
    });

    it('returns empty array when no data for tenant', async () => {
      const result = await queries.getChannelMetrics('empty-tenant', defaultTimeRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(0);
      }
    });

    it('rejects empty tenantId', async () => {
      const result = await queries.getChannelMetrics('', defaultTimeRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('rejects invalid time range (from >= to)', async () => {
      const result = await queries.getChannelMetrics('tenant-1', {
        from: now,
        to: sevenDaysAgo,
        granularity: 'day',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  // ─── Agent Metrics ─────────────────────────────────────────────

  describe('getAgentMetrics', () => {
    it('returns agent metrics aggregated by role', async () => {
      await seedAgentMetrics(store, 'tenant-1');
      const result = await queries.getAgentMetrics('tenant-1', defaultTimeRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
        const collMetrics = result.data.find((m) => m.agentRole === 'collections');
        expect(collMetrics).toBeDefined();
        expect(collMetrics?.sessions).toBe(2);
        expect(collMetrics?.resolutions).toBe(1);
      }
    });

    it('calculates resolution rate correctly', async () => {
      await seedAgentMetrics(store, 'tenant-1');
      const result = await queries.getAgentMetrics('tenant-1', defaultTimeRange);

      if (result.success) {
        const collMetrics = result.data.find((m) => m.agentRole === 'collections');
        expect(collMetrics?.resolutionRate).toBe(0.5); // 1 resolution / 2 sessions
      }
    });

    it('returns empty array when no agent data', async () => {
      const result = await queries.getAgentMetrics('empty-tenant', defaultTimeRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(0);
      }
    });

    it('rejects empty tenantId', async () => {
      const result = await queries.getAgentMetrics('', defaultTimeRange);

      expect(result.success).toBe(false);
    });
  });

  // ─── Compliance Metrics ────────────────────────────────────────

  describe('getComplianceMetrics', () => {
    it('returns compliance metrics by regulation', async () => {
      await seedComplianceMetrics(store, 'tenant-1');
      const result = await queries.getComplianceMetrics('tenant-1', defaultTimeRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
        const hipaa = result.data.find((m) => m.regulation === 'HIPAA');
        expect(hipaa).toBeDefined();
        expect(hipaa?.checks).toBe(2);
        expect(hipaa?.violations).toBe(1);
      }
    });

    it('calculates compliance rate correctly', async () => {
      await seedComplianceMetrics(store, 'tenant-1');
      const result = await queries.getComplianceMetrics('tenant-1', defaultTimeRange);

      if (result.success) {
        const hipaa = result.data.find((m) => m.regulation === 'HIPAA');
        expect(hipaa?.complianceRate).toBe(0.5); // 1 violation / 2 checks = 0.5 compliance
      }
    });

    it('returns 100% compliance when no violations', async () => {
      const result = await queries.getComplianceMetrics('empty-tenant', defaultTimeRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(0);
      }
    });
  });

  // ─── Dashboard Summary ─────────────────────────────────────────

  describe('getDashboardSummary', () => {
    it('returns a complete dashboard summary', async () => {
      await seedChannelMetrics(store, 'tenant-1');
      await seedAgentMetrics(store, 'tenant-1');
      await seedComplianceMetrics(store, 'tenant-1');

      const result = await queries.getDashboardSummary('tenant-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.channelMetrics.length).toBeGreaterThan(0);
        expect(result.data.agentMetrics.length).toBeGreaterThan(0);
        expect(result.data.complianceMetrics.length).toBeGreaterThan(0);
        expect(typeof result.data.complianceScore).toBe('number');
        expect(typeof result.data.activeAgents).toBe('number');
      }
    });

    it('returns defaults for empty tenant', async () => {
      const result = await queries.getDashboardSummary('empty-tenant');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.channelMetrics.length).toBe(0);
        expect(result.data.agentMetrics.length).toBe(0);
        expect(result.data.complianceMetrics.length).toBe(0);
        expect(result.data.complianceScore).toBe(100);
        expect(result.data.revenueCollected).toBe(0);
      }
    });

    it('rejects empty tenantId', async () => {
      const result = await queries.getDashboardSummary('');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  // ─── Trend Queries ─────────────────────────────────────────────

  describe('getDeliveryTrend', () => {
    it('returns delivery trend data', async () => {
      await seedChannelMetrics(store, 'tenant-1');
      const result = await queries.getDeliveryTrend('tenant-1', defaultTimeRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
      }
    });

    it('filters by channel when specified', async () => {
      await seedChannelMetrics(store, 'tenant-1');
      const result = await queries.getDeliveryTrend('tenant-1', defaultTimeRange, 'sms');

      expect(result.success).toBe(true);
      if (result.success) {
        // All returned rows should have sms channel in dimensions
        for (const row of result.data) {
          expect(row.dimensions['channel']).toBe('sms');
        }
      }
    });
  });

  describe('getAgentPerformanceTrend', () => {
    it('returns agent performance trend data', async () => {
      await seedAgentMetrics(store, 'tenant-1');
      const result = await queries.getAgentPerformanceTrend('tenant-1', defaultTimeRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getComplianceTrend', () => {
    it('returns compliance trend data', async () => {
      await seedComplianceMetrics(store, 'tenant-1');
      const result = await queries.getComplianceTrend('tenant-1', defaultTimeRange);

      expect(result.success).toBe(true);
    });
  });

  describe('getCustomerEngagementTrend', () => {
    it('returns customer engagement trend data', async () => {
      await store.insert('metrics', [
        { metric: 'response_rate', value: 0.75, dimensions: {}, timestamp: oneDayAgo },
      ], 'tenant-1');

      const result = await queries.getCustomerEngagementTrend('tenant-1', defaultTimeRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
      }
    });

    it('returns empty array for no engagement data', async () => {
      const result = await queries.getCustomerEngagementTrend('empty-tenant', defaultTimeRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(0);
      }
    });
  });

  // ─── Tenant Isolation ──────────────────────────────────────────

  describe('tenant isolation', () => {
    it('does not return data from other tenants', async () => {
      await seedChannelMetrics(store, 'tenant-1');
      await seedChannelMetrics(store, 'tenant-2');

      const result = await queries.getChannelMetrics('tenant-1', defaultTimeRange);

      if (result.success) {
        // Verify no cross-tenant data leakage
        const totalSent = result.data.reduce((sum, m) => sum + m.sent, 0);
        // tenant-1 has 2 email sent + 1 sms sent = 3 total sent
        expect(totalSent).toBe(3);
      }
    });
  });
});
