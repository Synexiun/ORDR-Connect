/**
 * HeatmapChart — Pure SVG heatmap grid (e.g. hour-of-day vs day-of-week).
 *
 * Renders a matrix of colored cells where color intensity maps to value magnitude.
 * Uses a configurable color scale interpolated across the value range.
 *
 * No external charting libraries — compliance with supply chain security (Rule 8).
 */

import { type ReactNode, useMemo } from 'react';
import { cn } from '../../lib/cn';

interface HeatmapChartProps {
  data: number[][];
  xLabels: string[];
  yLabels: string[];
  colorScale?: string[];
  height?: number;
  className?: string;
}

const DEFAULT_COLOR_SCALE = [
  '#0f172a', // near-surface (lowest)
  '#1e3a5f', // dark blue
  '#1d4ed8', // blue-700
  '#3b82f6', // blue-500
  '#60a5fa', // blue-400
  '#93c5fd', // blue-300
];

/**
 * Interpolates between two hex colors by a factor t (0..1).
 */
function interpolateColor(colorA: string, colorB: string, t: number): string {
  const parseHex = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    return [
      parseInt(h.substring(0, 2), 16),
      parseInt(h.substring(2, 4), 16),
      parseInt(h.substring(4, 6), 16),
    ];
  };

  const [rA, gA, bA] = parseHex(colorA);
  const [rB, gB, bB] = parseHex(colorB);
  const r = Math.round(rA + (rB - rA) * t);
  const g = Math.round(gA + (gB - gA) * t);
  const b = Math.round(bA + (bB - bA) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function getColorForValue(value: number, minVal: number, maxVal: number, scale: string[]): string {
  if (scale.length === 0) return '#3b82f6';
  if (scale.length === 1) return scale[0] ?? '#3b82f6';
  if (maxVal === minVal) return scale[Math.floor(scale.length / 2)] ?? '#3b82f6';

  const normalized = Math.max(0, Math.min(1, (value - minVal) / (maxVal - minVal)));
  const scalePosition = normalized * (scale.length - 1);
  const lowerIdx = Math.floor(scalePosition);
  const upperIdx = Math.min(lowerIdx + 1, scale.length - 1);
  const t = scalePosition - lowerIdx;

  return interpolateColor(scale[lowerIdx] ?? '#3b82f6', scale[upperIdx] ?? '#3b82f6', t);
}

export function HeatmapChart({
  data,
  xLabels,
  yLabels,
  colorScale = DEFAULT_COLOR_SCALE,
  height = 200,
  className,
}: HeatmapChartProps): ReactNode {
  const yLabelWidth = 48;
  const xLabelHeight = 24;
  const cellGap = 2;

  const { minVal, maxVal, rows, cellWidth, cellHeight, chartWidth } = useMemo(() => {
    const r = data.length;
    const c = r > 0 ? Math.max(...data.map((row) => row.length)) : 0;
    const allValues = data.flat();
    const mn = allValues.length > 0 ? Math.min(...allValues) : 0;
    const mx = allValues.length > 0 ? Math.max(...allValues) : 0;

    const availableHeight = height - xLabelHeight;
    const cw = c > 0 ? Math.max(12, Math.min(40, (600 - yLabelWidth) / c - cellGap)) : 20;
    const ch = r > 0 ? Math.max(12, Math.min(40, availableHeight / r - cellGap)) : 20;
    const totalW = yLabelWidth + c * (cw + cellGap);

    return { minVal: mn, maxVal: mx, rows: r, cellWidth: cw, cellHeight: ch, chartWidth: totalW };
  }, [data, height]);

  const totalHeight = rows * (cellHeight + cellGap) + xLabelHeight;

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

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <svg
        width="100%"
        viewBox={`0 0 ${chartWidth} ${totalHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Heatmap chart"
      >
        {/* Y-axis labels */}
        {yLabels.map((label, rowIdx) => (
          <text
            key={`y-${rowIdx}`}
            x={yLabelWidth - 6}
            y={rowIdx * (cellHeight + cellGap) + cellHeight / 2 + 3}
            textAnchor="end"
            className="fill-content-tertiary"
            fontSize={9}
          >
            {label}
          </text>
        ))}

        {/* X-axis labels */}
        {xLabels.map((label, colIdx) => {
          const interval = Math.max(1, Math.floor(xLabels.length / 12));
          if (colIdx % interval !== 0 && colIdx !== xLabels.length - 1) return null;

          return (
            <text
              key={`x-${colIdx}`}
              x={yLabelWidth + colIdx * (cellWidth + cellGap) + cellWidth / 2}
              y={totalHeight - 4}
              textAnchor="middle"
              className="fill-content-tertiary"
              fontSize={8}
            >
              {label}
            </text>
          );
        })}

        {/* Cells */}
        {data.map((row, rowIdx) =>
          row.map((value, colIdx) => {
            const x = yLabelWidth + colIdx * (cellWidth + cellGap);
            const y = rowIdx * (cellHeight + cellGap);
            const cellColor = getColorForValue(value, minVal, maxVal, colorScale);
            const yLabel = yLabels[rowIdx] ?? `Row ${rowIdx}`;
            const xLabel = xLabels[colIdx] ?? `Col ${colIdx}`;

            return (
              <rect
                key={`cell-${rowIdx}-${colIdx}`}
                x={x}
                y={y}
                width={cellWidth}
                height={cellHeight}
                rx={2}
                fill={cellColor}
                aria-label={`${yLabel}, ${xLabel}: ${value}`}
              >
                <title>{`${yLabel}, ${xLabel}: ${value}`}</title>
              </rect>
            );
          }),
        )}
      </svg>
    </div>
  );
}
