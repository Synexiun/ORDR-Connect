/**
 * Compliance API Service
 *
 * Typed wrappers over /api/v1/analytics/compliance and future
 * /api/v1/compliance endpoints.
 *
 * Regulatory frameworks supported: HIPAA, FDCPA, TCPA, GDPR, PIPEDA, LGPD, SOC2.
 */

import { apiClient } from './api';
import type { TimeRange, ComplianceMetricsResponse } from './analytics-api';

export type { TimeRange, ComplianceMetricsResponse };

export type Regulation = 'HIPAA' | 'FDCPA' | 'TCPA' | 'GDPR' | 'PIPEDA' | 'LGPD' | 'SOC2';
export type ViolationSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ComplianceViolation {
  readonly id: string;
  readonly tenantId: string;
  readonly regulation: Regulation;
  readonly severity: ViolationSeverity;
  readonly ruleId: string;
  readonly description: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly detectedAt: string;
  readonly resolvedAt: string | null;
  readonly status: 'open' | 'resolved' | 'suppressed';
}

export interface ComplianceViolationListParams {
  page?: number;
  pageSize?: number;
  regulation?: Regulation;
  severity?: ViolationSeverity;
  status?: 'open' | 'resolved' | 'suppressed';
}

export interface ComplianceViolationListResponse {
  readonly success: true;
  readonly data: ComplianceViolation[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface ComplianceScoreSummary {
  readonly overall: number;
  readonly byRegulation: Record<Regulation, number>;
  readonly openViolations: number;
  readonly criticalViolations: number;
  readonly trend: 'improving' | 'declining' | 'stable';
}

// ── API Functions ──────────────────────────────────────────────────

export function fetchComplianceMetrics(timeRange: TimeRange): Promise<ComplianceMetricsResponse> {
  return apiClient.get<ComplianceMetricsResponse>(`/v1/analytics/compliance?range=${timeRange}`);
}

export function fetchComplianceScore(): Promise<{
  readonly success: true;
  readonly data: ComplianceScoreSummary;
}> {
  return apiClient.get<{ readonly success: true; readonly data: ComplianceScoreSummary }>(
    '/v1/analytics/compliance?range=30d',
  );
}
