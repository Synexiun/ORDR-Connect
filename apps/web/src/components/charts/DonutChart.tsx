/**
 * DonutChart — Pure SVG donut/ring chart using stroke-dasharray segments.
 *
 * Renders proportional arc segments around a ring with optional center label.
 * Segment layout is computed via cumulative stroke-dasharray offsets.
 *
 * No external charting libraries — compliance with supply chain security (Rule 8).
 */

import { type ReactNode, useMemo } from 'react';
import { cn } from '../../lib/cn';

interface Segment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: Segment[];
  size?: number;
  thickness?: number;
  showLabels?: boolean;
  centerLabel?: string;
  className?: string;
}

const DEFAULT_SEGMENT_COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#ec4899', // pink-500
];

export function DonutChart({
  segments,
  size = 180,
  thickness = 24,
  showLabels = true,
  centerLabel,
  className,
}: DonutChartProps): ReactNode {
  const center = size / 2;
  const radius = (size - thickness - 4) / 2;
  const circumference = 2 * Math.PI * radius;

  const computedSegments = useMemo(() => {
    const total = segments.reduce((sum, s) => sum + s.value, 0);
    if (total === 0) return [];

    let cumulativeOffset = 0;
    return segments.map((segment, i) => {
      const fraction = segment.value / total;
      const segmentLength = fraction * circumference;
      const gapSize = segments.length > 1 ? 2 : 0;
      const dashLength = Math.max(0, segmentLength - gapSize);
      const dashGap = circumference - dashLength;
      const offset = -cumulativeOffset;

      cumulativeOffset += segmentLength;

      // Label position: midpoint of the arc segment
      const midAngle =
        ((cumulativeOffset - segmentLength / 2) / circumference) * 2 * Math.PI - Math.PI / 2;
      const labelRadius = radius + thickness / 2 + 16;
      const labelX = center + labelRadius * Math.cos(midAngle);
      const labelY = center + labelRadius * Math.sin(midAngle);

      return {
        ...segment,
        color:
          segment.color !== ''
            ? segment.color
            : (DEFAULT_SEGMENT_COLORS[i % DEFAULT_SEGMENT_COLORS.length] ?? '#3b82f6'),
        fraction,
        dashArray: `${dashLength} ${dashGap}`,
        dashOffset: offset,
        labelX,
        labelY,
        percentage: Math.round(fraction * 100),
      };
    });
  }, [segments, circumference, center, radius, thickness]);

  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (segments.length === 0 || total === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-sm text-content-secondary', className)}
        style={{ width: size, height: size }}
      >
        No data available
      </div>
    );
  }

  const labelAreaSize = showLabels ? 32 : 0;
  const svgSize = size + labelAreaSize * 2;
  const svgCenter = svgSize / 2;
  const offsetX = labelAreaSize;
  const offsetY = labelAreaSize;

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg
        width={svgSize}
        height={svgSize}
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        role="img"
        aria-label="Donut chart"
        className="max-w-full"
      >
        {/* Background ring */}
        <circle
          cx={svgCenter}
          cy={svgCenter}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={thickness}
          className="text-surface-tertiary"
          opacity={0.2}
        />

        {/* Segments */}
        {computedSegments.map((seg, i) => (
          <circle
            key={`seg-${i}`}
            cx={svgCenter}
            cy={svgCenter}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={thickness}
            strokeDasharray={seg.dashArray}
            strokeDashoffset={seg.dashOffset}
            strokeLinecap="butt"
            className="-rotate-90 origin-center"
            style={{
              transformOrigin: `${svgCenter}px ${svgCenter}px`,
              transition: 'stroke-dashoffset 0.6s ease, stroke-dasharray 0.6s ease',
            }}
            aria-label={`${seg.label}: ${seg.value} (${seg.percentage}%)`}
          >
            <title>{`${seg.label}: ${seg.value} (${seg.percentage}%)`}</title>
          </circle>
        ))}

        {/* Segment labels */}
        {showLabels &&
          computedSegments.map((seg, i) => {
            if (seg.fraction < 0.05) return null; // Skip tiny segments
            return (
              <text
                key={`label-${i}`}
                x={seg.labelX + offsetX}
                y={seg.labelY + offsetY}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-content-secondary"
                fontSize={9}
              >
                {seg.percentage}%
              </text>
            );
          })}

        {/* Center label */}
        {centerLabel !== undefined && centerLabel !== '' && (
          <text
            x={svgCenter}
            y={svgCenter}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-content"
            fontSize={14}
            fontWeight="600"
          >
            {centerLabel}
          </text>
        )}
      </svg>

      {/* Legend */}
      {showLabels && (
        <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
          {computedSegments.map((seg, i) => (
            <div key={`legend-${i}`} className="flex items-center gap-1.5 text-xs">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: seg.color }}
                aria-hidden="true"
              />
              <span className="text-content-secondary">{seg.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
