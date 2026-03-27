/**
 * AreaChart — Pure SVG area chart with gradient fill below the line.
 *
 * Built on the same pattern as LineChart but with an SVG linear gradient
 * fill beneath the data path. Supports grid, dots, and configurable opacity.
 *
 * No external charting libraries — compliance with supply chain security (Rule 8).
 */

import { type ReactNode, useId, useMemo } from 'react';
import { cn } from '../../lib/cn';

interface DataPoint {
  x: string;
  y: number;
}

interface AreaChartProps {
  series: DataPoint[];
  height?: number;
  color?: string;
  showGrid?: boolean;
  showDots?: boolean;
  gradientOpacity?: number;
  className?: string;
}

export function AreaChart({
  series,
  height = 200,
  color = '#3b82f6',
  showGrid = true,
  showDots = true,
  gradientOpacity = 0.3,
  className,
}: AreaChartProps): ReactNode {
  const gradientId = useId();
  const padding = { top: 16, right: 16, bottom: 32, left: 48 };
  const chartWidth = 600;
  const chartHeight = height;
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const { maxY, minY, xLabels, yTicks } = useMemo(() => {
    if (series.length === 0) {
      return { maxY: 100, minY: 0, xLabels: [] as string[], yTicks: [0, 25, 50, 75, 100] };
    }

    const yValues = series.map((p) => p.y);
    const rawMax = Math.max(...yValues);
    const rawMin = Math.min(...yValues, 0);
    const rangeMax = rawMax === rawMin ? rawMax + 10 : rawMax + (rawMax - rawMin) * 0.1;
    const rangeMin = Math.min(rawMin, 0);

    const labels = series.map((d) => d.x);
    const step = (rangeMax - rangeMin) / 4;
    const ticks = Array.from({ length: 5 }, (_, i) => Math.round(rangeMin + step * i));

    return { maxY: rangeMax, minY: rangeMin, xLabels: labels, yTicks: ticks };
  }, [series]);

  if (series.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-sm text-content-secondary', className)}
        style={{ height }}
      >
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

  const points = series.map((d, i) => ({
    x: xScale(i),
    y: yScale(d.y),
    raw: d,
  }));

  const linePathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const baselineY = yScale(minY);
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const areaPathD =
    linePathD + ` L ${lastPoint?.x ?? 0} ${baselineY}` + ` L ${firstPoint?.x ?? 0} ${baselineY} Z`;

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <svg
        width="100%"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Area chart"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={gradientOpacity} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>

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

        {/* X-axis labels */}
        {xLabels.map((label, i) => {
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

        {/* Gradient fill area */}
        <path d={areaPathD} fill={`url(#${gradientId})`} />

        {/* Line path */}
        <path
          d={linePathD}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Dots */}
        {showDots &&
          points.map((p, i) => (
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
      </svg>
    </div>
  );
}
