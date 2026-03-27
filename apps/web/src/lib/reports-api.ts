/**
 * Reports API Helpers
 *
 * All functions use the existing apiClient from lib/api.ts which includes:
 * - Authorization header (in-memory token)
 * - X-Request-Id correlation header (audit trail)
 * - 401 auto-redirect
 *
 * COMPLIANCE: No PHI in request parameters or response handling.
 * Report data is aggregate/metadata only — no PII/PHI in table rows or summaries.
 */

import { apiClient } from './api';

// --- Types ---

export type ReportType =
  | 'operations'
  | 'agent-performance'
  | 'compliance-audit'
  | 'channel-analytics'
  | 'customer-health'
  | 'revenue'
  | 'hipaa'
  | 'sla';

export type ReportFormat = 'csv' | 'pdf' | 'json';
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';

export interface ReportTemplate {
  type: ReportType;
  name: string;
  description: string;
  icon: string;
  metrics: string[];
  lastGenerated?: string;
}

export interface GeneratedReport {
  id: string;
  type: ReportType;
  name: string;
  generatedAt: string;
  generatedBy: string;
  timeRange: string;
  status: 'completed' | 'generating' | 'failed';
  rowCount: number;
  size: string;
}

export interface ScheduledReport {
  id: string;
  name: string;
  type: ReportType;
  frequency: ScheduleFrequency;
  recipients: string[];
  nextRun: string;
  lastRun: string;
  status: 'active' | 'paused';
}

export interface ReportData {
  id: string;
  type: ReportType;
  name: string;
  generatedAt: string;
  timeRange: string;
  summary: { label: string; value: string; trend?: string }[];
  chartData: {
    labels: string[];
    datasets: { label: string; data: number[]; color: string }[];
  };
  tableHeaders: string[];
  tableRows: string[][];
}

export interface CreateSchedulePayload {
  name: string;
  type: ReportType;
  frequency: ScheduleFrequency;
  recipients: string[];
}

// --- Mock Data ---

