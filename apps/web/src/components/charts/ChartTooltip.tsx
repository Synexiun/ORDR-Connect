/**
 * ChartTooltip — Positioned tooltip overlay for chart hover interactions.
 *
 * Uses absolute positioning relative to the nearest positioned ancestor.
 * Designed to be composed inside chart wrapper divs alongside SVGs.
 *
 * No external charting libraries — compliance with supply chain security (Rule 8).
 */

import { type ReactNode, useRef, useEffect, useState } from 'react';
import { cn } from '../../lib/cn';

interface ChartTooltipProps {
  x: number;
  y: number;
  visible: boolean;
  label: string;
  value: string | number;
  color?: string;
  className?: string;
}

export function ChartTooltip({
  x,
  y,
  visible,
  label,
  value,
  color = '#3b82f6',
  className,
}: ChartTooltipProps): ReactNode {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ left: x, top: y });

  // Recompute position to keep tooltip within parent bounds
  useEffect(() => {
    if (!visible || !tooltipRef.current) {
      setAdjustedPos({ left: x, top: y });
      return;
    }

    const tooltip = tooltipRef.current;
    const parent = tooltip.parentElement;
    if (!parent) {
      setAdjustedPos({ left: x, top: y });
      return;
    }

    const parentRect = parent.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;

    let left = x;
    let top = y - tooltipHeight - 8; // Position above cursor by default

    // Horizontal bounds
    if (left + tooltipWidth > parentRect.width) {
      left = parentRect.width - tooltipWidth - 4;
    }
    if (left < 0) {
      left = 4;
    }

    // Vertical bounds — flip below if no room above
    if (top < 0) {
      top = y + 12;
    }

    setAdjustedPos({ left, top });
  }, [x, y, visible]);

  if (!visible) return null;

  return (
    <div
      ref={tooltipRef}
      className={cn(
        'pointer-events-none absolute z-50 rounded-md border border-border px-2.5 py-1.5 shadow-lg',
        'bg-surface-secondary text-xs',
        'transition-opacity duration-150',
        'opacity-100',
        className,
      )}
      style={{
        left: adjustedPos.left,
        top: adjustedPos.top,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="font-medium text-content">{label}</span>
      </div>
      <div className="mt-0.5 tabular-nums text-content-secondary">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
