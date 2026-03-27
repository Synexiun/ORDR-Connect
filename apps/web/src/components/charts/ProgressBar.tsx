/**
 * ProgressBar — Horizontal progress bar with optional label, percentage, and animation.
 *
 * Uses pure CSS transitions for the fill animation. Supports sm/md/lg sizing.
 *
 * No external charting libraries — compliance with supply chain security (Rule 8).
 */

import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface ProgressBarProps {
  value: number;
  label?: string;
  showPercentage?: boolean;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  animated?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<string, string> = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
};

export function ProgressBar({
  value,
  label,
  showPercentage = true,
  color = '#3b82f6',
  size = 'md',
  animated = true,
  className,
}: ProgressBarProps): ReactNode {
  const clampedValue = Math.max(0, Math.min(100, value));
  const barSizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES['md'];

  return (
    <div className={cn('w-full', className)}>
      {/* Header row: label + percentage */}
      {((label !== undefined && label !== '') || showPercentage) && (
        <div className="mb-1 flex items-center justify-between">
          {label !== undefined && label !== '' && (
            <span className="text-xs font-medium text-content-secondary">{label}</span>
          )}
          {showPercentage && (
            <span className="text-xs font-medium tabular-nums text-content-tertiary">
              {clampedValue}%
            </span>
          )}
        </div>
      )}

      {/* Track */}
      <div
        className={cn('w-full overflow-hidden rounded-full bg-surface-tertiary', barSizeClass)}
        role="progressbar"
        aria-valuenow={clampedValue}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? `Progress: ${clampedValue}%`}
      >
        {/* Fill */}
        <div
          className={cn(
            'h-full rounded-full',
            animated && 'transition-[width] duration-700 ease-out',
          )}
          style={{
            width: `${clampedValue}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}
