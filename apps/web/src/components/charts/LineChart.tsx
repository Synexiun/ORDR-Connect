/**
 * LineChart — Pure SVG line chart component.
 *
 * Supports multiple series with different colors.
 * No external charting libraries — compliance with supply chain security (Rule 8).
 */

import { type ReactNode, useMemo } from 'react';
import { cn } from '../../lib/cn';

interface DataPoint {
  x: string;
  y: number;
}

interface Series {
  data: DataPoint[];
  color?: string;
  label?: string;
}

interface LineChartProps {
  series: Series[];
  height?: number;
  showGrid?: boolean;
  showDots?: boolean;
  className?: string;
}

const DEFAULT_SERIES_COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
];

export function LineChart({
  series,
  height = 200,
  showGrid = true,
  showDots = true,
  className,
}: LineChartProps): ReactNode {
  const padding = { top: 16, right: 16, bottom: 32, left: 48 };
  const chartWidth = 600;
  const chartHeight = height;
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const { allPoints, maxY, minY, xLabels, yTicks } = useMemo(() => {
    const pts = series.flatMap((s) => s.data);
    if (pts.length === 0) {
      return { allPoints: pts, maxY: 100, minY: 0, xLabels: [] as string[], yTicks: [0, 25, 50, 75, 100] };
    }

    const yValues = pts.map((p) => p.y);
    const rawMax = Math.max(...yValues);
    const rawMin = Math.min(...yValues, 0);
    const rangeMax = rawMax === rawMin ? rawMax + 10 : rawMax + (rawMax - rawMin) * 0.1;
    const rangeMin = Math.min(rawMin, 0);

    // Unique x labels from first series (assumes all series share x axis)
    const labels = series[0]?.data.map((d) => d.x) ?? [];

    // Y-axis ticks (5 ticks)
    const step = (rangeMax - rangeMin) / 4;
    const ticks = Array.from({ length: 5 }, (_, i) => Math.round(rangeMin + step * i));

    return { allPoints: pts, maxY: rangeMax, minY: rangeMin, xLabels: labels, yTicks: ticks };
  }, [series]);

  if (allPoints.length === 0) {
    return (
      <div className={cn('flex items-center justify-center text-sm text-content-secondary', className)} style={{ height }}>
        No data available
      </div>
    );
  }

  function xScale(index: number): number {
    const count = xLabels.length;
    if (count <= 1) return padding.left + innerWidth / 2;
    return padding.left + (index / (count - 1)) * innerWidth;
  }

  function yScale(value: number): number {
    const range = maxY - minY;
    if (range === 0) return padding.top + innerHeight / 2;
    return padding.top + innerHeight - ((value - minY) / range) * innerHeight;
  }

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <svg
        width="100%"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Line chart"
      >
        {/* Grid lines */}
        {showGrid && yTicks.map((tick) => (
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

        {/* X-axis labels */}
        {xLabels.map((label, i) => {
          // Show every Nth label to avoid overlap
          const interval = Math.max(1, Math.floor(xLabels.length / 8));
          if (i % interval !== 0 && i !== xLabels.length - 1) return null;

          return (
            <text
              key={`x-${label}-${i}`}
              x={xScale(i)}
              y={chartHeight - 4}
              textAnchor="middle"
              className="fill-content-tertiary"
              fontSize={9}
            >
              {label}
            </text>
          );
        })}

        {/* Series */}
        {series.map((s, sIdx) => {
          const color = s.color || DEFAULT_SERIES_COLORS[sIdx % DEFAULT_SERIES_COLORS.length]!;
          const points = s.data.map((d, i) => ({
            x: xScale(i),
            y: yScale(d.y),
            raw: d,
          }));

          if (points.length === 0) return null;

          const pathD = points
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
            .join(' ');

          return (
            <g key={`series-${sIdx}`} aria-label={s.label || `Series ${sIdx + 1}`}>
              {/* Line path */}
              <path
                d={pathD}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Dots */}
              {showDots && points.map((p, i) => (
                <circle
                  key={`dot-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={3}
                  fill={color}
                  stroke="var(--color-surface-secondary, #1e293b)"
                  strokeWidth={1.5}
                >
                  <title>{`${p.raw.x}: ${p.raw.y}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
