/**
 * Cohort analysis — tenant-isolated customer segmentation for ORDR-Connect
 *
 * Defines, stores, and compares customer cohorts based on configurable criteria.
 * Used for retention analysis, A/B comparisons, and lifecycle stage analytics.
 *
 * SECURITY:
 * - All cohort operations enforce tenantId — no cross-tenant cohort access (SOC2 CC6.1)
 * - Cohort criteria operate on metadata fields, never raw PII/PHI
 * - Cohort member IDs are opaque references, not customer data
 * - No PHI in cohort definitions or results
 *
 * ISO 27001 A.9.4.1 — Information access restriction: tenant boundary enforced.
 * HIPAA §164.312(a)(1) — Access control: aggregated cohort metrics only.
 */

import {
  type Result,
  ok,
  err,
  NotFoundError,
  ValidationError,
} from '@ordr/core';
import type { AppError } from '@ordr/core';
import type {
  CohortDefinition,
  CohortCriteria,
  StoredCohort,
  AnalyticsResult,
  MetricName,
  MetricValue,
  TimeRange,
} from './types.js';
import type { AnalyticsStore } from './client.js';

// ─── Built-in Cohort Fields ─────────────────────────────────────

export const BUILT_IN_COHORT_FIELDS = [
  'lifecycle_stage',
  'health_score_range',
  'channel_preference',
  'last_interaction_days',
] as const;

export type BuiltInCohortField = (typeof BUILT_IN_COHORT_FIELDS)[number];

// ─── Customer Record (for matching) ─────────────────────────────

export interface CohortCustomerRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly lifecycleStage?: string | undefined;
  readonly healthScore?: number | undefined;
  readonly channelPreference?: string | undefined;
  readonly lastInteractionDays?: number | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

// ─── Customer Provider Interface ─────────────────────────────────

export interface CustomerProvider {
  getCustomers(tenantId: string): Promise<readonly CohortCustomerRecord[]>;
}

// ─── Cohort Analyzer ─────────────────────────────────────────────

export class CohortAnalyzer {
  private readonly store: AnalyticsStore;
  private readonly customerProvider: CustomerProvider;
  private readonly cohorts = new Map<string, StoredCohort>();
  private nextId = 1;

  constructor(store: AnalyticsStore, customerProvider: CustomerProvider) {
    this.store = store;
    this.customerProvider = customerProvider;
  }

  /**
   * Define a new cohort and store it.
   * Returns the cohort ID for future reference.
   */
  async defineCohort(
    definition: CohortDefinition,
  ): Promise<Result<string, AppError>> {
    const validation = validateCohortDefinition(definition);
    if (validation !== null) return validation;

    const cohortId = `cohort_${this.nextId++}`;
    const stored: StoredCohort = {
      id: cohortId,
      definition,
      createdAt: new Date(),
    };

    this.cohorts.set(cohortId, stored);
    return ok(cohortId);
  }

  /**
   * Get the member IDs (customer IDs) of a cohort.
   * Evaluates cohort criteria against the customer provider.
   *
   * SECURITY: Only returns customer IDs for the specified tenant.
   */
  async getCohortMembers(
    cohortId: string,
    tenantId: string,
  ): Promise<Result<readonly string[], AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(
        new ValidationError('tenantId is required', {
          tenantId: ['tenantId must be a non-empty string'],
        }),
      );
    }

    const cohort = this.cohorts.get(cohortId);
    if (!cohort) {
      return err(new NotFoundError(`Cohort not found: ${cohortId}`));
    }

    // Tenant isolation: cohort must belong to the requesting tenant
    if (cohort.definition.tenantId !== tenantId) {
      return err(new NotFoundError(`Cohort not found: ${cohortId}`));
    }

    const customers = await this.customerProvider.getCustomers(tenantId);
    const matchingIds = customers
      .filter((customer) => matchesAllCriteria(customer, cohort.definition.criteria))
      .map((customer) => customer.id);

    return ok(matchingIds);
  }

  /**
   * Compare multiple cohorts across specified metrics and time range.
   * Returns per-cohort analytics results.
   *
   * SECURITY: All cohorts must belong to the same tenant.
   */
  async compareCohorts(
    cohortIds: readonly string[],
    tenantId: string,
    metrics: readonly MetricName[],
    timeRange: TimeRange,
  ): Promise<Result<Readonly<Record<string, AnalyticsResult>>, AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(
        new ValidationError('tenantId is required', {
          tenantId: ['tenantId must be a non-empty string'],
        }),
      );
    }

    if (cohortIds.length === 0) {
      return err(
        new ValidationError('At least one cohort ID is required', {
          cohortIds: ['Must provide at least one cohort ID'],
        }),
      );
    }

    const results: Record<string, AnalyticsResult> = {};

    for (const cohortId of cohortIds) {
      const cohort = this.cohorts.get(cohortId);
      if (!cohort) {
        return err(new NotFoundError(`Cohort not found: ${cohortId}`));
      }

      // Tenant isolation
      if (cohort.definition.tenantId !== tenantId) {
        return err(new NotFoundError(`Cohort not found: ${cohortId}`));
      }

      // Get cohort member IDs
      const membersResult = await this.getCohortMembers(cohortId, tenantId);
      if (!membersResult.success) {
        return err(membersResult.error);
      }

      // Query metrics for this cohort's time range
      const queryResult = await this.store.query<{
        metric: MetricName;
        value: number;
        timestamp: Date;
        dimensions: Record<string, string>;
      }>(
        'SELECT * FROM metrics WHERE tenant_id = {tenantId:String} AND metric IN ({metrics:Array(String)}) AND timestamp >= {from:DateTime} AND timestamp <= {to:DateTime}',
        {
          tenantId,
          metrics: [...metrics],
          from: timeRange.from,
          to: timeRange.to,
        },
        tenantId,
      );

      const data: MetricValue[] = queryResult.success
        ? queryResult.data.map((row) => ({
            metric: row.metric,
            value: row.value,
            timestamp: row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp),
            dimensions: row.dimensions ?? {},
          }))
        : [];

      results[cohortId] = {
        query: {
          tenantId,
          metrics,
          timeRange,
        },
        data,
        computedAt: new Date(),
      };
    }

    return ok(results);
  }

  /**
   * Get a stored cohort definition.
   */
  getCohort(cohortId: string, tenantId: string): Result<StoredCohort, AppError> {
    const cohort = this.cohorts.get(cohortId);
    if (!cohort || cohort.definition.tenantId !== tenantId) {
      return err(new NotFoundError(`Cohort not found: ${cohortId}`));
    }
    return ok(cohort);
  }

  /** Number of stored cohorts — test helper */
  get cohortCount(): number {
    return this.cohorts.size;
  }
}

