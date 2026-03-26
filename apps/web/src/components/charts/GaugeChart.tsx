/**
 * GaugeChart — Circular SVG gauge for scores (0-100).
 *
 * Color transitions based on value thresholds:
 * - green (75+), yellow (50-74), orange (25-49), red (0-24)
 *
 * No external charting libraries — supply chain compliance (Rule 8).
 */

import { type ReactNode, useMemo } from 'react';
import { cn } from '../../lib/cn';

interface GaugeChartProps {
  value: number;
  label?: string;
  color?: string;
  size?: number;
  className?: string;
}

function defaultColor(value: number): string {
  if (value >= 75) return '#10b981'; // emerald-500
  if (value >= 50) return '#f59e0b'; // amber-500
  if (value >= 25) return '#f97316'; // orange-500
  return '#ef4444'; // red-500
}

function defaultStrokeClass(value: number): string {
  if (value >= 75) return 'stroke-emerald-400';
  if (value >= 50) return 'stroke-amber-400';
  if (value >= 25) return 'stroke-orange-400';
  return 'stroke-red-400';
}

function defaultTextClass(value: number): string {
  if (value >= 75) return 'fill-emerald-400';
  if (value >= 50) return 'fill-amber-400';
  if (value >= 25) return 'fill-orange-400';
  return 'fill-red-400';
}

export function GaugeChart({
  value,
  label,
  color,
  size = 120,
  className,
}: GaugeChartProps): ReactNode {
  const clampedValue = Math.max(0, Math.min(100, value));

  const { circumference, dashOffset, radius, strokeWidth } = useMemo(() => {
    const r = (size - 16) / 2;
    const sw = Math.max(6, size * 0.07);
    const circ = 2 * Math.PI * r;
    const offset = circ - (clampedValue / 100) * circ;
    return { circumference: circ, dashOffset: offset, radius: r, strokeWidth: sw };
  }, [size, clampedValue]);

  const center = size / 2;

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="img"
          aria-label={`${label || 'Score'}: ${clampedValue}%`}
        >
          {/* Background arc */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-surface-tertiary"
          />

          {/* Value arc */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            className={color ? undefined : defaultStrokeClass(clampedValue)}
            stroke={color || undefined}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <svg width={size * 0.5} height={size * 0.32} viewBox="0 0 60 38" aria-hidden="true">
            <text
              x="30"
              y="24"
              textAnchor="middle"
              fontSize={22}
              fontWeight="bold"
              fontFamily="monospace"
              className={color ? 'fill-content' : defaultTextClass(clampedValue)}
              fill={color || undefined}
            >
              {clampedValue}
            </text>
            <text
              x="30"
              y="36"
              textAnchor="middle"
              fontSize={9}
              className="fill-content-tertiary"
            >
              / 100
            </text>
          </svg>
        </div>
      </div>

      {label && (
        <p className="mt-1 text-xs font-medium text-content-secondary">{label}</p>
      )}
    </div>
  );
}
