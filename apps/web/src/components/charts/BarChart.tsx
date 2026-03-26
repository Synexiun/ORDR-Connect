/**
 * BarChart — Pure SVG bar chart component.
 *
 * No external charting libraries — compliance with supply chain security (Rule 8).
 * ARIA labels on all bars for accessibility.
 */

import { type ReactNode, useMemo } from 'react';
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
  className,
}: BarChartProps): ReactNode {
  const { maxValue, barWidth, gap, chartWidth } = useMemo(() => {
    const max = Math.max(...data.map((d) => d.value), 1);
    const g = 8;
    const bw = data.length > 0 ? Math.max(20, Math.min(60, (600 - g * (data.length + 1)) / data.length)) : 40;
    const cw = data.length * (bw + g) + g;
    return { maxValue: max, barWidth: bw, gap: g, chartWidth: cw };
  }, [data]);

  const labelHeight = showLabels ? 24 : 0;
  const valueHeight = showValues ? 18 : 0;
  const chartHeight = height - labelHeight - valueHeight;
  const totalHeight = height;

  if (data.length === 0) {
    return (
      <div className={cn('flex items-center justify-center text-sm text-content-secondary', className)} style={{ height }}>
        No data available
      </div>
    );
  }

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
          const color = datum.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]!;

          return (
            <g key={datum.label} aria-label={`${datum.label}: ${datum.value}`}>
              {/* Bar */}
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, 2)}
                rx={3}
                fill={color}
                opacity={0.85}
              >
                <title>{`${datum.label}: ${datum.value}`}</title>
              </rect>

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
