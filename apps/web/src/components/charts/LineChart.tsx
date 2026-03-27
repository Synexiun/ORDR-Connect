/**
 * LineChart — Pure SVG line chart component.
 *
 * Supports multiple series with different colors, optional gradient fill,
 * and bezier curve smoothing.
 *
 * No external charting libraries — compliance with supply chain security (Rule 8).
 */

import { type ReactNode, useId, useMemo } from 'react';
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
  gradient?: boolean;
  smooth?: boolean;
  className?: string;
}

const DEFAULT_SERIES_COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
];

/**
 * Build a smooth cubic bezier path through the given points.
 * Uses Catmull-Rom to cubic Bezier conversion for natural curves.
 */
function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  const pt0 = points[0];
  const pt1 = points[1];
  if (points.length === 2) {
    return `M ${pt0?.x ?? 0} ${pt0?.y ?? 0} L ${pt1?.x ?? 0} ${pt1?.y ?? 0}`;
  }

  let d = `M ${pt0?.x ?? 0} ${pt0?.y ?? 0}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)] ?? { x: 0, y: 0 };
    const p1 = points[i] ?? { x: 0, y: 0 };
    const p2 = points[i + 1] ?? { x: 0, y: 0 };
    const p3 = points[Math.min(points.length - 1, i + 2)] ?? { x: 0, y: 0 };

    // Control points (tension = 0.25)
    const tension = 0.25;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  return d;
}

export function LineChart({
  series,
  height = 200,
  showGrid = true,
  showDots = true,
  gradient = false,
  smooth = false,
  className,
}: LineChartProps): ReactNode {
  const baseId = useId();
  const padding = { top: 16, right: 16, bottom: 32, left: 48 };
  const chartWidth = 600;
  const chartHeight = height;
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const { allPoints, maxY, minY, xLabels, yTicks } = useMemo(() => {
    const pts = series.flatMap((s) => s.data);
    if (pts.length === 0) {
      return {
        allPoints: pts,
        maxY: 100,
        minY: 0,
        xLabels: [] as string[],
        yTicks: [0, 25, 50, 75, 100],
      };
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

  const baselineY = yScale(minY);

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <svg
        width="100%"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Line chart"
      >
        {/* Gradient defs — one per series when gradient is enabled */}
        {gradient && (
          <defs>
            {series.map((s, sIdx) => {
              const color =
                s.color !== undefined && s.color !== ''
                  ? s.color
                  : (DEFAULT_SERIES_COLORS[sIdx % DEFAULT_SERIES_COLORS.length] ?? '#3b82f6');
              return (
                <linearGradient
                  key={`grad-${sIdx}`}
                  id={`${baseId}-grad-${sIdx}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              );
            })}
          </defs>
        )}

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
          const color =
            s.color !== undefined && s.color !== ''
              ? s.color
              : (DEFAULT_SERIES_COLORS[sIdx % DEFAULT_SERIES_COLORS.length] ?? '#3b82f6');
          const points = s.data.map((d, i) => ({
            x: xScale(i),
            y: yScale(d.y),
            raw: d,
          }));

          if (points.length === 0) return null;

          const linePathD = smooth
            ? buildSmoothPath(points)
            : points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

          // Area path for gradient fill — close path to baseline
          const lastPt = points[points.length - 1];
          const firstPt = points[0];
          const areaPathD = gradient
            ? linePathD +
              ` L ${lastPt?.x ?? 0} ${baselineY}` +
              ` L ${firstPt?.x ?? 0} ${baselineY} Z`
            : undefined;

          return (
            <g
              key={`series-${sIdx}`}
              aria-label={s.label !== undefined && s.label !== '' ? s.label : `Series ${sIdx + 1}`}
            >
              {/* Gradient fill area */}
              {gradient && areaPathD !== undefined && areaPathD !== '' && (
                <path d={areaPathD} fill={`url(#${baseId}-grad-${sIdx})`} />
              )}

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
            </g>
          );
        })}
      </svg>
    </div>
  );
}
