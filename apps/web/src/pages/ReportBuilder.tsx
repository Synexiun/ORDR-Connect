/**
 * ReportBuilder — Custom report builder with step wizard.
 *
 * Steps:
 * 1. Data Source — select report type
 * 2. Metrics — checkbox list of available metrics
 * 3. Filters — date range + additional filters
 * 4. Group By — time period, agent, channel, etc.
 * 5. Preview — sample chart + table
 *
 * COMPLIANCE: No PHI in filter or preview data. All previews use aggregate mock data.
 */

import { type ReactNode, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { LineChart } from '../components/charts/LineChart';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Download,
  Calendar,
  Eye,
} from '../components/icons';
import {
  mockReportTemplates,
  mockReportData,
  generateReport,
  type ReportType,
} from '../lib/reports-api';

// --- Constants ---

const STEPS = ['Data Source', 'Metrics', 'Filters', 'Group By', 'Preview'] as const;

const GROUP_BY_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'agent', label: 'Agent' },
  { value: 'channel', label: 'Channel' },
  { value: 'customer-segment', label: 'Customer Segment' },
  { value: 'region', label: 'Region' },
];

// --- Component ---

export function ReportBuilder(): ReactNode {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [selectedType, setSelectedType] = useState<ReportType | null>(null);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [dateStart, setDateStart] = useState(
    new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
  );
  const [dateEnd, setDateEnd] = useState(new Date().toISOString().slice(0, 10));
  const [groupBy, setGroupBy] = useState(['day']);
  const [saving, setSaving] = useState(false);

  const selectedTemplate = useMemo(
    () => mockReportTemplates.find((t) => t.type === selectedType) ?? null,
    [selectedType],
  );

  const availableMetrics = useMemo(() => selectedTemplate?.metrics ?? [], [selectedTemplate]);

  const toggleMetric = useCallback((metric: string) => {
    setSelectedMetrics((prev) =>
      prev.includes(metric) ? prev.filter((m) => m !== metric) : [...prev, metric],
    );
  }, []);

  const toggleGroupBy = useCallback((value: string) => {
    setGroupBy((prev) =>
      prev.includes(value) ? prev.filter((g) => g !== value) : [...prev, value],
    );
  }, []);

  const canProceed = useMemo(() => {
    switch (step) {
      case 0:
        return selectedType !== null;
      case 1:
        return selectedMetrics.length > 0;
      case 2:
        return dateStart !== '' && dateEnd !== '';
      case 3:
        return groupBy.length > 0;
      case 4:
        return true;
      default:
        return false;
    }
  }, [step, selectedType, selectedMetrics, dateStart, dateEnd, groupBy]);

  const handleSave = useCallback(async () => {
    if (!selectedType) return;
    setSaving(true);
    try {
      await generateReport(selectedType, { start: dateStart, end: dateEnd });
      void navigate('/reports');
    } finally {
      setSaving(false);
    }
  }, [selectedType, dateStart, dateEnd, navigate]);

  // --- Step renderers ---

  function renderDataSource(): ReactNode {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {mockReportTemplates.map((tmpl) => (
          <button
            key={tmpl.type}
            onClick={() => {
              setSelectedType(tmpl.type);
              // Pre-select all metrics for the type
              setSelectedMetrics(tmpl.metrics);
            }}
            className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
              selectedType === tmpl.type
                ? 'border-brand-accent bg-brand-accent/5 ring-1 ring-brand-accent/30'
                : 'border-border bg-surface-secondary hover:border-border-light hover:bg-surface-tertiary/30'
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-content">{tmpl.name}</p>
              <p className="mt-0.5 text-xs text-content-secondary">{tmpl.description}</p>
              <p className="mt-1 text-2xs text-content-tertiary">
                {tmpl.metrics.length} metrics available
              </p>
            </div>
            {selectedType === tmpl.type && (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-brand-accent" />
            )}
          </button>
        ))}
      </div>
    );
  }

  function renderMetrics(): ReactNode {
    return (
      <div className="space-y-4">
        <p className="text-sm text-content-secondary">
          Select the metrics to include in your report. At least one metric is required.
        </p>
        <div className="space-y-2">
          {availableMetrics.map((metric) => {
            const checked = selectedMetrics.includes(metric);
            return (
              <label
                key={metric}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all ${
                  checked
                    ? 'border-brand-accent/40 bg-brand-accent/5'
                    : 'border-border bg-surface-secondary hover:border-border-light'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    toggleMetric(metric);
                  }}
                  className="h-4 w-4 rounded border-border text-brand-accent focus:ring-brand-accent"
                />
                <span className="text-sm text-content">{metric}</span>
              </label>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedMetrics(availableMetrics);
            }}
          >
            Select All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedMetrics([]);
            }}
          >
            Clear All
          </Button>
        </div>
      </div>
    );
  }

  function renderFilters(): ReactNode {
    return (
      <div className="space-y-4">
        <p className="text-sm text-content-secondary">
          Set the date range and any additional filters for the report.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Start Date"
            type="date"
            value={dateStart}
            onChange={(e) => {
              setDateStart(e.target.value);
            }}
          />
          <Input
            label="End Date"
            type="date"
            value={dateEnd}
            onChange={(e) => {
              setDateEnd(e.target.value);
            }}
          />
        </div>
        <div className="rounded-lg border border-border bg-surface-secondary p-4">
          <p className="text-xs text-content-tertiary">
            Additional filters (tenant-scoped, compliance-checked):
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="info" size="sm">
              Tenant: Current
            </Badge>
            <Badge variant="success" size="sm">
              Compliance: Enforced
            </Badge>
            <Badge variant="default" size="sm">
              PHI: Excluded
            </Badge>
          </div>
        </div>
      </div>
    );
  }

  function renderGroupBy(): ReactNode {
    return (
      <div className="space-y-4">
        <p className="text-sm text-content-secondary">
          Choose how to group the report data. Multiple groupings are supported.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {GROUP_BY_OPTIONS.map((opt) => {
            const checked = groupBy.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all ${
                  checked
                    ? 'border-brand-accent/40 bg-brand-accent/5'
                    : 'border-border bg-surface-secondary hover:border-border-light'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    toggleGroupBy(opt.value);
                  }}
                  className="h-4 w-4 rounded border-border text-brand-accent focus:ring-brand-accent"
                />
                <span className="text-sm text-content">{opt.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  function renderPreview(): ReactNode {
    const previewData = mockReportData;

    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-surface-secondary p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-content">
                {selectedTemplate?.name ?? 'Custom Report'} Preview
              </p>
              <p className="text-xs text-content-secondary">
                {dateStart} to {dateEnd} | {selectedMetrics.length} metrics | Grouped by{' '}
                {groupBy.join(', ')}
              </p>
            </div>
            <Badge variant="warning" size="sm">
              Preview
            </Badge>
          </div>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {previewData.summary.map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-lg border border-border bg-surface-secondary p-3"
            >
              <p className="text-2xs text-content-tertiary">{kpi.label}</p>
              <p className="mt-0.5 text-lg font-bold text-content">{kpi.value}</p>
              {kpi.trend !== undefined && (
                <p
                  className={`text-2xs ${kpi.trend.startsWith('+') ? 'text-emerald-400' : kpi.trend.startsWith('-') ? 'text-red-400' : 'text-content-secondary'}`}
                >
                  {kpi.trend}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Sample chart */}
        <Card title="Trend">
          <LineChart
            series={previewData.chartData.datasets.map((ds) => ({
              data: previewData.chartData.labels.map((label, i) => ({
                x: label,
                y: ds.data[i] ?? 0,
              })),
              color: ds.color,
              label: ds.label,
            }))}
            height={200}
            showGrid
            showDots
          />
        </Card>

        {/* Sample table */}
        <Card title="Data Preview" padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-tertiary/50">
                  {previewData.tableHeaders.map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-content-secondary"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {previewData.tableRows.slice(0, 5).map((row, idx) => (
                  <tr key={idx} className="bg-surface-secondary">
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
      </div>
    );
  }

  const stepRenderers = [
    renderDataSource,
    renderMetrics,
    renderFilters,
    renderGroupBy,
    renderPreview,
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content">Report Builder</h1>
          <p className="mt-1 text-sm text-content-secondary">
            Create a custom report with selected data sources and metrics
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/reports')}>
          Cancel
        </Button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center">
            <button
              onClick={() => {
                if (i < step) setStep(i);
              }}
              disabled={i > step}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                i === step
                  ? 'bg-brand-accent/10 text-brand-accent'
                  : i < step
                    ? 'cursor-pointer text-emerald-400 hover:bg-surface-tertiary'
                    : 'cursor-not-allowed text-content-tertiary'
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-2xs font-bold ${
                  i === step
                    ? 'bg-brand-accent text-[#060608]'
                    : i < step
                      ? 'bg-emerald-400/20 text-emerald-400'
                      : 'bg-surface-tertiary text-content-tertiary'
                }`}
              >
                {i < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-1 h-px w-4 sm:w-8 ${i < step ? 'bg-emerald-400' : 'bg-border'}`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <Card title={STEPS[step]}>{stepRenderers[step]?.()}</Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronLeft className="h-3.5 w-3.5" />}
          onClick={() => {
            setStep((s) => Math.max(0, s - 1));
          }}
          disabled={step === 0}
        >
          Back
        </Button>

        <div className="flex items-center gap-2">
          {step === STEPS.length - 1 ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={handleSave}
                loading={saving}
              >
                Save & Export
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Calendar className="h-3.5 w-3.5" />}
                onClick={() => navigate(`/reports/schedules?create=${selectedType ?? ''}`)}
              >
                Schedule
              </Button>
              <Button
                size="sm"
                icon={<Eye className="h-3.5 w-3.5" />}
                onClick={handleSave}
                loading={saving}
              >
                Generate Report
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              icon={<ChevronRight className="h-3.5 w-3.5" />}
              onClick={() => {
                setStep((s) => Math.min(STEPS.length - 1, s + 1));
              }}
              disabled={!canProceed}
            >
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