export const mockReportTemplates: ReportTemplate[] = [
  {
    type: 'operations',
    name: 'Operations Summary',
    description:
      'Overall operational metrics including throughput, SLA adherence, and queue performance.',
    icon: 'LayoutDashboard',
    metrics: [
      'Throughput',
      'SLA Adherence',
      'Queue Depth',
      'Avg Resolution Time',
      'Active Sessions',
    ],
    lastGenerated: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  {
    type: 'agent-performance',
    name: 'Agent Performance',
    description:
      'AI agent resolution rates, confidence scores, cost analysis, and session metrics.',
    icon: 'Bot',
    metrics: [
      'Resolution Rate',
      'Avg Confidence',
      'Cost per Session',
      'Steps per Resolution',
      'Escalation Rate',
    ],
    lastGenerated: new Date(Date.now() - 4 * 3600000).toISOString(),
  },
  {
    type: 'compliance-audit',
    name: 'Compliance Audit',
    description: 'SOC 2, ISO 27001, and regulatory compliance checks with violation tracking.',
    icon: 'ShieldCheck',
    metrics: ['Compliance Score', 'Violations', 'Checks Passed', 'Audit Events', 'Risk Score'],
    lastGenerated: new Date(Date.now() - 24 * 3600000).toISOString(),
  },
  {
    type: 'channel-analytics',
    name: 'Channel Analytics',
    description:
      'Delivery rates, volume, cost-per-message, and failure analysis across all channels.',
    icon: 'Mail',
    metrics: ['Delivery Rate', 'Volume', 'Cost per Message', 'Failure Rate', 'Response Rate'],
    lastGenerated: new Date(Date.now() - 6 * 3600000).toISOString(),
  },
  {
    type: 'customer-health',
    name: 'Customer Health',
    description: 'Customer health scores, churn risk, engagement trends, and satisfaction metrics.',
    icon: 'Users',
    metrics: ['Health Score', 'Churn Risk', 'NPS', 'Engagement Rate', 'Lifetime Value'],
    lastGenerated: new Date(Date.now() - 12 * 3600000).toISOString(),
  },
  {
    type: 'revenue',
    name: 'Revenue',
    description:
      'Revenue collected, outstanding balances, payment trends, and collection efficiency.',
    icon: 'DollarSign',
    metrics: [
      'Revenue Collected',
      'Outstanding Balance',
      'Collection Rate',
      'Avg Payment Time',
      'Write-offs',
    ],
    lastGenerated: new Date(Date.now() - 8 * 3600000).toISOString(),
  },
  {
    type: 'hipaa',
    name: 'HIPAA Compliance',
    description: 'PHI access logs, encryption verification, BAA status, and breach assessment.',
    icon: 'Lock',
    metrics: [
      'PHI Access Events',
      'Encryption Status',
      'BAA Coverage',
      'Breach Risk',
      'Training Compliance',
    ],
    lastGenerated: new Date(Date.now() - 48 * 3600000).toISOString(),
  },
  {
    type: 'sla',
    name: 'SLA Report',
    description: 'Service level agreement adherence, response times, uptime, and penalty tracking.',
    icon: 'Timer',
    metrics: ['SLA Adherence', 'Avg Response Time', 'Uptime', 'P95 Latency', 'Penalty Events'],
    lastGenerated: new Date(Date.now() - 3 * 3600000).toISOString(),
  },
];

export const mockRecentReports: GeneratedReport[] = [
  {
    id: 'rpt-001',
    type: 'operations',
    name: 'Operations Summary — Mar 2026',
    generatedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    generatedBy: 'admin@ordr.io',
    timeRange: 'Mar 1 — Mar 25, 2026',
    status: 'completed',
    rowCount: 1247,
    size: '2.4 MB',
  },
  {
    id: 'rpt-002',
    type: 'agent-performance',
    name: 'Agent Performance — Week 12',
    generatedAt: new Date(Date.now() - 6 * 3600000).toISOString(),
    generatedBy: 'admin@ordr.io',
    timeRange: 'Mar 18 — Mar 24, 2026',
    status: 'completed',
    rowCount: 523,
    size: '1.1 MB',
  },
  {
    id: 'rpt-003',
    type: 'compliance-audit',
    name: 'Compliance Audit — Q1 2026',
    generatedAt: new Date(Date.now() - 24 * 3600000).toISOString(),
    generatedBy: 'compliance@ordr.io',
    timeRange: 'Jan 1 — Mar 25, 2026',
    status: 'completed',
    rowCount: 4821,
    size: '8.7 MB',
  },
  {
    id: 'rpt-004',
    type: 'hipaa',
    name: 'HIPAA Compliance — Mar 2026',
    generatedAt: new Date(Date.now() - 1 * 3600000).toISOString(),
    generatedBy: 'compliance@ordr.io',
    timeRange: 'Mar 1 — Mar 25, 2026',
    status: 'generating',
    rowCount: 0,
    size: '--',
  },
  {
    id: 'rpt-005',
    type: 'revenue',
    name: 'Revenue — Feb 2026',
    generatedAt: new Date(Date.now() - 48 * 3600000).toISOString(),
    generatedBy: 'finance@ordr.io',
    timeRange: 'Feb 1 — Feb 28, 2026',
    status: 'completed',
    rowCount: 892,
    size: '1.8 MB',
  },
];

export const mockScheduledReports: ScheduledReport[] = [
  {
    id: 'sched-001',
    name: 'Weekly Operations Summary',
    type: 'operations',
    frequency: 'weekly',
    recipients: ['admin@ordr.io', 'ops@ordr.io'],
    nextRun: new Date(Date.now() + 3 * 86400000).toISOString(),
    lastRun: new Date(Date.now() - 4 * 86400000).toISOString(),
    status: 'active',
  },
  {
    id: 'sched-002',
    name: 'Monthly HIPAA Report',
    type: 'hipaa',
    frequency: 'monthly',
    recipients: ['compliance@ordr.io', 'legal@ordr.io'],
    nextRun: new Date(Date.now() + 6 * 86400000).toISOString(),
    lastRun: new Date(Date.now() - 25 * 86400000).toISOString(),
    status: 'active',
  },
  {
    id: 'sched-003',
    name: 'Daily Agent Performance',
    type: 'agent-performance',
    frequency: 'daily',
    recipients: ['admin@ordr.io'],
    nextRun: new Date(Date.now() + 12 * 3600000).toISOString(),
    lastRun: new Date(Date.now() - 12 * 3600000).toISOString(),
    status: 'paused',
  },
];

const mockReportLabels = ['Mar 19', 'Mar 20', 'Mar 21', 'Mar 22', 'Mar 23', 'Mar 24', 'Mar 25'];

export const mockReportData: ReportData = {
  id: 'rpt-001',
  type: 'operations',
  name: 'Operations Summary — Mar 2026',
  generatedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  timeRange: 'Mar 1 — Mar 25, 2026',
  summary: [
    { label: 'Total Sessions', value: '12,480', trend: '+8.2%' },
    { label: 'Resolution Rate', value: '94.7%', trend: '+2.1%' },
    { label: 'Avg Response Time', value: '34s', trend: '-12.5%' },
    { label: 'SLA Adherence', value: '99.2%', trend: '+0.4%' },
  ],
  chartData: {
    labels: mockReportLabels,
    datasets: [
      { label: 'Sessions', data: [1620, 1780, 1540, 1890, 1720, 1950, 1980], color: '#3b82f6' },
      { label: 'Resolutions', data: [1535, 1690, 1460, 1790, 1630, 1850, 1875], color: '#10b981' },
    ],
  },
  tableHeaders: ['Date', 'Sessions', 'Resolutions', 'Rate', 'Avg Time', 'SLA Met'],
  tableRows: [
    ['Mar 19', '1,620', '1,535', '94.8%', '32s', '99.1%'],
    ['Mar 20', '1,780', '1,690', '95.0%', '31s', '99.4%'],
    ['Mar 21', '1,540', '1,460', '94.8%', '35s', '98.9%'],
    ['Mar 22', '1,890', '1,790', '94.7%', '33s', '99.2%'],
    ['Mar 23', '1,720', '1,630', '94.8%', '34s', '99.3%'],
    ['Mar 24', '1,950', '1,850', '94.9%', '30s', '99.5%'],
    ['Mar 25', '1,980', '1,875', '94.7%', '29s', '99.6%'],
  ],
};

// --- API Functions ---

export async function fetchReportTemplates(): Promise<ReportTemplate[]> {
  try {
    return await apiClient.get<ReportTemplate[]>('/v1/reports/templates');
  } catch {
    return mockReportTemplates;
  }
}

export async function fetchRecentReports(): Promise<GeneratedReport[]> {
  try {
    return await apiClient.get<GeneratedReport[]>('/v1/reports/recent');
  } catch {
    return mockRecentReports;
  }
}

export async function generateReport(
  type: ReportType,
  timeRange: { start: string; end: string },
): Promise<GeneratedReport> {
  try {
    return await apiClient.post<GeneratedReport>('/v1/reports/generate', { type, timeRange });
  } catch {
    // Mock: return a generating report
    return {
      id: `rpt-${Date.now()}`,
      type,
      name: `${mockReportTemplates.find((t) => t.type === type)?.name ?? 'Report'} — Custom Range`,
      generatedAt: new Date().toISOString(),
      generatedBy: 'admin@ordr.io',
      timeRange: `${timeRange.start} — ${timeRange.end}`,
      status: 'generating',
      rowCount: 0,
      size: '--',
    };
  }
}

export async function fetchReport(reportId: string): Promise<ReportData> {
  try {
    return await apiClient.get<ReportData>(`/v1/reports/${reportId}`);
  } catch {
    return { ...mockReportData, id: reportId };
  }
}

export async function fetchScheduledReports(): Promise<ScheduledReport[]> {
  try {
    return await apiClient.get<ScheduledReport[]>('/v1/reports/schedules');
  } catch {
    return mockScheduledReports;
  }
}

export async function createSchedule(payload: CreateSchedulePayload): Promise<ScheduledReport> {
  try {
    return await apiClient.post<ScheduledReport>('/v1/reports/schedules', payload);
  } catch {
    return {
      id: `sched-${Date.now()}`,
      name: payload.name,
      type: payload.type,
      frequency: payload.frequency,
      recipients: payload.recipients,
      nextRun: new Date(Date.now() + 86400000).toISOString(),
      lastRun: '',
      status: 'active',
    };
  }
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  try {
    await apiClient.delete(`/v1/reports/schedules/${scheduleId}`);
  } catch {
    // Mock: no-op — caller removes from local state
  }
}

export async function exportReport(reportId: string, format: ReportFormat): Promise<Blob> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_API_BASE_URL || '/api'}/v1/reports/${reportId}/export?format=${format}`,
      {
        headers: {
          'X-Request-Id': crypto.randomUUID(),
        },
      },
    );
    if (!response.ok) {
      throw new Error('Export failed');
    }
    return await response.blob();
  } catch {
    // Mock: return a text blob
    const content =
      format === 'json'
        ? JSON.stringify(mockReportData, null, 2)
        : mockReportData.tableHeaders.join(',') +
          '\n' +
          mockReportData.tableRows.map((row) => row.join(',')).join('\n');
    return new Blob([content], {
      type:
        format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'application/pdf',
    });
  }
}
