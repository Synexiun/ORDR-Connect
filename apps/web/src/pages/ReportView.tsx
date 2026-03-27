/**
 * ReportView — Individual report viewer with KPIs, chart, table, and export.
 *
 * Sections:
 * - Header: report name, generated time, time range
 * - Summary KPI row
 * - Chart section (LineChart or BarChart based on type)
 * - Data table
 * - Actions: Export, Share, Schedule, Regenerate
 *
 * COMPLIANCE: No PHI rendered. Aggregate data only. Export triggers audit event.
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { LineChart } from '../components/charts/LineChart';
import { BarChart } from '../components/charts/BarChart';
import { ExportButton } from '../components/reports/ExportButton';
import {
  ChevronLeft,
  RefreshCw,
  Calendar,
  Send,
  TrendingUp,
  TrendingDown,
} from '../components/icons';
import { fetchReport, exportReport, type ReportData, type ReportFormat } from '../lib/reports-api';

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

// Determine chart type: bar for few data points or specific types, line otherwise
function shouldUseBarChart(type: string, dataPointCount: number): boolean {
  const barTypes = ['channel-analytics', 'compliance-audit', 'hipaa'];
  return barTypes.includes(type) || dataPointCount <= 4;
}

// --- Component ---

export function ReportView(): ReactNode {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const loadReport = useCallback(async () => {
    if (id === undefined) return;
    setLoading(true);
    try {
      const data = await fetchReport(id);
      setReport(data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleExport = useCallback(
    async (format: ReportFormat) => {
      if (id === undefined) return;
      const blob = await exportReport(id, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${id}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [id],
  );

  const handleRegenerate = useCallback(async () => {
    setRegenerating(true);
    // Simulate regeneration delay
    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
    await loadReport();
    setRegenerating(false);
  }, [loadReport]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading report" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <p className="text-sm text-content-secondary">Report not found.</p>
        <Button size="sm" onClick={() => navigate('/reports')}>
          Back to Reports
        </Button>
      </div>
    );
  }

  const useBar = shouldUseBarChart(report.type, report.chartData.labels.length);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            icon={<ChevronLeft className="h-3.5 w-3.5" />}
            onClick={() => navigate('/reports')}
          >
            Back
          </Button>
          <div>
            <h1 className="text-xl font-bold text-content">{report.name}</h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-content-secondary">
              <span>Generated: {formatDateTime(report.generatedAt)}</span>
              <Badge variant="info" size="sm">
                {report.timeRange}
              </Badge>
              <Badge variant="default" size="sm">
                {report.type}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<Send className="h-3.5 w-3.5" />}
            onClick={() => {
              // Share action — would open share modal in full implementation
            }}
          >
            Share
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Calendar className="h-3.5 w-3.5" />}
            onClick={() => navigate(`/reports/schedules?create=${report.type}`)}
          >
            Schedule
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={handleRegenerate}
            loading={regenerating}
          >
            Regenerate
          </Button>
          <ExportButton onExport={(format) => void handleExport(format)} />
        </div>
      </div>

      {/* Summary KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {report.summary.map((kpi) => {
          const isPositive = kpi.trend?.startsWith('+') === true;
          const isNegative = kpi.trend?.startsWith('-') === true;
          return (
            <Card key={kpi.label}>
              <div className="space-y-1">
                <p className="text-2xs font-medium uppercase tracking-wider text-content-tertiary">
                  {kpi.label}
                </p>
                <p className="text-2xl font-bold text-content">{kpi.value}</p>
                {kpi.trend !== undefined && (
                  <div
                    className={`flex items-center gap-1 text-xs ${
                      isPositive
                        ? 'text-emerald-400'
                        : isNegative
                          ? 'text-red-400'
                          : 'text-content-secondary'
                    }`}
                  >
                    {isPositive && <TrendingUp className="h-3 w-3" />}
                    {isNegative && <TrendingDown className="h-3 w-3" />}
                    <span>{kpi.trend}</span>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Chart section */}
      <Card title="Trend Analysis">
        {useBar ? (
          <BarChart
            data={report.chartData.labels.map((label, i) => ({
              label,
              value: report.chartData.datasets[0]?.data[i] ?? 0,
              color: report.chartData.datasets[0]?.color ?? '#3b82f6',
            }))}
            height={260}
            showLabels
            showValues
          />
        ) : (
          <LineChart
            series={report.chartData.datasets.map((ds) => ({
              data: report.chartData.labels.map((label, i) => ({
                x: label,
                y: ds.data[i] ?? 0,
              })),
              color: ds.color,
              label: ds.label,
            }))}
            height={260}
            showGrid
            showDots
          />
        )}
        {/* Legend */}
        {report.chartData.datasets.length > 1 && (
          <div className="mt-3 flex items-center justify-center gap-4">
            {report.chartData.datasets.map((ds) => (
              <div key={ds.label} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ds.color }} />
                <span className="text-2xs text-content-secondary">{ds.label}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Data table */}
      <Card title="Report Data" padding={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" role="grid">
            <thead>
              <tr className="border-b border-border bg-surface-tertiary/50">
                {report.tableHeaders.map((header) => (
                  <th
                    key={header}
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-content-secondary"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.tableRows.map((row, idx) => (
                <tr
                  key={idx}
                  className="bg-surface-secondary transition-colors hover:bg-surface-tertiary/50"
                >
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-4 py-3 font-mono text-xs text-content-secondary">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Footer actions */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <p className="text-2xs text-content-tertiary">
          Report ID: {report.id} | Type: {report.type} | Generated:{' '}
          {formatDateTime(report.generatedAt)}
        </p>
        <ExportButton onExport={(format) => void handleExport(format)} />
      </div>
    </div>
  );
}
