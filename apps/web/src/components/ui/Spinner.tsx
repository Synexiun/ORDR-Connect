import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

type SpinnerSize = 'sm' | 'md' | 'lg';

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
  label?: string;
}

const sizeStyles: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-3',
};

export function Spinner({ size = 'md', className, label = 'Loading' }: SpinnerProps): ReactNode {
  return (
    <div className={cn('flex items-center justify-center', className)} role="status">
      <span
        className={cn(
          'animate-spin rounded-full border-brand-accent border-t-transparent',
          sizeStyles[size],
        )}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
