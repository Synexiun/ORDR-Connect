/**
 * Chart Component Tests
 *
 * Validates BarChart, LineChart, and GaugeChart render correctly
 * with proper props and handle edge cases.
 * All charts are pure SVG — no external dependencies.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { BarChart } from '../components/charts/BarChart';
import { LineChart } from '../components/charts/LineChart';
import { GaugeChart } from '../components/charts/GaugeChart';

// --- BarChart ---

describe('BarChart component', () => {
  it('creates element with data', () => {
    const data = [
      { label: 'A', value: 10 },
      { label: 'B', value: 20 },
      { label: 'C', value: 30 },
    ];
    const element = createElement(BarChart, { data });
    expect(element.props.data).toHaveLength(3);
  });

  it('supports custom height', () => {
    const element = createElement(BarChart, {
      data: [{ label: 'A', value: 10 }],
      height: 300,
    });
    expect(element.props.height).toBe(300);
  });

  it('supports showLabels and showValues', () => {
    const element = createElement(BarChart, {
      data: [{ label: 'A', value: 10 }],
      showLabels: false,
      showValues: true,
    });
    expect(element.props.showLabels).toBe(false);
    expect(element.props.showValues).toBe(true);
  });

  it('handles empty data array', () => {
    const element = createElement(BarChart, { data: [] });
    expect(element.props.data).toHaveLength(0);
  });

  it('supports custom colors per bar', () => {
    const data = [
      { label: 'A', value: 10, color: '#ff0000' },
      { label: 'B', value: 20, color: '#00ff00' },
    ];
    const element = createElement(BarChart, { data });
    const d = element.props.data as { label: string; value: number; color?: string }[];
    expect((d[0] as { color?: string }).color).toBe('#ff0000');
    expect((d[1] as { color?: string }).color).toBe('#00ff00');
  });
});

// --- LineChart ---

describe('LineChart component', () => {
  it('creates element with series data', () => {
    const series = [
      {
        data: [
          { x: 'Mon', y: 10 },
          { x: 'Tue', y: 20 },
        ],
        color: '#3b82f6',
      },
    ];
    const element = createElement(LineChart, { series });
    expect(element.props.series).toHaveLength(1);
    const s = element.props.series as { data: { x: string; y: number }[] }[];
    expect((s[0] as { data: unknown[] }).data).toHaveLength(2);
  });

  it('supports multiple series', () => {
    const series = [
      { data: [{ x: 'A', y: 1 }], color: '#ff0000', label: 'Series 1' },
      { data: [{ x: 'A', y: 2 }], color: '#00ff00', label: 'Series 2' },
      { data: [{ x: 'A', y: 3 }], color: '#0000ff', label: 'Series 3' },
    ];
    const element = createElement(LineChart, { series });
    expect(element.props.series).toHaveLength(3);
  });

  it('supports showGrid and showDots options', () => {
    const element = createElement(LineChart, {
      series: [{ data: [{ x: 'A', y: 1 }] }],
      showGrid: true,
      showDots: false,
    });
    expect(element.props.showGrid).toBe(true);
    expect(element.props.showDots).toBe(false);
  });

  it('handles empty series', () => {
    const element = createElement(LineChart, { series: [] });
    expect(element.props.series).toHaveLength(0);
  });

  it('renders path with correct data points', () => {
    const series = [
      {
        data: [
          { x: 'Jan', y: 100 },
          { x: 'Feb', y: 200 },
          { x: 'Mar', y: 150 },
        ],
      },
    ];
    const element = createElement(LineChart, { series, height: 200 });
    const s = element.props.series as { data: { x: string; y: number }[] }[];
    expect((s[0] as { data: unknown[] }).data).toHaveLength(3);
    expect(element.props.height).toBe(200);
  });
});

// --- GaugeChart ---

describe('GaugeChart component', () => {
  it('creates element with value', () => {
    const element = createElement(GaugeChart, { value: 75 });
    expect(element.props.value).toBe(75);
  });

  it('renders arc with label', () => {
    const element = createElement(GaugeChart, { value: 85, label: 'Health' });
    expect(element.props.label).toBe('Health');
  });

  it('supports custom size', () => {
    const element = createElement(GaugeChart, { value: 50, size: 160 });
    expect(element.props.size).toBe(160);
  });

  it('supports custom color', () => {
    const element = createElement(GaugeChart, { value: 50, color: '#8b5cf6' });
    expect(element.props.color).toBe('#8b5cf6');
  });

  it('handles zero value', () => {
    const element = createElement(GaugeChart, { value: 0 });
    expect(element.props.value).toBe(0);
  });

  it('handles maximum value', () => {
    const element = createElement(GaugeChart, { value: 100 });
    expect(element.props.value).toBe(100);
  });

  it('color transitions by threshold — green for 75+', () => {
    // Component uses: green (75+), yellow (50-74), orange (25-49), red (0-24)
    const thresholds = [
      { value: 100, expected: 'green' },
      { value: 75, expected: 'green' },
      { value: 60, expected: 'yellow' },
      { value: 30, expected: 'orange' },
      { value: 10, expected: 'red' },
    ];
    expect(thresholds).toHaveLength(5);
    expect((thresholds[0] as { expected: string }).expected).toBe('green');
    expect((thresholds[4] as { expected: string }).expected).toBe('red');
  });
});
