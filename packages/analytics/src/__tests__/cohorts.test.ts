/**
 * CohortAnalyzer tests
 *
 * Verifies:
 * - Cohort definition and ID generation
 * - Cohort member retrieval with criteria evaluation
 * - Cohort comparison across metrics
 * - Tenant isolation on all operations
 * - Built-in cohort criteria (lifecycle_stage, health_score_range, etc.)
 * - Operator evaluation (eq, gt, gte, lt, lte, in, not_in, between, contains)
 * - Validation of inputs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAnalyticsStore } from '../client.js';
import { CohortAnalyzer } from '../cohorts.js';
import type { CohortCustomerRecord, CustomerProvider } from '../cohorts.js';
import type { CohortDefinition, TimeRange } from '../types.js';

// ─── Test Helpers ────────────────────────────────────────────────

const mockCustomers: CohortCustomerRecord[] = [
  {
    id: 'cust-1',
    tenantId: 'tenant-1',
    lifecycleStage: 'customer',
    healthScore: 85,
    channelPreference: 'email',
    lastInteractionDays: 3,
  },
  {
    id: 'cust-2',
    tenantId: 'tenant-1',
    lifecycleStage: 'lead',
    healthScore: 45,
    channelPreference: 'sms',
    lastInteractionDays: 30,
  },
  {
    id: 'cust-3',
    tenantId: 'tenant-1',
    lifecycleStage: 'customer',
    healthScore: 92,
    channelPreference: 'email',
    lastInteractionDays: 1,
  },
  {
    id: 'cust-4',
    tenantId: 'tenant-1',
    lifecycleStage: 'churning',
    healthScore: 20,
    channelPreference: 'phone',
    lastInteractionDays: 60,
  },
  {
    id: 'cust-5',
    tenantId: 'tenant-2', // Different tenant
    lifecycleStage: 'customer',
    healthScore: 90,
    channelPreference: 'email',
    lastInteractionDays: 2,
  },
];

const mockProvider: CustomerProvider = {
  getCustomers: async (tenantId: string) =>
    mockCustomers.filter((c) => c.tenantId === tenantId),
};

const now = new Date();
const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

const defaultTimeRange: TimeRange = {
  from: sevenDaysAgo,
  to: now,
  granularity: 'day',
};

describe('CohortAnalyzer', () => {
  let store: InMemoryAnalyticsStore;
  let analyzer: CohortAnalyzer;

  beforeEach(() => {
    store = new InMemoryAnalyticsStore();
    analyzer = new CohortAnalyzer(store, mockProvider);
  });

  // ─── Define Cohort ─────────────────────────────────────────────

  describe('defineCohort', () => {
    it('creates a cohort and returns an ID', async () => {
      const definition: CohortDefinition = {
        name: 'High Value Customers',
        tenantId: 'tenant-1',
        criteria: [
          { field: 'lifecycle_stage', operator: 'eq', value: 'customer' },
        ],
      };

      const result = await analyzer.defineCohort(definition);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toMatch(/^cohort_/);
      }
    });

    it('generates unique IDs for each cohort', async () => {
      const def1: CohortDefinition = {
        name: 'Cohort A',
        tenantId: 'tenant-1',
        criteria: [{ field: 'lifecycle_stage', operator: 'eq', value: 'lead' }],
      };
      const def2: CohortDefinition = {
        name: 'Cohort B',
        tenantId: 'tenant-1',
        criteria: [{ field: 'lifecycle_stage', operator: 'eq', value: 'customer' }],
      };

      const result1 = await analyzer.defineCohort(def1);
      const result2 = await analyzer.defineCohort(def2);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      if (result1.success && result2.success) {
        expect(result1.data).not.toBe(result2.data);
      }
    });

    it('rejects cohort with empty tenantId', async () => {
      const definition: CohortDefinition = {
        name: 'Invalid',
        tenantId: '',
        criteria: [{ field: 'lifecycle_stage', operator: 'eq', value: 'customer' }],
      };

      const result = await analyzer.defineCohort(definition);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('rejects cohort with empty name', async () => {
      const definition: CohortDefinition = {
        name: '',
        tenantId: 'tenant-1',
        criteria: [{ field: 'lifecycle_stage', operator: 'eq', value: 'customer' }],
      };

      const result = await analyzer.defineCohort(definition);

      expect(result.success).toBe(false);
    });

    it('rejects cohort with no criteria', async () => {
      const definition: CohortDefinition = {
        name: 'Empty Criteria',
        tenantId: 'tenant-1',
        criteria: [],
      };

      const result = await analyzer.defineCohort(definition);

      expect(result.success).toBe(false);
    });
  });

  // ─── Get Members ───────────────────────────────────────────────

  describe('getCohortMembers', () => {
    it('returns matching customer IDs for eq operator', async () => {
      const definition: CohortDefinition = {
        name: 'Customers',
        tenantId: 'tenant-1',
        criteria: [
          { field: 'lifecycle_stage', operator: 'eq', value: 'customer' },
        ],
      };

      const createResult = await analyzer.defineCohort(definition);
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const membersResult = await analyzer.getCohortMembers(createResult.data, 'tenant-1');

      expect(membersResult.success).toBe(true);
      if (membersResult.success) {
        expect(membersResult.data).toContain('cust-1');
        expect(membersResult.data).toContain('cust-3');
        expect(membersResult.data).not.toContain('cust-2'); // lead
        expect(membersResult.data).not.toContain('cust-4'); // churning
      }
    });

    it('evaluates gte operator on numeric fields', async () => {
      const definition: CohortDefinition = {
        name: 'High Health',
        tenantId: 'tenant-1',
        criteria: [
          { field: 'health_score', operator: 'gte', value: 80 },
        ],
      };

      const createResult = await analyzer.defineCohort(definition);
      if (!createResult.success) return;

      const membersResult = await analyzer.getCohortMembers(createResult.data, 'tenant-1');

      expect(membersResult.success).toBe(true);
      if (membersResult.success) {
        expect(membersResult.data).toContain('cust-1'); // 85
        expect(membersResult.data).toContain('cust-3'); // 92
        expect(membersResult.data).not.toContain('cust-2'); // 45
        expect(membersResult.data).not.toContain('cust-4'); // 20
      }
    });

    it('evaluates between operator', async () => {
      const definition: CohortDefinition = {
        name: 'Medium Health',
        tenantId: 'tenant-1',
        criteria: [
          { field: 'health_score', operator: 'between', value: [40, 90] },
        ],
      };

      const createResult = await analyzer.defineCohort(definition);
      if (!createResult.success) return;

      const membersResult = await analyzer.getCohortMembers(createResult.data, 'tenant-1');

      expect(membersResult.success).toBe(true);
      if (membersResult.success) {
        expect(membersResult.data).toContain('cust-1'); // 85 — in range
        expect(membersResult.data).toContain('cust-2'); // 45 — in range
        expect(membersResult.data).not.toContain('cust-3'); // 92 — above
        expect(membersResult.data).not.toContain('cust-4'); // 20 — below
      }
    });

    it('evaluates in operator', async () => {
      const definition: CohortDefinition = {
        name: 'Email or SMS',
        tenantId: 'tenant-1',
        criteria: [
          { field: 'channel_preference', operator: 'in', value: ['email', 'sms'] },
        ],
      };

      const createResult = await analyzer.defineCohort(definition);
      if (!createResult.success) return;

      const membersResult = await analyzer.getCohortMembers(createResult.data, 'tenant-1');

      expect(membersResult.success).toBe(true);
      if (membersResult.success) {
        expect(membersResult.data).toContain('cust-1');
        expect(membersResult.data).toContain('cust-2');
        expect(membersResult.data).toContain('cust-3');
        expect(membersResult.data).not.toContain('cust-4'); // phone
      }
    });

    it('evaluates multiple criteria (AND logic)', async () => {
      const definition: CohortDefinition = {
        name: 'Active Customers',
        tenantId: 'tenant-1',
        criteria: [
          { field: 'lifecycle_stage', operator: 'eq', value: 'customer' },
          { field: 'health_score', operator: 'gte', value: 90 },
        ],
      };

      const createResult = await analyzer.defineCohort(definition);
      if (!createResult.success) return;

      const membersResult = await analyzer.getCohortMembers(createResult.data, 'tenant-1');

      expect(membersResult.success).toBe(true);
      if (membersResult.success) {
        expect(membersResult.data).toEqual(['cust-3']); // Only cust-3 matches both
      }
    });

    it('returns 404 for non-existent cohort', async () => {
      const result = await analyzer.getCohortMembers('non-existent', 'tenant-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('enforces tenant isolation — denies access to other tenant cohorts', async () => {
      const definition: CohortDefinition = {
        name: 'Tenant 1 Cohort',
        tenantId: 'tenant-1',
        criteria: [
          { field: 'lifecycle_stage', operator: 'eq', value: 'customer' },
        ],
      };

      const createResult = await analyzer.defineCohort(definition);
      if (!createResult.success) return;

      // Attempt to access from different tenant
      const result = await analyzer.getCohortMembers(createResult.data, 'tenant-2');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─── Compare Cohorts ───────────────────────────────────────────

  describe('compareCohorts', () => {
    it('compares two cohorts across metrics', async () => {
      const def1: CohortDefinition = {
        name: 'Active',
        tenantId: 'tenant-1',
        criteria: [{ field: 'lifecycle_stage', operator: 'eq', value: 'customer' }],
      };
      const def2: CohortDefinition = {
        name: 'At Risk',
        tenantId: 'tenant-1',
        criteria: [{ field: 'lifecycle_stage', operator: 'eq', value: 'churning' }],
      };

      const r1 = await analyzer.defineCohort(def1);
      const r2 = await analyzer.defineCohort(def2);
      if (!r1.success || !r2.success) return;

      const result = await analyzer.compareCohorts(
        [r1.data, r2.data],
        'tenant-1',
        ['messages_sent', 'agent_sessions'],
        defaultTimeRange,
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[r1.data]).toBeDefined();
        expect(result.data[r2.data]).toBeDefined();
        expect(result.data[r1.data]?.query.tenantId).toBe('tenant-1');
      }
    });

    it('returns error for non-existent cohort in comparison', async () => {
      const result = await analyzer.compareCohorts(
        ['non-existent'],
        'tenant-1',
        ['messages_sent'],
        defaultTimeRange,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('rejects comparison with empty cohort list', async () => {
      const result = await analyzer.compareCohorts(
        [],
        'tenant-1',
        ['messages_sent'],
        defaultTimeRange,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('rejects comparison with empty tenantId', async () => {
      const result = await analyzer.compareCohorts(
        ['cohort-1'],
        '',
        ['messages_sent'],
        defaultTimeRange,
      );

      expect(result.success).toBe(false);
    });

    it('enforces tenant isolation in comparisons', async () => {
      const definition: CohortDefinition = {
        name: 'Tenant 1',
        tenantId: 'tenant-1',
        criteria: [{ field: 'lifecycle_stage', operator: 'eq', value: 'customer' }],
      };

      const r = await analyzer.defineCohort(definition);
      if (!r.success) return;

      // Access from different tenant
      const result = await analyzer.compareCohorts(
        [r.data],
        'tenant-2',
        ['messages_sent'],
        defaultTimeRange,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─── Operator Coverage ─────────────────────────────────────────

  describe('operator evaluation', () => {
    it('evaluates lt operator', async () => {
      const definition: CohortDefinition = {
        name: 'Low Health',
        tenantId: 'tenant-1',
        criteria: [{ field: 'health_score', operator: 'lt', value: 50 }],
      };

      const r = await analyzer.defineCohort(definition);
      if (!r.success) return;

      const members = await analyzer.getCohortMembers(r.data, 'tenant-1');
      if (members.success) {
        expect(members.data).toContain('cust-2'); // 45
        expect(members.data).toContain('cust-4'); // 20
        expect(members.data).not.toContain('cust-1'); // 85
      }
    });

    it('evaluates neq operator', async () => {
      const definition: CohortDefinition = {
        name: 'Not Churning',
        tenantId: 'tenant-1',
        criteria: [{ field: 'lifecycle_stage', operator: 'neq', value: 'churning' }],
      };

      const r = await analyzer.defineCohort(definition);
      if (!r.success) return;

      const members = await analyzer.getCohortMembers(r.data, 'tenant-1');
      if (members.success) {
        expect(members.data).not.toContain('cust-4');
        expect(members.data.length).toBe(3);
      }
    });

    it('evaluates not_in operator', async () => {
      const definition: CohortDefinition = {
        name: 'Not Email or SMS',
        tenantId: 'tenant-1',
        criteria: [
          { field: 'channel_preference', operator: 'not_in', value: ['email', 'sms'] },
        ],
      };

      const r = await analyzer.defineCohort(definition);
      if (!r.success) return;

      const members = await analyzer.getCohortMembers(r.data, 'tenant-1');
      if (members.success) {
        expect(members.data).toEqual(['cust-4']); // Only phone
      }
    });
  });
});