// ─── Criteria Evaluation ─────────────────────────────────────────

function matchesAllCriteria(
  customer: CohortCustomerRecord,
  criteria: readonly CohortCriteria[],
): boolean {
  return criteria.every((c) => matchesCriterion(customer, c));
}

function matchesCriterion(
  customer: CohortCustomerRecord,
  criterion: CohortCriteria,
): boolean {
  const fieldValue = getFieldValue(customer, criterion.field);
  if (fieldValue === undefined) return false;

  return evaluateOperator(fieldValue, criterion.operator, criterion.value);
}

function getFieldValue(
  customer: CohortCustomerRecord,
  field: string,
): string | number | undefined {
  switch (field) {
    case 'lifecycle_stage':
      return customer.lifecycleStage;
    case 'health_score_range':
    case 'health_score':
      return customer.healthScore;
    case 'channel_preference':
      return customer.channelPreference;
    case 'last_interaction_days':
      return customer.lastInteractionDays;
    default: {
      // Check metadata
      const metaValue = customer.metadata?.[field];
      if (typeof metaValue === 'string' || typeof metaValue === 'number') {
        return metaValue;
      }
      return undefined;
    }
  }
}

function evaluateOperator(
  fieldValue: string | number,
  operator: string,
  criterionValue: string | number | readonly string[] | readonly number[],
): boolean {
  switch (operator) {
    case 'eq':
      return fieldValue === criterionValue;
    case 'neq':
      return fieldValue !== criterionValue;
    case 'gt':
      return typeof fieldValue === 'number' && typeof criterionValue === 'number' && fieldValue > criterionValue;
    case 'gte':
      return typeof fieldValue === 'number' && typeof criterionValue === 'number' && fieldValue >= criterionValue;
    case 'lt':
      return typeof fieldValue === 'number' && typeof criterionValue === 'number' && fieldValue < criterionValue;
    case 'lte':
      return typeof fieldValue === 'number' && typeof criterionValue === 'number' && fieldValue <= criterionValue;
    case 'in':
      return Array.isArray(criterionValue) && (criterionValue as readonly (string | number)[]).includes(fieldValue);
    case 'not_in':
      return Array.isArray(criterionValue) && !(criterionValue as readonly (string | number)[]).includes(fieldValue);
    case 'between': {
      if (!Array.isArray(criterionValue) || criterionValue.length < 2) return false;
      const [min, max] = criterionValue as readonly number[];
      return typeof fieldValue === 'number' && min !== undefined && max !== undefined && fieldValue >= min && fieldValue <= max;
    }
    case 'contains':
      return typeof fieldValue === 'string' && typeof criterionValue === 'string' && fieldValue.includes(criterionValue);
    default:
      return false;
  }
}

// ─── Validation ──────────────────────────────────────────────────

function validateCohortDefinition(
  definition: CohortDefinition,
): Result<never, AppError> | null {
  if (!definition.tenantId || definition.tenantId.trim().length === 0) {
    return err(
      new ValidationError('tenantId is required in cohort definition', {
        tenantId: ['tenantId must be a non-empty string'],
      }),
    );
  }

  if (!definition.name || definition.name.trim().length === 0) {
    return err(
      new ValidationError('name is required in cohort definition', {
        name: ['name must be a non-empty string'],
      }),
    );
  }

  if (definition.criteria.length === 0) {
    return err(
      new ValidationError('At least one criterion is required', {
        criteria: ['Must provide at least one criterion'],
      }),
    );
  }

  return null;
}
