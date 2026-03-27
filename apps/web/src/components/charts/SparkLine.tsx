/**
 * SparkLine — Tiny inline SVG chart with no axes, labels, or grid.
 *
 * Designed for inline/cell usage (tables, KPI cards). Renders just the
 * polyline path fitted to the given dimensions.
 *
 * No external charting libraries — compliance with supply chain security (Rule 8).
 */

import { type ReactNode, useMemo } from 'react';
import { cn } from '../../lib/cn';

interface SparkLineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}

export function SparkLine({
  data,
  width = 80,
  height = 24,
  color = '#3b82f6',
  strokeWidth = 1.5,
  className,
}: SparkLineProps): ReactNode {
  const paddingY = 2;

  const pathD = useMemo(() => {
    if (data.length < 2) return '';

    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
    const range = maxVal - minVal || 1;
    const innerHeight = height - paddingY * 2;

    const points = data.map((value, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = paddingY + innerHeight - ((value - minVal) / range) * innerHeight;
      return { x, y };
    });

    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
  }, [data, width, height, paddingY]);

  if (data.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn('inline-block', className)}
        role="img"
        aria-label="Sparkline — insufficient data"
      />
    );
  }

  // Trend direction for accessible label
  const lastVal = data[data.length - 1] ?? 0;
  const firstVal = data[0] ?? 0;
  const trendLabel = lastVal >= firstVal ? 'trending up' : 'trending down';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('inline-block', className)}
      role="img"
      aria-label={`Sparkline, ${trendLabel}`}
    >
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
