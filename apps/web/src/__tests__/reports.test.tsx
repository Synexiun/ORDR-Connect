/**
 * Reports Suite — Tests for Reports, ReportBuilder, ReportView, ScheduledReports pages.
 *
 * Validates:
 * - Reports: heading, 8 template cards, recent reports table, loading state
 * - ReportBuilder: step wizard, step navigation, data source selection
 * - ReportView: report header, KPI row, chart section, data table
 * - ScheduledReports: schedule table, create schedule modal, form fields
 *
 * COMPLIANCE: No PHI rendered. All report data is aggregate metadata only.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Routes, Route } from 'react-router-dom';
import { Reports } from '../pages/Reports';
import { ReportBuilder } from '../pages/ReportBuilder';
import { ReportView } from '../pages/ReportView';
import { ScheduledReports } from '../pages/ScheduledReports';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('../lib/api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

// ─── Helpers ────────────────────────────────────────────────────

function renderReports(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(Reports)));
}

function renderReportBuilder(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(ReportBuilder)));
}

function renderReportView(): ReturnType<typeof render> {
  // ReportView uses useParams<{ id: string }>(), so we need MemoryRouter
  // with a route that provides the :id param
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: ['/reports/rpt-001'] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/reports/:id', element: createElement(ReportView) }),
      ),
    ),
  );
}

function renderScheduledReports(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(ScheduledReports)));
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom does not implement HTMLDialogElement.showModal/close
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════
// Reports Page
// ═══════════════════════════════════════════════════════════════════

describe('Reports', () => {
  it('renders page heading', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      expect(screen.getByText('Reports')).toBeDefined();
    });
  });

  it('renders page subtitle', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      expect(
        screen.getByText('Generate, schedule, and export compliance-ready reports'),
      ).toBeDefined();
    });
  });

  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    renderReports();

    expect(screen.getByText('Loading reports')).toBeDefined();
  });

  it('renders 8 report template cards with mock data', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      // Each template name appears at least once (in template card)
      expect(screen.getAllByText('Operations Summary').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Agent Performance').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Compliance Audit').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Channel Analytics').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Customer Health').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Revenue').length).toBeGreaterThan(0);
      expect(screen.getAllByText('HIPAA Compliance').length).toBeGreaterThan(0);
      expect(screen.getAllByText('SLA Report').length).toBeGreaterThan(0);
    });
  });

  it('shows Report Templates section title', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      expect(screen.getByText('Report Templates')).toBeDefined();
    });
  });

  it('shows Recent Reports section title', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      expect(screen.getByText('Recent Reports')).toBeDefined();
    });
  });

  it('renders recent reports table with column headers', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeDefined();
      expect(screen.getByText('Type')).toBeDefined();
      expect(screen.getByText('Status')).toBeDefined();
    });
  });

  it('shows recent report entries from mock data', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      // "Operations Summary" appears in both template card and recent report
      const opsSummary = screen.getAllByText(/Operations Summary/);
      expect(opsSummary.length).toBeGreaterThan(1);
      // "Agent Performance" appears in both template card and recent report
      const agentPerf = screen.getAllByText(/Agent Performance/);
      expect(agentPerf.length).toBeGreaterThan(1);
    });
  });

  it('shows Saved Schedules section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      expect(screen.getByText('Saved Schedules')).toBeDefined();
    });
  });

  it('shows schedule cards from mock data', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      expect(screen.getByText('Weekly Operations Summary')).toBeDefined();
      expect(screen.getByText('Monthly HIPAA Report')).toBeDefined();
    });
  });

  it('shows Create Custom Report button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      expect(screen.getByText('Create Custom Report')).toBeDefined();
    });
  });

  it('shows Schedules navigation button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      expect(screen.getByText('Schedules')).toBeDefined();
    });
  });

  it('shows Refresh button for recent reports', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeDefined();
    });
  });

  it('shows View All button for schedules', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      expect(screen.getByText('View All')).toBeDefined();
    });
  });

  it('renders Generate buttons on template cards', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      const generateButtons = screen.getAllByText('Generate');
      expect(generateButtons.length).toBe(8);
    });
  });

  it('renders Schedule buttons on template cards', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      const scheduleButtons = screen.getAllByText('Schedule');
      expect(scheduleButtons.length).toBe(8);
    });
  });

  it('shows metrics badge on template cards', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      const metricsBadges = screen.getAllByText('5 metrics');
      expect(metricsBadges.length).toBeGreaterThan(0);
    });
  });

  it('shows completed status on recent reports', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      const completedBadges = screen.getAllByText('completed');
      expect(completedBadges.length).toBeGreaterThan(0);
    });
  });

  it('shows generating status on in-progress report', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      expect(screen.getByText('generating')).toBeDefined();
    });
  });

  it('shows View button for completed reports', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      const viewButtons = screen.getAllByText('View');
      expect(viewButtons.length).toBeGreaterThan(0);
    });
  });

  it('shows active/paused status on schedule cards', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      const activeStatuses = screen.getAllByText('active');
      expect(activeStatuses.length).toBeGreaterThan(0);
    });
  });

  it('shows frequency on schedule cards', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      expect(screen.getByText('weekly')).toBeDefined();
      expect(screen.getByText('monthly')).toBeDefined();
    });
  });

  it('shows recipient count on schedule cards', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReports();

    await waitFor(() => {
      const twoRecipients = screen.getAllByText('2 recipients');
      expect(twoRecipients.length).toBeGreaterThan(0);
      const oneRecipient = screen.getAllByText('1 recipient');
      expect(oneRecipient.length).toBeGreaterThan(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ReportBuilder Page
// ═══════════════════════════════════════════════════════════════════

describe('ReportBuilder', () => {
  it('renders page heading', () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    expect(screen.getByText('Report Builder')).toBeDefined();
  });

  it('renders page subtitle', () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    expect(
      screen.getByText('Create a custom report with selected data sources and metrics'),
    ).toBeDefined();
  });

  it('renders all 5 step labels in step indicator', () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    // "Data Source" appears as step label AND as the Card title, so multiple matches
    const dataSources = screen.getAllByText('Data Source');
    expect(dataSources.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Metrics')).toBeDefined();
    expect(screen.getByText('Filters')).toBeDefined();
    expect(screen.getByText('Group By')).toBeDefined();
    expect(screen.getByText('Preview')).toBeDefined();
  });

  it('shows Cancel button', () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('shows Back button', () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    expect(screen.getByText('Back')).toBeDefined();
  });

  it('shows Next button on first step', () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    expect(screen.getByText('Next')).toBeDefined();
  });

  it('renders data source options (8 templates)', () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    expect(screen.getByText('Operations Summary')).toBeDefined();
    expect(screen.getByText('Agent Performance')).toBeDefined();
    expect(screen.getByText('Compliance Audit')).toBeDefined();
    expect(screen.getByText('Channel Analytics')).toBeDefined();
    expect(screen.getByText('Customer Health')).toBeDefined();
    expect(screen.getByText('Revenue')).toBeDefined();
    expect(screen.getByText('HIPAA Compliance')).toBeDefined();
    expect(screen.getByText('SLA Report')).toBeDefined();
  });

  it('shows metrics count for each template', () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    const metricsCounts = screen.getAllByText('5 metrics available');
    expect(metricsCounts.length).toBe(8);
  });

  it('navigates to Metrics step after selecting a data source', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    act(() => {
      fireEvent.click(screen.getByText('Operations Summary'));
    });

    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          'Select the metrics to include in your report. At least one metric is required.',
        ),
      ).toBeDefined();
    });
  });

  it('shows Select All and Clear All buttons on Metrics step', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    act(() => {
      fireEvent.click(screen.getByText('Operations Summary'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(screen.getByText('Select All')).toBeDefined();
      expect(screen.getByText('Clear All')).toBeDefined();
    });
  });

  it('shows operations metrics on Metrics step after selecting Operations', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    act(() => {
      fireEvent.click(screen.getByText('Operations Summary'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(screen.getByText('Throughput')).toBeDefined();
      expect(screen.getByText('SLA Adherence')).toBeDefined();
      expect(screen.getByText('Queue Depth')).toBeDefined();
      expect(screen.getByText('Avg Resolution Time')).toBeDefined();
      expect(screen.getByText('Active Sessions')).toBeDefined();
    });
  });

  it('navigates to Filters step', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    act(() => {
      fireEvent.click(screen.getByText('Operations Summary'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(
        screen.getByText('Set the date range and any additional filters for the report.'),
      ).toBeDefined();
    });
  });

  it('shows compliance badges on Filters step', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    act(() => {
      fireEvent.click(screen.getByText('Operations Summary'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(screen.getByText('Tenant: Current')).toBeDefined();
      expect(screen.getByText('Compliance: Enforced')).toBeDefined();
      expect(screen.getByText('PHI: Excluded')).toBeDefined();
    });
  });

  it('navigates to Group By step', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    act(() => {
      fireEvent.click(screen.getByText('Operations Summary'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(
        screen.getByText('Choose how to group the report data. Multiple groupings are supported.'),
      ).toBeDefined();
    });
  });

  it('shows group by options', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    act(() => {
      fireEvent.click(screen.getByText('Operations Summary'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(screen.getByText('Day')).toBeDefined();
      expect(screen.getByText('Week')).toBeDefined();
      expect(screen.getByText('Month')).toBeDefined();
      expect(screen.getByText('Agent')).toBeDefined();
      expect(screen.getByText('Channel')).toBeDefined();
      expect(screen.getByText('Customer Segment')).toBeDefined();
      expect(screen.getByText('Region')).toBeDefined();
    });
  });

  it('navigates to Preview step and shows final buttons', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    act(() => {
      fireEvent.click(screen.getByText('Operations Summary'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(screen.getByText('Save & Export')).toBeDefined();
      expect(screen.getByText('Generate Report')).toBeDefined();
    });
  });

  it('shows Preview badge on Preview step', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    act(() => {
      fireEvent.click(screen.getByText('Operations Summary'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      const previews = screen.getAllByText('Preview');
      expect(previews.length).toBeGreaterThan(0);
    });
  });

  it('shows summary KPIs on Preview step', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    act(() => {
      fireEvent.click(screen.getByText('Operations Summary'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(screen.getByText('Total Sessions')).toBeDefined();
      expect(screen.getByText('12,480')).toBeDefined();
      expect(screen.getByText('Resolution Rate')).toBeDefined();
      // 94.7% appears both in KPI value and table row data
      const rateMatches = screen.getAllByText('94.7%');
      expect(rateMatches.length).toBeGreaterThan(0);
    });
  });

  it('shows Data Preview table on Preview step', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    act(() => {
      fireEvent.click(screen.getByText('Operations Summary'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(screen.getByText('Data Preview')).toBeDefined();
      expect(screen.getByText('Date')).toBeDefined();
      // "Sessions" appears in KPI label and table header
      const sessionsMatches = screen.getAllByText('Sessions');
      expect(sessionsMatches.length).toBeGreaterThan(0);
    });
  });

  it('can navigate back to previous step', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportBuilder();

    act(() => {
      fireEvent.click(screen.getByText('Operations Summary'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          'Select the metrics to include in your report. At least one metric is required.',
        ),
      ).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('Back'));
    });

    await waitFor(() => {
      expect(screen.getByText('Operations Summary')).toBeDefined();
      expect(screen.getByText('Agent Performance')).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ReportView Page
// ═══════════════════════════════════════════════════════════════════

describe('ReportView', () => {
  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    renderReportView();

    expect(screen.getByText('Loading report')).toBeDefined();
  });

  it('renders report name from mock data', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      expect(screen.getAllByText(/Operations Summary/).length).toBeGreaterThan(0);
    });
  });

  it('shows time range badge', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      expect(screen.getAllByText(/Mar 1/).length).toBeGreaterThan(0);
    });
  });

  it('renders summary KPI cards', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      expect(screen.getByText('Total Sessions')).toBeDefined();
      expect(screen.getByText('12,480')).toBeDefined();
      expect(screen.getByText('Resolution Rate')).toBeDefined();
      expect(screen.getByText('Avg Response Time')).toBeDefined();
      // "34s" appears in both KPI card and table row data
      expect(screen.getAllByText('34s').length).toBeGreaterThan(0);
      expect(screen.getByText('SLA Adherence')).toBeDefined();
      // "99.2%" appears in both KPI card and table row
      expect(screen.getAllByText('99.2%').length).toBeGreaterThan(0);
    });
  });

  it('shows KPI trend values', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      expect(screen.getByText('+8.2%')).toBeDefined();
      expect(screen.getByText('+2.1%')).toBeDefined();
      expect(screen.getByText('-12.5%')).toBeDefined();
      expect(screen.getByText('+0.4%')).toBeDefined();
    });
  });

  it('renders Trend Analysis chart section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      expect(screen.getByText('Trend Analysis')).toBeDefined();
    });
  });

  it('renders Report Data table section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      expect(screen.getByText('Report Data')).toBeDefined();
    });
  });

  it('renders table headers', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      expect(screen.getByText('Date')).toBeDefined();
      // "Sessions" appears in KPI label and table header
      const sessionsMatches = screen.getAllByText('Sessions');
      expect(sessionsMatches.length).toBeGreaterThan(0);
      const resolutionsMatches = screen.getAllByText('Resolutions');
      expect(resolutionsMatches.length).toBeGreaterThan(0);
      expect(screen.getByText('Rate')).toBeDefined();
      expect(screen.getByText('Avg Time')).toBeDefined();
      expect(screen.getByText('SLA Met')).toBeDefined();
    });
  });

  it('renders table data rows', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      // Dates appear in both the LineChart x-axis labels and table rows
      expect(screen.getAllByText('Mar 19').length).toBeGreaterThan(0);
      expect(screen.getByText('1,620')).toBeDefined();
      expect(screen.getByText('1,535')).toBeDefined();
    });
  });

  it('shows all 7 data rows', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      // Dates appear in both LineChart axis labels and table cells
      expect(screen.getAllByText('Mar 19').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Mar 20').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Mar 21').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Mar 22').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Mar 23').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Mar 24').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Mar 25').length).toBeGreaterThan(0);
    });
  });

  it('shows Back button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      expect(screen.getByText('Back')).toBeDefined();
    });
  });

  it('shows Share button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      expect(screen.getByText('Share')).toBeDefined();
    });
  });

  it('shows Schedule button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      expect(screen.getByText('Schedule')).toBeDefined();
    });
  });

  it('shows Regenerate button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      expect(screen.getByText('Regenerate')).toBeDefined();
    });
  });

  it('shows Export buttons', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      const exportButtons = screen.getAllByText('Export');
      // Two Export buttons: header actions and footer actions
      expect(exportButtons.length).toBe(2);
    });
  });

  it('shows report type badge', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      expect(screen.getByText('operations')).toBeDefined();
    });
  });

  it('shows report footer with report ID', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      const footerText = screen.getByText(/Report ID:/);
      expect(footerText).toBeDefined();
    });
  });

  it('renders chart legend for multi-dataset reports', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderReportView();

    await waitFor(() => {
      // Mock data has 2 datasets: Sessions and Resolutions
      // Both appear as KPI labels and as chart legend items
      const sessionsMatches = screen.getAllByText('Sessions');
      expect(sessionsMatches.length).toBeGreaterThanOrEqual(2);
      const resolutionsMatches = screen.getAllByText('Resolutions');
      expect(resolutionsMatches.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('does NOT expose PHI in rendered output', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    const { container } = renderReportView();

    await waitFor(() => {
      expect(screen.getByText('Total Sessions')).toBeDefined();
    });

    const allText = container.textContent;
    // No real patient names or SSN patterns
    expect(allText).not.toMatch(/\d{3}-\d{2}-\d{4}/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ScheduledReports Page
// ═══════════════════════════════════════════════════════════════════

describe('ScheduledReports', () => {
  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    renderScheduledReports();

    expect(screen.getByText('Loading scheduled reports')).toBeDefined();
  });

  it('renders page heading', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Scheduled Reports')).toBeDefined();
    });
  });

  it('shows schedule count in subtitle', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('3 schedules configured')).toBeDefined();
    });
  });

  it('shows Create Schedule button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Create Schedule')).toBeDefined();
    });
  });

  it('shows Refresh button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeDefined();
    });
  });

  it('shows Reports back button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Reports')).toBeDefined();
    });
  });

  it('renders schedule table with column headers', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeDefined();
      expect(screen.getByText('Type')).toBeDefined();
      expect(screen.getByText('Frequency')).toBeDefined();
      expect(screen.getByText('Recipients')).toBeDefined();
      expect(screen.getByText('Next Run')).toBeDefined();
      expect(screen.getByText('Last Run')).toBeDefined();
      expect(screen.getByText('Status')).toBeDefined();
      expect(screen.getByText('Actions')).toBeDefined();
    });
  });

  it('renders mock schedule rows', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Weekly Operations Summary')).toBeDefined();
      expect(screen.getByText('Monthly HIPAA Report')).toBeDefined();
      expect(screen.getByText('Daily Agent Performance')).toBeDefined();
    });
  });

  it('shows frequency values in schedule rows', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('weekly')).toBeDefined();
      expect(screen.getByText('monthly')).toBeDefined();
      expect(screen.getByText('daily')).toBeDefined();
    });
  });

  it('shows recipient counts', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      const twoRecipients = screen.getAllByText('2 recipients');
      expect(twoRecipients.length).toBeGreaterThan(0);
      const oneRecipient = screen.getAllByText('1 recipient');
      expect(oneRecipient.length).toBeGreaterThan(0);
    });
  });

  it('shows active and paused status badges', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      const activeStatuses = screen.getAllByText('active');
      expect(activeStatuses.length).toBe(2);
      expect(screen.getByText('paused')).toBeDefined();
    });
  });

  it('shows Edit button for each schedule row', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      const editButtons = screen.getAllByText('Edit');
      expect(editButtons.length).toBe(3);
    });
  });

  it('shows Pause button for active schedules', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      const pauseButtons = screen.getAllByText('Pause');
      expect(pauseButtons.length).toBe(2);
    });
  });

  it('shows Resume button for paused schedules', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Resume')).toBeDefined();
    });
  });

  it('shows Delete button for each schedule row', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      const deleteButtons = screen.getAllByText('Delete');
      expect(deleteButtons.length).toBe(3);
    });
  });

  it('opens Create Schedule modal on button click', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Scheduled Reports')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('Create Schedule'));
    });

    await waitFor(() => {
      // Modal renders with form fields
      expect(screen.getByText('Schedule Name')).toBeDefined();
      expect(screen.getByText('Report Type')).toBeDefined();
      // "Frequency" appears both as table header and modal form label
      const freqMatches = screen.getAllByText('Frequency');
      expect(freqMatches.length).toBeGreaterThanOrEqual(2);
      // "Recipients" appears both as table header and modal form label
      const recipientMatches = screen.getAllByText('Recipients');
      expect(recipientMatches.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows Cancel button in create modal', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Scheduled Reports')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('Create Schedule'));
    });

    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeDefined();
    });
  });

  it('modal shows report type select field', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Scheduled Reports')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('Create Schedule'));
    });

    await waitFor(() => {
      expect(screen.getByText('Report Type')).toBeDefined();
    });
  });

  it('modal shows frequency select field', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Scheduled Reports')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('Create Schedule'));
    });

    await waitFor(() => {
      // "Frequency" exists in both the table header and the modal form
      const freqMatches = screen.getAllByText('Frequency');
      expect(freqMatches.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows PHI compliance helper text in modal', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Scheduled Reports')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('Create Schedule'));
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          'Comma-separated email addresses. Reports are sent with PHI excluded per compliance policy.',
        ),
      ).toBeDefined();
    });
  });

  it('toggles pause to resume on an active schedule', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Weekly Operations Summary')).toBeDefined();
    });

    const initialPauseButtons = screen.getAllByText('Pause');
    expect(initialPauseButtons.length).toBe(2);

    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      fireEvent.click(initialPauseButtons[0]!);
    });

    await waitFor(() => {
      const pauseAfter = screen.getAllByText('Pause');
      const resumeAfter = screen.getAllByText('Resume');
      expect(pauseAfter.length).toBe(1);
      expect(resumeAfter.length).toBe(2);
    });
  });

  it('opens Edit Schedule modal when clicking Edit', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Weekly Operations Summary')).toBeDefined();
    });

    const editButtons = screen.getAllByText('Edit');
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      fireEvent.click(editButtons[0]!);
    });

    await waitFor(() => {
      expect(screen.getByText('Edit Schedule')).toBeDefined();
      expect(screen.getByText('Update Schedule')).toBeDefined();
    });
  });

  it('does NOT expose PHI in rendered output', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    const { container } = renderScheduledReports();

    await waitFor(() => {
      expect(screen.getByText('Scheduled Reports')).toBeDefined();
    });

    const allText = container.textContent;
    // No SSN patterns
    expect(allText).not.toMatch(/\d{3}-\d{2}-\d{4}/);
  });
});
