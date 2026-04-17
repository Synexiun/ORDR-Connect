/**
 * Service Health API Service
 *
 * Typed wrappers over /api/v1/health endpoints.
 * Covers: component status, active incidents, uptime history,
 * and response-time metrics.
 *
 * SECURITY:
 * - No PHI or tenant data in health responses — Rule 6
 * - Access restricted to operator+ roles — Rule 2
 * - All reads audit-logged (SOC 2 CC7.1 monitoring evidence) — Rule 3
 *
 * SOC 2 A1.2 | ISO 27001 A.8.16 | HIPAA §164.312(a)(1)
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export type ComponentStatus = 'operational' | 'degraded' | 'outage' | 'maintenance';
export type IncidentSeverity = 'P0' | 'P1' | 'P2' | 'P3';
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

export interface ServiceComponent {
  readonly id: string;
  readonly name: string;
  readonly category: 'core' | 'data' | 'messaging' | 'external' | 'security';
  readonly status: ComponentStatus;
  readonly uptimePct: number;
  readonly avgResponseMs: number | null;
  readonly p99ResponseMs: number | null;
  readonly lastCheckAt: string;
  /** 90 daily uptime slots — true = had incident that day */
  readonly uptimeHistory: readonly boolean[];
}

export interface IncidentUpdate {
  readonly timestamp: string;
  readonly status: IncidentStatus;
  readonly message: string;
}

export interface Incident {
  readonly id: string;
  readonly title: string;
  readonly severity: IncidentSeverity;
  readonly status: IncidentStatus;
  readonly affectedComponents: readonly string[];
  readonly startedAt: string;
  readonly resolvedAt: string | null;
  readonly updates: readonly IncidentUpdate[];
}

export interface HealthStats {
  readonly overallStatus: ComponentStatus;
  readonly operationalCount: number;
  readonly degradedCount: number;
  readonly outageCount: number;
  readonly openIncidents: number;
  readonly avgUptimePct: number;
}

// ── API Client ─────────────────────────────────────────────────────────────

export const healthApi = {
  async getStats(): Promise<HealthStats> {
    return apiClient.get<HealthStats>('/health/stats');
  },

  async listComponents(): Promise<ServiceComponent[]> {
    return apiClient.get<ServiceComponent[]>('/health/components');
  },

  async listIncidents(includeResolved?: boolean): Promise<Incident[]> {
    const q = new URLSearchParams();
    if (includeResolved === true) q.set('includeResolved', 'true');
    return apiClient.get<Incident[]>(`/health/incidents?${q}`);
  },
};
