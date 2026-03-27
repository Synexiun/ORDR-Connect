/**
 * Reports Page — Report templates, recent reports, and schedule management.
 *
 * Sections:
 * - 8 report template cards in 2x4 grid
 * - Recent Reports table
 * - Saved Reports (link to scheduled reports)
 *
 * COMPLIANCE: No PHI rendered. Metadata and aggregate metrics only.
 * All report generation triggers server-side audit events.
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table } from '../components/ui/Table';
import { Spinner } from '../components/ui/Spinner';
import { ReportCard } from '../components/reports/ReportCard';
import { ExportButton } from '../components/reports/ExportButton';
import { Plus, Calendar, Eye, RefreshCw } from '../components/icons';
import {
  fetchReportTemplates,
  fetchRecentReports,
  fetchScheduledReports,
  generateReport,
  exportReport,
  type ReportTemplate,
  type GeneratedReport,
  type ScheduledReport,
  type ReportFormat,
} from '../lib/reports-api';

// --- Helpers ---

function formatDateTime(iso: string): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusBadgeVariant(status: GeneratedReport['status']): 'success' | 'warning' | 'danger' {
  if (status === 'completed') return 'success';
  if (status === 'generating') return 'warning';
  return 'danger';
}

// --- Component ---

export function Reports(): ReactNode {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [recentReports, setRecentReports] = useState<GeneratedReport[]>([]);
  const [schedules, setSchedules] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tmpl, recent, sched] = await Promise.allSettled([
        fetchReportTemplates(),
        fetchRecentReports(),
        fetchScheduledReports(),
      ]);
      setTemplates(tmpl.status === 'fulfilled' ? tmpl.value : []);
      setRecentReports(recent.status === 'fulfilled' ? recent.value : []);
      setSchedules(sched.status === 'fulfilled' ? sched.value : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const handleGenerate = useCallback(async (type: ReportTemplate['type']) => {
    setGenerating(type);
    try {
      const today = new Date();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
      const report = await generateReport(type, {
        start: thirtyDaysAgo.toISOString().slice(0, 10),
        end: today.toISOString().slice(0, 10),
      });
      setRecentReports((prev) => [report, ...prev]);
    } finally {
      setGenerating(null);
    }
  }, []);

  const handleSchedule = useCallback(
    (type: ReportTemplate['type']) => {
      void navigate(`/reports/schedules?create=${type}`);
    },
    [navigate],
  );

  const handleExport = useCallback(async (reportId: string, format: ReportFormat) => {
    const blob = await exportReport(reportId, format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${reportId}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Recent reports table columns
  const recentColumns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: GeneratedReport) => (
        <span className="text-sm font-medium text-content">{row.name}</span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortable: true,
      render: (row: GeneratedReport) => (
        <Badge variant="info" size="sm">
          {row.type}
        </Badge>
      ),
    },
    {
      key: 'generatedAt',
      header: 'Generated',
      sortable: true,
      render: (row: GeneratedReport) => (
        <span className="text-xs text-content-secondary">{formatDateTime(row.generatedAt)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: GeneratedReport) => (
        <Badge variant={statusBadgeVariant(row.status)} size="sm" dot>
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'size',
      header: 'Size',
      render: (row: GeneratedReport) => (
        <span className="font-mono text-xs text-content-secondary">{row.size}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: GeneratedReport) => (
        <div className="flex items-center gap-1">
          {row.status === 'completed' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={<Eye className="h-3.5 w-3.5" />}
                onClick={(e) => {
                  e.stopPropagation();
                  void navigate(`/reports/${row.id}`);
                }}
              >
                View
              </Button>
              <ExportButton onExport={(format) => void handleExport(row.id, format)} />
            </>
          )}
          {row.status === 'generating' && <Spinner size="sm" label="Generating report" />}
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading reports" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content">Reports</h1>
          <p className="mt-1 text-sm text-content-secondary">
            Generate, schedule, and export compliance-ready reports
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<Calendar className="h-3.5 w-3.5" />}
            onClick={() => navigate('/reports/schedules')}
          >
            Schedules
          </Button>
          <Button
            size="sm"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => navigate('/reports/builder')}
          >
            Create Custom Report
          </Button>
        </div>
      </div>

      {/* Report template cards — 2x4 grid */}
      <div>
        <h2 className="section-title mb-4">Report Templates</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {templates.map((tmpl) => (
            <ReportCard
              key={tmpl.type}
              template={tmpl}
              onGenerate={handleGenerate}
              onSchedule={handleSchedule}
            />
          ))}
        </div>
        {generating !== null && (
          <div className="mt-3 flex items-center gap-2 text-sm text-content-secondary">
            <Spinner size="sm" />
            <span>Generating {generating} report...</span>
          </div>
        )}
      </div>

      {/* Recent Reports table */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="section-title">Recent Reports</h2>
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={fetchAll}
          >
            Refresh
          </Button>
        </div>
        <Card padding={false}>
          <Table
            columns={recentColumns}
            data={recentReports}
            keyExtractor={(r) => r.id}
            onRowClick={(r) => {
              if (r.status === 'completed') {
                void navigate(`/reports/${r.id}`);
              }
            }}
            emptyMessage="No reports generated yet. Select a template above to get started."
          />
        </Card>
      </div>

      {/* Scheduled Reports summary */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="section-title">Saved Schedules</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate('/reports/schedules')}>
            View All
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {schedules.map((sched) => (
            <Card key={sched.id}>
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <h3 className="text-sm font-semibold text-content">{sched.name}</h3>
                  <Badge variant={sched.status === 'active' ? 'success' : 'neutral'} size="sm" dot>
                    {sched.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-content-secondary">
                  <span className="capitalize">{sched.frequency}</span>
                  <span>
                    {sched.recipients.length} recipient{sched.recipients.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <p className="text-2xs text-content-tertiary">
                  Next run: {formatDateTime(sched.nextRun)}
                </p>
              </div>
            </Card>
          ))}
          {schedules.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-content-secondary">
              No scheduled reports. Create one from a template above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
