/**
 * BarChart — Pure SVG bar chart component.
 *
 * Supports vertical (default) and horizontal bar layouts with hover highlight.
 *
 * No external charting libraries — compliance with supply chain security (Rule 8).
 * ARIA labels on all bars for accessibility.
 */

import { type ReactNode, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';

interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarDatum[];
  height?: number;
  showLabels?: boolean;
  showValues?: boolean;
  horizontal?: boolean;
  className?: string;
}

const DEFAULT_COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#ec4899', // pink-500
];

export function BarChart({
  data,
  height = 200,
  showLabels = true,
  showValues = true,
  horizontal = false,
  className,
}: BarChartProps): ReactNode {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-sm text-content-secondary', className)}
        style={{ height }}
      >
        No data available
      </div>
    );
  }

  if (horizontal) {
    return (
      <HorizontalBarChart
        data={data}
        height={height}
        showLabels={showLabels}
        showValues={showValues}
        hoveredIndex={hoveredIndex}
        setHoveredIndex={setHoveredIndex}
        className={className}
      />
    );
  }

  return (
    <VerticalBarChart
      data={data}
      height={height}
      showLabels={showLabels}
      showValues={showValues}
      hoveredIndex={hoveredIndex}
      setHoveredIndex={setHoveredIndex}
      className={className}
    />
  );
}

/* --- Vertical bars (original layout, enhanced with hover) --- */

interface InternalBarProps {
  data: BarDatum[];
  height: number;
  showLabels: boolean;
  showValues: boolean;
  hoveredIndex: number | null;
  setHoveredIndex: (idx: number | null) => void;
  className?: string;
}

function VerticalBarChart({
  data,
  height,
  showLabels,
  showValues,
  hoveredIndex,
  setHoveredIndex,
  className,
}: InternalBarProps): ReactNode {
  const { maxValue, barWidth, gap, chartWidth } = useMemo(() => {
    const max = Math.max(...data.map((d) => d.value), 1);
    const g = 8;
    const bw =
      data.length > 0
        ? Math.max(20, Math.min(60, (600 - g * (data.length + 1)) / data.length))
        : 40;
    const cw = data.length * (bw + g) + g;
    return { maxValue: max, barWidth: bw, gap: g, chartWidth: cw };
  }, [data]);

  const labelHeight = showLabels ? 24 : 0;
  const valueHeight = showValues ? 18 : 0;
  const chartHeight = height - labelHeight - valueHeight;
  const totalHeight = height;

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <svg
        width="100%"
        viewBox={`0 0 ${chartWidth} ${totalHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Bar chart"
      >
        {data.map((datum, i) => {
          const barHeight = (datum.value / maxValue) * chartHeight;
          const x = gap + i * (barWidth + gap);
          const y = valueHeight + (chartHeight - barHeight);
          const color =
            datum.color !== undefined
              ? datum.color
              : (DEFAULT_COLORS[i % DEFAULT_COLORS.length] ?? '#3b82f6');
          const isHovered = hoveredIndex === i;

          return (
            <g
              key={datum.label}
              aria-label={`${datum.label}: ${datum.value}`}
              onMouseEnter={() => {
                setHoveredIndex(i);
              }}
              onMouseLeave={() => {
                setHoveredIndex(null);
              }}
              style={{ cursor: 'pointer' }}
            >
              {/* Bar */}
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, 2)}
                rx={3}
                fill={color}
                opacity={isHovered ? 1 : hoveredIndex !== null ? 0.5 : 0.85}
                style={{ transition: 'opacity 0.15s ease' }}
              >
                <title>{`${datum.label}: ${datum.value}`}</title>
              </rect>

              {/* Hover highlight ring */}
              {isHovered && (
                <rect
                  x={x - 2}
                  y={y - 2}
                  width={barWidth + 4}
                  height={Math.max(barHeight, 2) + 4}
                  rx={4}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={0.4}
                />
              )}

              {/* Value label */}
              {showValues && (
                <text
                  x={x + barWidth / 2}
                  y={y - 4}
                  textAnchor="middle"
                  className="fill-content-secondary"
                  fontSize={10}
                  fontFamily="monospace"
                >
                  {datum.value.toLocaleString()}
                </text>
              )}

              {/* X-axis label */}
              {showLabels && (
                <text
                  x={x + barWidth / 2}
                  y={totalHeight - 4}
                  textAnchor="middle"
                  className="fill-content-tertiary"
                  fontSize={10}
                >
                  {datum.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* --- Horizontal bars --- */

function HorizontalBarChart({
  data,
  height,
  showLabels,
  showValues,
  hoveredIndex,
  setHoveredIndex,
  className,
}: InternalBarProps): ReactNode {
  const { maxValue, barHeight, gap, chartWidth, labelWidth } = useMemo(() => {
    const max = Math.max(...data.map((d) => d.value), 1);
    const g = 6;
    const lw = showLabels ? 64 : 0;
    const bh =
      data.length > 0
        ? Math.max(14, Math.min(32, (height - g * (data.length + 1)) / data.length))
        : 20;
    const cw = 600;
    return { maxValue: max, barHeight: bh, gap: g, chartWidth: cw, labelWidth: lw };
  }, [data, height, showLabels]);

  const valueWidth = showValues ? 48 : 0;
  const barAreaWidth = chartWidth - labelWidth - valueWidth;
  const totalHeight = data.length * (barHeight + gap) + gap;

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <svg
        width="100%"
        viewBox={`0 0 ${chartWidth} ${totalHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Horizontal bar chart"
      >
        {data.map((datum, i) => {
          const bw = (datum.value / maxValue) * barAreaWidth;
          const x = labelWidth;
          const y = gap + i * (barHeight + gap);
          const color =
            datum.color !== undefined
              ? datum.color
              : (DEFAULT_COLORS[i % DEFAULT_COLORS.length] ?? '#3b82f6');
          const isHovered = hoveredIndex === i;

          return (
            <g
              key={datum.label}
              aria-label={`${datum.label}: ${datum.value}`}
              onMouseEnter={() => {
                setHoveredIndex(i);
              }}
              onMouseLeave={() => {
                setHoveredIndex(null);
              }}
              style={{ cursor: 'pointer' }}
            >
              {/* Y-axis label */}
              {showLabels && (
                <text
                  x={labelWidth - 6}
                  y={y + barHeight / 2 + 3}
                  textAnchor="end"
                  className="fill-content-tertiary"
                  fontSize={10}
                >
                  {datum.label}
                </text>
              )}

              {/* Bar */}
              <rect
                x={x}
                y={y}
                width={Math.max(bw, 2)}
                height={barHeight}
                rx={3}
                fill={color}
                opacity={isHovered ? 1 : hoveredIndex !== null ? 0.5 : 0.85}
                style={{ transition: 'opacity 0.15s ease' }}
              >
                <title>{`${datum.label}: ${datum.value}`}</title>
              </rect>

              {/* Hover highlight ring */}
              {isHovered && (
                <rect
                  x={x - 2}
                  y={y - 2}
                  width={Math.max(bw, 2) + 4}
                  height={barHeight + 4}
                  rx={4}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={0.4}
                />
              )}

              {/* Value label */}
              {showValues && (
                <text
                  x={x + Math.max(bw, 2) + 6}
                  y={y + barHeight / 2 + 3}
                  textAnchor="start"
                  className="fill-content-secondary"
                  fontSize={10}
                  fontFamily="monospace"
                >
                  {datum.value.toLocaleString()}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
