/**
 * Compliance Dashboard — SOC2 / ISO27001 / HIPAA compliance monitoring.
 *
 * Displays compliance score, violations, consent status, and regulation filters.
 * All violation data is metadata-only; no PHI is rendered.
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table } from '../components/ui/Table';
import { Spinner } from '../components/ui/Spinner';
import { apiClient } from '../lib/api';

// --- Types ---

interface ComplianceOverview {
  score: number;
  totalChecks: number;
  passingChecks: number;
  failingChecks: number;
  lastAudit: string;
}

interface Violation {
  id: string;
  rule: string;
  regulation: 'HIPAA' | 'FDCPA' | 'TCPA' | 'GDPR' | 'SOC2' | 'ISO27001';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  customerId: string;
  customerName: string;
  timestamp: string;
  resolved: boolean;
}

interface ConsentStatus {
  channel: string;
  consented: number;
  total: number;
  percentage: number;
}

// --- Constants ---

const severityBadge: Record<Violation['severity'], 'danger' | 'warning' | 'info' | 'neutral'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'info',
};

const regulationColors: Record<string, string> = {
  HIPAA: 'bg-red-500/15 text-red-400',
  FDCPA: 'bg-amber-500/15 text-amber-400',
  TCPA: 'bg-orange-500/15 text-orange-400',
  GDPR: 'bg-blue-500/15 text-blue-400',
  SOC2: 'bg-purple-500/15 text-purple-400',
  ISO27001: 'bg-emerald-500/15 text-emerald-400',
};

// --- Mock data ---

const mockOverview: ComplianceOverview = {
  score: 96,
  totalChecks: 247,
  passingChecks: 237,
  failingChecks: 10,
  lastAudit: new Date(Date.now() - 3600000).toISOString(),
};

const mockViolations: Violation[] = [
  { id: 'v-001', rule: 'TCPA-quiet-hours', regulation: 'TCPA', severity: 'high', description: 'Outbound call attempted during quiet hours (9PM-8AM local)', customerId: 'cust-0012', customerName: 'Oscorp', timestamp: new Date(Date.now() - 1800000).toISOString(), resolved: false },
  { id: 'v-002', rule: 'HIPAA-phi-logging', regulation: 'HIPAA', severity: 'critical', description: 'PHI field detected in structured log output — automatically redacted', customerId: 'cust-0005', customerName: 'Stark Industries', timestamp: new Date(Date.now() - 3600000).toISOString(), resolved: true },
  { id: 'v-003', rule: 'FDCPA-frequency', regulation: 'FDCPA', severity: 'medium', description: 'Contact frequency exceeded 7-day limit for collection communications', customerId: 'cust-0008', customerName: 'Pied Piper', timestamp: new Date(Date.now() - 7200000).toISOString(), resolved: false },
  { id: 'v-004', rule: 'GDPR-consent-expired', regulation: 'GDPR', severity: 'medium', description: 'Marketing consent expired, communication blocked automatically', customerId: 'cust-0003', customerName: 'Initech', timestamp: new Date(Date.now() - 14400000).toISOString(), resolved: true },
  { id: 'v-005', rule: 'SOC2-access-anomaly', regulation: 'SOC2', severity: 'low', description: 'Unusual access pattern detected — additional verification triggered', customerId: 'cust-0015', customerName: 'Massive Dynamic', timestamp: new Date(Date.now() - 21600000).toISOString(), resolved: true },
  { id: 'v-006', rule: 'TCPA-do-not-call', regulation: 'TCPA', severity: 'high', description: 'Number on DNC registry — outbound call blocked', customerId: 'cust-0007', customerName: 'LexCorp', timestamp: new Date(Date.now() - 28800000).toISOString(), resolved: true },
  { id: 'v-007', rule: 'ISO27001-key-rotation', regulation: 'ISO27001', severity: 'low', description: 'Encryption key approaching 75-day rotation threshold — scheduled for rotation', customerId: 'cust-0000', customerName: 'System', timestamp: new Date(Date.now() - 43200000).toISOString(), resolved: false },
  { id: 'v-008', rule: 'HIPAA-min-necessary', regulation: 'HIPAA', severity: 'medium', description: 'Agent requested data beyond minimum necessary scope — request denied', customerId: 'cust-0002', customerName: 'Globex Inc', timestamp: new Date(Date.now() - 57600000).toISOString(), resolved: true },
];

const mockConsent: ConsentStatus[] = [
  { channel: 'SMS', consented: 2341, total: 2847, percentage: 82.2 },
  { channel: 'Email', consented: 2689, total: 2847, percentage: 94.5 },
  { channel: 'Voice', consented: 1923, total: 2847, percentage: 67.5 },
  { channel: 'Chat', consented: 2156, total: 2847, percentage: 75.7 },
];

// --- Component ---

export function Compliance(): ReactNode {
  const [overview, setOverview] = useState<ComplianceOverview | null>(null);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [consent, setConsent] = useState<ConsentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [regulationFilter, setRegulationFilter] = useState<string>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [overRes, violRes, consentRes] = await Promise.allSettled([
        apiClient.get<ComplianceOverview>('/v1/compliance/overview'),
        apiClient.get<{ violations: Violation[] }>('/v1/compliance/violations'),
        apiClient.get<{ channels: ConsentStatus[] }>('/v1/compliance/consent'),
      ]);

      setOverview(overRes.status === 'fulfilled' ? overRes.value : mockOverview);
      setViolations(violRes.status === 'fulfilled' ? violRes.value.violations : mockViolations);
      setConsent(consentRes.status === 'fulfilled' ? consentRes.value.channels : mockConsent);
    } catch {
      setOverview(mockOverview);
      setViolations(mockViolations);
      setConsent(mockConsent);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const filteredViolations =
    regulationFilter === 'all'
      ? violations
      : violations.filter((v) => v.regulation === regulationFilter);

  function scoreColor(score: number): string {
    if (score >= 90) return 'text-emerald-400';
    if (score >= 75) return 'text-amber-400';
    return 'text-red-400';
  }

  function scoreRingColor(score: number): string {
    if (score >= 90) return 'stroke-emerald-400';
    if (score >= 75) return 'stroke-amber-400';
    return 'stroke-red-400';
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading compliance data" />
      </div>
    );
  }

  const score = overview?.score ?? 0;
  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference - (score / 100) * circumference;

  const violationColumns = [
    {
      key: 'severity',
      header: 'Severity',
      sortable: true,
      render: (row: Violation) => (
        <Badge variant={severityBadge[row.severity]} size="sm">
          {row.severity}
        </Badge>
      ),
    },
    {
      key: 'rule',
      header: 'Rule',
      render: (row: Violation) => (
        <span className="font-mono text-xs text-content">{row.rule}</span>
      ),
    },
    {
      key: 'regulation',
      header: 'Regulation',
      sortable: true,
      render: (row: Violation) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-2xs font-medium ${regulationColors[row.regulation] ?? ''}`}>
          {row.regulation}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      className: 'max-w-xs',
      render: (row: Violation) => (
        <p className="truncate text-xs text-content-secondary">{row.description}</p>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (row: Violation) => (
        <span className="text-xs text-content-secondary">{row.customerName}</span>
      ),
    },
    {
      key: 'timestamp',
      header: 'Time',
      sortable: true,
      render: (row: Violation) => (
        <span className="text-xs text-content-tertiary">
          {new Date(row.timestamp).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Violation) => (
        <Badge variant={row.resolved ? 'success' : 'warning'} dot size="sm">
          {row.resolved ? 'Resolved' : 'Open'}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content">Compliance</h1>
          <p className="mt-1 text-sm text-content-secondary">
            SOC2 / ISO 27001 / HIPAA compliance monitoring
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchData}>
          Refresh
        </Button>
      </div>

      {/* Score + overview */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Score gauge */}
        <Card className="flex items-center justify-center">
          <div className="flex flex-col items-center py-4">
            <div className="relative h-32 w-32">
              <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120" aria-label={`Compliance score: ${score}%`}>
                <circle
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  className="text-surface-tertiary"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  strokeWidth="8"
                  strokeLinecap="round"
                  className={scoreRingColor(score)}
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-3xl font-bold ${scoreColor(score)}`}>{score}</span>
                <span className="text-2xs text-content-tertiary">/ 100</span>
              </div>
            </div>
            <p className="mt-3 text-sm font-medium text-content">Compliance Score</p>
            <p className="text-2xs text-content-tertiary">
              Last audit: {new Date(overview?.lastAudit ?? '').toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </Card>

        {/* Stats */}
        <Card title="Check Summary">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-content-secondary">Total Checks</span>
              <span className="text-sm font-semibold text-content">{overview?.totalChecks ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-content-secondary">Passing</span>
              <span className="text-sm font-semibold text-emerald-400">{overview?.passingChecks ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-content-secondary">Failing</span>
              <span className="text-sm font-semibold text-red-400">{overview?.failingChecks ?? 0}</span>
            </div>
            <div className="h-2 rounded-full bg-surface-tertiary">
              <div
                className="h-2 rounded-full bg-emerald-400"
                style={{
                  width: `${overview ? (overview.passingChecks / overview.totalChecks) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </Card>

        {/* Consent overview */}
        <Card title="Consent by Channel">
          <div className="space-y-3">
            {consent.map((ch) => (
              <div key={ch.channel}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-content-secondary">{ch.channel}</span>
                  <span className="text-content">
                    {ch.consented}/{ch.total} ({ch.percentage}%)
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-tertiary">
                  <div
                    className="h-1.5 rounded-full bg-brand-accent"
                    style={{ width: `${ch.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Violations */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Recent Violations</h2>
          <div className="flex items-center gap-1">
            {['all', 'HIPAA', 'FDCPA', 'TCPA', 'GDPR', 'SOC2', 'ISO27001'].map((reg) => (
              <Button
                key={reg}
                variant={regulationFilter === reg ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setRegulationFilter(reg)}
              >
                {reg === 'all' ? 'All' : reg}
              </Button>
            ))}
          </div>
        </div>

        <Table
          columns={violationColumns}
          data={filteredViolations}
          keyExtractor={(v) => v.id}
          emptyMessage="No violations found for the selected regulation."
        />
      </div>
    </div>
  );
}
