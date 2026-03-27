/**
 * Compliance API Service
 *
 * Typed wrappers over /api/v1/analytics/compliance and /api/v1/compliance endpoints.
 *
 * Regulatory frameworks supported: HIPAA, FDCPA, TCPA, GDPR, PIPEDA, LGPD, SOC2.
 * COMPLIANCE: No PHI in request bodies or query parameters.
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

// ── /v1/compliance/* — Dedicated compliance dashboard endpoints ──

export type ComplianceRegulation = 'HIPAA' | 'FDCPA' | 'TCPA' | 'GDPR' | 'SOC2' | 'ISO27001';

export interface RegulationScore {
  readonly regulation: ComplianceRegulation;
  readonly score: number;
  readonly ruleCount: number;
}

export interface ComplianceSummary {
  readonly score: number;
  readonly totalChecks: number;
  readonly passingChecks: number;
  readonly failingChecks: number;
  readonly lastAudit: string;
  readonly regulations: RegulationScore[];
}

export interface ViolationRecord {
  readonly id: string;
  readonly rule: string;
  readonly regulation: ComplianceRegulation;
  readonly severity: ViolationSeverity;
  readonly description: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly timestamp: string;
  readonly resolved: boolean;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

export interface ViolationListParams {
  regulation?: ComplianceRegulation;
  resolved?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ViolationListResponse {
  readonly success: true;
  readonly data: ViolationRecord[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface ConsentChannel {
  readonly channel: string;
  readonly consented: number;
  readonly total: number;
  readonly percentage: number;
}

export function fetchComplianceSummary(): Promise<{
  readonly success: true;
  readonly data: ComplianceSummary;
}> {
  return apiClient.get<{ readonly success: true; readonly data: ComplianceSummary }>(
    '/v1/compliance/summary',
  );
}

export function fetchViolations(params: ViolationListParams = {}): Promise<ViolationListResponse> {
  const query = new URLSearchParams();
  if (params.regulation !== undefined) query.set('regulation', params.regulation);
  if (params.resolved !== undefined) query.set('resolved', String(params.resolved));
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiClient.get<ViolationListResponse>(
    `/v1/compliance/violations${qs.length > 0 ? `?${qs}` : ''}`,
  );
}

export function resolveViolation(
  id: string,
  note?: string,
): Promise<{
  readonly success: true;
  readonly data: {
    readonly id: string;
    readonly resolved: true;
    readonly resolvedAt: string;
    readonly resolvedBy: string;
    readonly note: string | null;
  };
}> {
  return apiClient.post<{
    readonly success: true;
    readonly data: {
      readonly id: string;
      readonly resolved: true;
      readonly resolvedAt: string;
      readonly resolvedBy: string;
      readonly note: string | null;
    };
  }>(`/v1/compliance/violations/${id}/resolve`, note !== undefined ? { note } : {});
}

export function fetchConsentStatus(): Promise<{
  readonly success: true;
  readonly data: ConsentChannel[];
}> {
  return apiClient.get<{ readonly success: true; readonly data: ConsentChannel[] }>(
    '/v1/compliance/consent-status',
  );
}
