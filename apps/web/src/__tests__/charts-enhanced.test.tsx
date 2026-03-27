/**
 * Enhanced Chart Component Tests — Phase 3
 *
 * Validates:
 * - AreaChart renders SVG with path, gradient, dots, grid, labels
 * - DonutChart renders ring segments with legend and center label
 * - HeatmapChart renders cell grid with color interpolation
 * - StackedBarChart renders stacked rect segments with legend
 * - SparkLine renders compact polyline path with trend label
 * - ProgressBar renders track, fill bar, label, percentage
 *
 * All charts are pure SVG — no external charting dependencies (Rule 8).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { AreaChart } from '../components/charts/AreaChart';
import { DonutChart } from '../components/charts/DonutChart';
import { HeatmapChart } from '../components/charts/HeatmapChart';
import { StackedBarChart } from '../components/charts/StackedBarChart';
import { SparkLine } from '../components/charts/SparkLine';
import { ProgressBar } from '../components/charts/ProgressBar';

// ─── AreaChart ───────────────────────────────────────────────────

describe('AreaChart component', () => {
  const sampleSeries = [
    { x: 'Jan', y: 100 },
    { x: 'Feb', y: 200 },
    { x: 'Mar', y: 150 },
    { x: 'Apr', y: 300 },
  ];

  it('renders SVG with role=img and aria-label', () => {
    render(createElement(AreaChart, { series: sampleSeries }));

    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toBe('Area chart');
    expect(svg.tagName).toBe('svg');
  });

  it('renders a line path element', () => {
    render(createElement(AreaChart, { series: sampleSeries }));

    const svg = screen.getByRole('img');
    const paths = svg.querySelectorAll('path');
    // At least 2 paths: gradient fill area + line path
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it('renders gradient fill area path', () => {
    render(createElement(AreaChart, { series: sampleSeries }));

    const svg = screen.getByRole('img');
    const defs = svg.querySelector('defs');
    expect(defs).toBeTruthy();
    const gradient = defs?.querySelector('linearGradient');
    expect(gradient).toBeTruthy();
  });

  it('renders dots for each data point when showDots=true', () => {
    render(createElement(AreaChart, { series: sampleSeries, showDots: true }));

    const svg = screen.getByRole('img');
    const circles = svg.querySelectorAll('circle');
    expect(circles.length).toBe(sampleSeries.length);
  });

  it('does not render dots when showDots=false', () => {
    render(createElement(AreaChart, { series: sampleSeries, showDots: false }));

    const svg = screen.getByRole('img');
    const circles = svg.querySelectorAll('circle');
    expect(circles.length).toBe(0);
  });

  it('renders dot titles with data labels', () => {
    render(createElement(AreaChart, { series: sampleSeries, showDots: true }));

    const svg = screen.getByRole('img');
    const titles = svg.querySelectorAll('circle > title');
    expect(titles.length).toBe(4);
    expect(titles[0]?.textContent).toBe('Jan: 100');
    expect(titles[1]?.textContent).toBe('Feb: 200');
  });

  it('renders grid lines when showGrid=true', () => {
    render(createElement(AreaChart, { series: sampleSeries, showGrid: true }));

    const svg = screen.getByRole('img');
    const lines = svg.querySelectorAll('line');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('renders x-axis labels', () => {
    render(createElement(AreaChart, { series: sampleSeries }));

    const svg = screen.getByRole('img');
    const texts = svg.querySelectorAll('text');
    const labelTexts = Array.from(texts).map((t) => t.textContent);
    expect(labelTexts).toContain('Jan');
  });

  it('shows "No data available" for empty series', () => {
    render(createElement(AreaChart, { series: [] }));

    expect(screen.getByText('No data available')).toBeDefined();
  });

  it('supports custom height', () => {
    render(createElement(AreaChart, { series: sampleSeries, height: 300 }));

    const svg = screen.getByRole('img');
    expect(svg.getAttribute('viewBox')).toContain('300');
  });

  it('applies custom color to line stroke', () => {
    render(createElement(AreaChart, { series: sampleSeries, color: '#ef4444' }));

    const svg = screen.getByRole('img');
    const linePath = svg.querySelectorAll('path')[1] as SVGPathElement;
    expect(linePath.getAttribute('stroke')).toBe('#ef4444');
  });
});

// ─── DonutChart ──────────────────────────────────────────────────

describe('DonutChart component', () => {
  const sampleSegments = [
    { label: 'Email', value: 45, color: '#3b82f6' },
    { label: 'Phone', value: 30, color: '#10b981' },
    { label: 'Chat', value: 25, color: '#f59e0b' },
  ];

  it('renders SVG with role=img and aria-label', () => {
    render(createElement(DonutChart, { segments: sampleSegments }));

    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toBe('Donut chart');
  });

  it('renders circle segments for each data slice', () => {
    render(createElement(DonutChart, { segments: sampleSegments }));

    const svg = screen.getByRole('img');
    // Background ring + 3 segment circles
    const circles = svg.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThanOrEqual(4);
  });

  it('renders segment aria-labels with percentages', () => {
    render(createElement(DonutChart, { segments: sampleSegments }));

    const svg = screen.getByRole('img');
    const segmentCircles = svg.querySelectorAll('circle[aria-label]');
    const labels = Array.from(segmentCircles).map((c) => c.getAttribute('aria-label'));
    expect(labels.some((l) => l !== null && l.includes('Email'))).toBe(true);
    expect(labels.some((l) => l !== null && l.includes('45%'))).toBe(true);
  });

  it('renders title elements with value and percentage', () => {
    render(createElement(DonutChart, { segments: sampleSegments }));

    const svg = screen.getByRole('img');
    const titles = svg.querySelectorAll('title');
    const titleTexts = Array.from(titles).map((t) => t.textContent);
    expect(titleTexts.some((t) => t.includes('Email: 45'))).toBe(true);
  });

  it('renders legend labels when showLabels=true', () => {
    render(createElement(DonutChart, { segments: sampleSegments, showLabels: true }));

    expect(screen.getByText('Email')).toBeDefined();
    expect(screen.getByText('Phone')).toBeDefined();
    expect(screen.getByText('Chat')).toBeDefined();
  });

  it('renders center label when provided', () => {
    render(
      createElement(DonutChart, {
        segments: sampleSegments,
        centerLabel: 'Total: 100',
      }),
    );

    const svg = screen.getByRole('img');
    const centerText = Array.from(svg.querySelectorAll('text')).find(
      (t) => t.textContent === 'Total: 100',
    );
    expect(centerText).toBeTruthy();
  });

  it('shows "No data available" for empty segments', () => {
    render(createElement(DonutChart, { segments: [] }));

    expect(screen.getByText('No data available')).toBeDefined();
  });

  it('shows "No data available" when all values are zero', () => {
    const zeroSegments = [
      { label: 'A', value: 0, color: '#000' },
      { label: 'B', value: 0, color: '#111' },
    ];
    render(createElement(DonutChart, { segments: zeroSegments }));

    expect(screen.getByText('No data available')).toBeDefined();
  });

  it('supports custom size and thickness', () => {
    render(
      createElement(DonutChart, {
        segments: sampleSegments,
        size: 240,
        thickness: 32,
      }),
    );

    const svg = screen.getByRole('img');
    expect(svg).toBeTruthy();
  });

  it('renders segment stroke colors from data', () => {
    render(createElement(DonutChart, { segments: sampleSegments }));

    const svg = screen.getByRole('img');
    const segCircles = svg.querySelectorAll('circle[stroke]');
    const strokes = Array.from(segCircles).map((c) => c.getAttribute('stroke'));
    expect(strokes).toContain('#3b82f6');
    expect(strokes).toContain('#10b981');
  });
});

// ─── HeatmapChart ────────────────────────────────────────────────

describe('HeatmapChart component', () => {
  const sampleData = [
    [1, 5, 3],
    [4, 2, 8],
  ];
  const xLabels = ['Mon', 'Tue', 'Wed'];
  const yLabels = ['Morning', 'Evening'];

  it('renders SVG with role=img and aria-label', () => {
    render(createElement(HeatmapChart, { data: sampleData, xLabels, yLabels }));

    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toBe('Heatmap chart');
  });

  it('renders correct number of rect cells', () => {
    render(createElement(HeatmapChart, { data: sampleData, xLabels, yLabels }));

    const svg = screen.getByRole('img');
    const rects = svg.querySelectorAll('rect');
    // 2 rows x 3 cols = 6 cells
    expect(rects.length).toBe(6);
  });

  it('renders cell titles with axis labels and values', () => {
    render(createElement(HeatmapChart, { data: sampleData, xLabels, yLabels }));

    const svg = screen.getByRole('img');
    const titles = svg.querySelectorAll('title');
    const titleTexts = Array.from(titles).map((t) => t.textContent);
    expect(titleTexts).toContain('Morning, Mon: 1');
    expect(titleTexts).toContain('Evening, Wed: 8');
  });

  it('renders cell aria-labels', () => {
    render(createElement(HeatmapChart, { data: sampleData, xLabels, yLabels }));

    const svg = screen.getByRole('img');
    const rects = svg.querySelectorAll('rect[aria-label]');
    const labels = Array.from(rects).map((r) => r.getAttribute('aria-label'));
    expect(labels).toContain('Morning, Tue: 5');
  });

  it('renders y-axis labels', () => {
    render(createElement(HeatmapChart, { data: sampleData, xLabels, yLabels }));

    const svg = screen.getByRole('img');
    const texts = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('Morning');
    expect(texts).toContain('Evening');
  });

  it('renders x-axis labels', () => {
    render(createElement(HeatmapChart, { data: sampleData, xLabels, yLabels }));

    const svg = screen.getByRole('img');
    const texts = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('Mon');
  });

  it('shows "No data available" for empty data', () => {
    render(createElement(HeatmapChart, { data: [], xLabels: [], yLabels: [] }));

    expect(screen.getByText('No data available')).toBeDefined();
  });

  it('cells have fill color attributes', () => {
    render(createElement(HeatmapChart, { data: sampleData, xLabels, yLabels }));

    const svg = screen.getByRole('img');
    const rects = svg.querySelectorAll('rect');
    rects.forEach((rect) => {
      const fill = rect.getAttribute('fill');
      expect(fill).toBeTruthy();
      expect(fill).toContain('rgb(');
    });
  });

  it('supports custom colorScale', () => {
    const customColors = ['#000000', '#ffffff'];
    render(
      createElement(HeatmapChart, {
        data: sampleData,
        xLabels,
        yLabels,
        colorScale: customColors,
      }),
    );

    const svg = screen.getByRole('img');
    expect(svg.querySelectorAll('rect').length).toBe(6);
  });
});

// ─── StackedBarChart ─────────────────────────────────────────────

describe('StackedBarChart component', () => {
  const categories = ['Q1', 'Q2', 'Q3'];
  const series = [
    { label: 'Revenue', data: [100, 150, 200], color: '#3b82f6' },
    { label: 'Costs', data: [50, 60, 70], color: '#ef4444' },
  ];

  it('renders SVG with role=img and aria-label', () => {
    render(createElement(StackedBarChart, { categories, series }));

    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toBe('Stacked bar chart');
  });

  it('renders rect elements for each series segment per category', () => {
    render(createElement(StackedBarChart, { categories, series }));

    const svg = screen.getByRole('img');
    const rects = svg.querySelectorAll('rect');
    // 3 categories x 2 series = 6 rects
    expect(rects.length).toBe(6);
  });

  it('renders bar titles with category, series label, and value', () => {
    render(createElement(StackedBarChart, { categories, series }));

    const svg = screen.getByRole('img');
    const titles = svg.querySelectorAll('title');
    const titleTexts = Array.from(titles).map((t) => t.textContent);
    expect(titleTexts).toContain('Q1 — Revenue: 100');
    expect(titleTexts).toContain('Q2 — Costs: 60');
  });

  it('renders bar aria-labels', () => {
    render(createElement(StackedBarChart, { categories, series }));

    const svg = screen.getByRole('img');
    const rects = svg.querySelectorAll('rect[aria-label]');
    const labels = Array.from(rects).map((r) => r.getAttribute('aria-label'));
    expect(labels).toContain('Q3 — Revenue: 200');
  });

  it('renders category labels on x-axis when showLabels=true', () => {
    render(createElement(StackedBarChart, { categories, series, showLabels: true }));

    const svg = screen.getByRole('img');
    const texts = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('Q1');
    expect(texts).toContain('Q2');
    expect(texts).toContain('Q3');
  });

  it('renders legend with series labels', () => {
    render(createElement(StackedBarChart, { categories, series }));

    expect(screen.getByText('Revenue')).toBeDefined();
    expect(screen.getByText('Costs')).toBeDefined();
  });

  it('renders legend color indicators with series colors', () => {
    render(createElement(StackedBarChart, { categories, series }));

    const legendSpans = document.querySelectorAll('span[aria-hidden="true"]');
    const colors = Array.from(legendSpans).map((s) => (s as HTMLElement).style.backgroundColor);
    // rgb equivalents of the hex values
    expect(
      colors.some(
        (c) => c.includes('59, 130, 246') || c === '#3b82f6' || c === 'rgb(59, 130, 246)',
      ),
    ).toBe(true);
  });

  it('shows "No data available" for empty categories', () => {
    render(createElement(StackedBarChart, { categories: [], series }));

    expect(screen.getByText('No data available')).toBeDefined();
  });

  it('shows "No data available" for empty series', () => {
    render(createElement(StackedBarChart, { categories, series: [] }));

    expect(screen.getByText('No data available')).toBeDefined();
  });

  it('renders grid lines when showGrid=true', () => {
    render(createElement(StackedBarChart, { categories, series, showGrid: true }));

    const svg = screen.getByRole('img');
    const lines = svg.querySelectorAll('line');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('renders bars with correct fill colors', () => {
    render(createElement(StackedBarChart, { categories, series }));

    const svg = screen.getByRole('img');
    const rects = svg.querySelectorAll('rect');
    const fills = Array.from(rects).map((r) => r.getAttribute('fill'));
    expect(fills).toContain('#3b82f6');
    expect(fills).toContain('#ef4444');
  });
});

// ─── SparkLine ───────────────────────────────────────────────────

describe('SparkLine component', () => {
  const trendingUp = [10, 15, 12, 20, 25];
  const trendingDown = [25, 20, 18, 12, 8];

  it('renders SVG with role=img', () => {
    render(createElement(SparkLine, { data: trendingUp }));

    const svg = screen.getByRole('img');
    expect(svg.tagName).toBe('svg');
  });

  it('renders aria-label with "trending up" for upward data', () => {
    render(createElement(SparkLine, { data: trendingUp }));

    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toContain('trending up');
  });

  it('renders aria-label with "trending down" for downward data', () => {
    render(createElement(SparkLine, { data: trendingDown }));

    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toContain('trending down');
  });

  it('renders a path element for the line', () => {
    render(createElement(SparkLine, { data: trendingUp }));

    const svg = screen.getByRole('img');
    const path = svg.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('d')).toContain('M');
    expect(path?.getAttribute('d')).toContain('L');
  });

  it('applies custom color to stroke', () => {
    render(createElement(SparkLine, { data: trendingUp, color: '#10b981' }));

    const svg = screen.getByRole('img');
    const path = svg.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('#10b981');
  });

  it('applies custom strokeWidth', () => {
    render(createElement(SparkLine, { data: trendingUp, strokeWidth: 3 }));

    const svg = screen.getByRole('img');
    const path = svg.querySelector('path');
    expect(path?.getAttribute('stroke-width')).toBe('3');
  });

  it('renders with custom width and height', () => {
    render(createElement(SparkLine, { data: trendingUp, width: 120, height: 32 }));

    const svg = screen.getByRole('img');
    expect(svg.getAttribute('width')).toBe('120');
    expect(svg.getAttribute('height')).toBe('32');
    expect(svg.getAttribute('viewBox')).toBe('0 0 120 32');
  });

  it('renders empty SVG for insufficient data (< 2 points)', () => {
    render(createElement(SparkLine, { data: [5] }));

    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toContain('insufficient data');
    const path = svg.querySelector('path');
    expect(path).toBeNull();
  });

  it('renders path with no fill', () => {
    render(createElement(SparkLine, { data: trendingUp }));

    const svg = screen.getByRole('img');
    const path = svg.querySelector('path');
    expect(path?.getAttribute('fill')).toBe('none');
  });

  it('renders with default 80x24 dimensions', () => {
    render(createElement(SparkLine, { data: trendingUp }));

    const svg = screen.getByRole('img');
    expect(svg.getAttribute('width')).toBe('80');
    expect(svg.getAttribute('height')).toBe('24');
  });
});

// ─── ProgressBar ─────────────────────────────────────────────────

describe('ProgressBar component', () => {
  it('renders progressbar role', () => {
    render(createElement(ProgressBar, { value: 50 }));

    const bar = screen.getByRole('progressbar');
    expect(bar).toBeDefined();
  });

  it('sets aria-valuenow to clamped value', () => {
    render(createElement(ProgressBar, { value: 75 }));

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('75');
  });

  it('sets aria-valuemin=0 and aria-valuemax=100', () => {
    render(createElement(ProgressBar, { value: 50 }));

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('clamps value to 0-100 range (over 100)', () => {
    render(createElement(ProgressBar, { value: 150 }));

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  it('clamps value to 0-100 range (under 0)', () => {
    render(createElement(ProgressBar, { value: -20 }));

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('renders percentage text when showPercentage=true', () => {
    render(createElement(ProgressBar, { value: 42, showPercentage: true }));

    expect(screen.getByText('42%')).toBeDefined();
  });

  it('does not render percentage when showPercentage=false', () => {
    render(createElement(ProgressBar, { value: 42, showPercentage: false }));

    expect(screen.queryByText('42%')).toBeNull();
  });

  it('renders label when provided', () => {
    render(createElement(ProgressBar, { value: 60, label: 'Upload Progress' }));

    expect(screen.getByText('Upload Progress')).toBeDefined();
  });

  it('uses label as aria-label when provided', () => {
    render(createElement(ProgressBar, { value: 60, label: 'Disk Usage' }));

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-label')).toBe('Disk Usage');
  });

  it('falls back to "Progress: X%" aria-label when no label prop', () => {
    render(createElement(ProgressBar, { value: 33, showPercentage: false }));

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-label')).toBe('Progress: 33%');
  });

  it('renders fill bar with correct width percentage', () => {
    render(createElement(ProgressBar, { value: 65 }));

    const bar = screen.getByRole('progressbar');
    const fill = bar.querySelector('div') as HTMLElement;
    expect(fill.style.width).toBe('65%');
  });

  it('applies custom color to fill bar', () => {
    render(createElement(ProgressBar, { value: 50, color: '#10b981' }));

    const bar = screen.getByRole('progressbar');
    const fill = bar.querySelector('div') as HTMLElement;
    expect(fill.style.backgroundColor).toBe('rgb(16, 185, 129)');
  });

  it('renders zero-width fill for value=0', () => {
    render(createElement(ProgressBar, { value: 0 }));

    const bar = screen.getByRole('progressbar');
    const fill = bar.querySelector('div') as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });

  it('renders full-width fill for value=100', () => {
    render(createElement(ProgressBar, { value: 100 }));

    const bar = screen.getByRole('progressbar');
    const fill = bar.querySelector('div') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('supports size prop sm', () => {
    render(createElement(ProgressBar, { value: 50, size: 'sm' }));

    const bar = screen.getByRole('progressbar');
    expect(bar).toBeDefined();
  });

  it('supports size prop lg', () => {
    render(createElement(ProgressBar, { value: 50, size: 'lg' }));

    const bar = screen.getByRole('progressbar');
    expect(bar).toBeDefined();
  });
});
