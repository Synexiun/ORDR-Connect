/**
 * StackedBarChart — Pure SVG vertical stacked bar chart.
 *
 * Renders multiple series stacked on top of each other per category.
 * Each series has its own color and label for legend display.
 *
 * No external charting libraries — compliance with supply chain security (Rule 8).
 */

import { type ReactNode, useMemo } from 'react';
import { cn } from '../../lib/cn';

interface StackedSeries {
  label: string;
  data: number[];
  color: string;
}

interface StackedBarChartProps {
  categories: string[];
  series: StackedSeries[];
  height?: number;
  showGrid?: boolean;
  showLabels?: boolean;
  className?: string;
}

export function StackedBarChart({
  categories,
  series,
  height = 240,
  showGrid = true,
  showLabels = true,
  className,
}: StackedBarChartProps): ReactNode {
  const padding = { top: 16, right: 16, bottom: 40, left: 48 };
  const legendHeight = 28;
  const chartWidth = 600;
  const chartHeight = height - legendHeight;
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const { maxStackValue, yTicks, barWidth, barGap } = useMemo(() => {
    // For each category, sum all series values to get the stack total
    const stackTotals = categories.map((_, catIdx) =>
      series.reduce((sum, s) => sum + (s.data[catIdx] ?? 0), 0),
    );
    const maxStack = Math.max(...stackTotals, 1);
    const roundedMax = Math.ceil(maxStack / 10) * 10 || 10;

    const step = roundedMax / 4;
    const ticks = Array.from({ length: 5 }, (_, i) => Math.round(step * i));

    const catCount = categories.length || 1;
    const totalBarSpace = innerWidth / catCount;
    const gap = Math.max(4, totalBarSpace * 0.25);
    const bw = totalBarSpace - gap;

    return { maxStackValue: roundedMax, yTicks: ticks, barWidth: Math.max(bw, 12), barGap: gap };
  }, [categories, series, innerWidth]);

  if (categories.length === 0 || series.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-sm text-content-secondary', className)}
        style={{ height }}
      >
        No data available
      </div>
    );
  }

  function yScale(value: number): number {
    return padding.top + innerHeight - (value / maxStackValue) * innerHeight;
  }

  function barHeight(value: number): number {
    return (value / maxStackValue) * innerHeight;
  }

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <svg
        width="100%"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Stacked bar chart"
      >
        {/* Grid lines */}
        {showGrid &&
          yTicks.map((tick) => (
            <g key={`grid-${tick}`}>
              <line
                x1={padding.left}
                y1={yScale(tick)}
                x2={chartWidth - padding.right}
                y2={yScale(tick)}
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeDasharray="4 4"
              />
              <text
                x={padding.left - 6}
                y={yScale(tick) + 3}
                textAnchor="end"
                className="fill-content-tertiary"
                fontSize={9}
                fontFamily="monospace"
              >
                {tick}
              </text>
            </g>
          ))}

        {/* Stacked bars per category */}
        {categories.map((cat, catIdx) => {
          const catCenterX = padding.left + catIdx * (barWidth + barGap) + barGap / 2;
          let cumulativeHeight = 0;

          return (
            <g key={`cat-${catIdx}`}>
              {/* Stack segments from bottom to top */}
              {series.map((s, sIdx) => {
                const value = s.data[catIdx] ?? 0;
                const segHeight = barHeight(value);
                const y = yScale(0) - cumulativeHeight - segHeight;
                cumulativeHeight += segHeight;

                return (
                  <rect
                    key={`bar-${catIdx}-${sIdx}`}
                    x={catCenterX}
                    y={y}
                    width={barWidth}
                    height={Math.max(segHeight, value > 0 ? 1 : 0)}
                    rx={sIdx === series.length - 1 ? 2 : 0}
                    fill={s.color}
                    opacity={0.85}
                    aria-label={`${cat} — ${s.label}: ${value}`}
                  >
                    <title>{`${cat} — ${s.label}: ${value}`}</title>
                  </rect>
                );
              })}

              {/* Category label */}
              {showLabels && (
                <text
                  x={catCenterX + barWidth / 2}
                  y={chartHeight - 8}
                  textAnchor="middle"
                  className="fill-content-tertiary"
                  fontSize={9}
                >
                  {cat}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-1">
        {series.map((s, i) => (
          <div key={`legend-${i}`} className="flex items-center gap-1.5 text-xs">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: s.color }}
              aria-hidden="true"
            />
            <span className="text-content-secondary">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
