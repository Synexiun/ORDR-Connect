import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

type SkeletonVariant = 'text' | 'circle' | 'card' | 'table-row';

interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: string;
  height?: string;
  count?: number;
  className?: string;
}

const baseStyles = 'animate-pulse bg-surface-tertiary';

function SkeletonItem({
  variant = 'text',
  width,
  height,
  className,
}: Omit<SkeletonProps, 'count'>): ReactNode {
  switch (variant) {
    case 'circle':
      return (
        <div
          className={cn(baseStyles, 'rounded-full', className)}
          style={{ width: width ?? '40px', height: height ?? '40px' }}
          aria-hidden="true"
        />
      );
    case 'card':
      return (
        <div
          className={cn(baseStyles, 'rounded-xl', className)}
          style={{ width: width ?? '100%', height: height ?? '120px' }}
          aria-hidden="true"
        />
      );
    case 'table-row':
      return (
        <div
          className={cn('flex items-center gap-4', className)}
          style={{ width: width ?? '100%' }}
          aria-hidden="true"
        >
          <div className={cn(baseStyles, 'h-4 w-1/4 rounded')} />
          <div className={cn(baseStyles, 'h-4 w-1/3 rounded')} />
          <div className={cn(baseStyles, 'h-4 w-1/5 rounded')} />
          <div className={cn(baseStyles, 'h-4 w-1/6 rounded')} />
        </div>
      );
    case 'text':
    default:
      return (
        <div
          className={cn(baseStyles, 'h-4 rounded', className)}
          style={{ width: width ?? '100%', height: height }}
          aria-hidden="true"
        />
      );
  }
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  count = 1,
  className,
}: SkeletonProps): ReactNode {
  if (count <= 1) {
    return (
      <div role="status" aria-label="Loading">
        <SkeletonItem variant={variant} width={width} height={height} className={className} />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonItem
          key={i}
          variant={variant}
          width={width}
          height={height}
          className={className}
        />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}
