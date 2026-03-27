import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

type StatusDotVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type StatusDotSize = 'sm' | 'md';

interface StatusDotProps {
  status: StatusDotVariant;
  pulse?: boolean;
  size?: StatusDotSize;
  className?: string;
}

const colorStyles: Record<StatusDotVariant, string> = {
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-red-400',
  info: 'bg-blue-400',
  neutral: 'bg-slate-400',
};

const pulseColors: Record<StatusDotVariant, string> = {
  success: 'bg-emerald-400/50',
  warning: 'bg-amber-400/50',
  danger: 'bg-red-400/50',
  info: 'bg-blue-400/50',
  neutral: 'bg-slate-400/50',
};

const sizeStyles: Record<StatusDotSize, string> = {
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
};

const pulseSizeStyles: Record<StatusDotSize, string> = {
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
};

export function StatusDot({
  status,
  pulse = false,
  size = 'md',
  className,
}: StatusDotProps): ReactNode {
  return (
    <span className={cn('relative inline-flex', className)} aria-label={status}>
      {pulse && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
            pulseColors[status],
            pulseSizeStyles[size],
          )}
          aria-hidden="true"
        />
      )}
      <span
        className={cn('relative inline-flex rounded-full', colorStyles[status], sizeStyles[size])}
      />
    </span>
  );
}
