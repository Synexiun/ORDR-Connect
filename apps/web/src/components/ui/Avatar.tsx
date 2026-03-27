import { type ReactNode, useState } from 'react';
import { cn } from '../../lib/cn';

type AvatarSize = 'sm' | 'md' | 'lg';
type AvatarStatus = 'online' | 'offline' | 'busy' | 'away';

interface AvatarProps {
  src?: string;
  name: string;
  size?: AvatarSize;
  status?: AvatarStatus;
  className?: string;
}

const sizeStyles: Record<AvatarSize, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-base',
};

const statusColors: Record<AvatarStatus, string> = {
  online: 'bg-emerald-400',
  offline: 'bg-slate-400',
  busy: 'bg-red-400',
  away: 'bg-amber-400',
};

const statusDotSize: Record<AvatarSize, string> = {
  sm: 'h-2 w-2 ring-1',
  md: 'h-2.5 w-2.5 ring-2',
  lg: 'h-3 w-3 ring-2',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? '';
  const second = parts[1] ?? '';
  if (parts.length >= 2 && first.length > 0 && second.length > 0) {
    return `${first[0]}${second[0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function Avatar({ src, name, size = 'md', status, className }: AvatarProps): ReactNode {
  const [imgError, setImgError] = useState(false);
  const showImage = src !== undefined && !imgError;

  return (
    <div className={cn('relative inline-flex shrink-0', className)}>
      <div
        className={cn(
          'inline-flex items-center justify-center rounded-full bg-surface-tertiary font-medium text-content-secondary',
          sizeStyles[size],
        )}
        aria-label={name}
      >
        {showImage ? (
          <img
            src={src}
            alt={name}
            className="h-full w-full rounded-full object-cover"
            onError={() => {
              setImgError(true);
            }}
          />
        ) : (
          <span aria-hidden="true">{getInitials(name)}</span>
        )}
      </div>
      {status !== undefined && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full ring-surface-secondary',
            statusColors[status],
            statusDotSize[size],
          )}
          aria-label={status}
        />
      )}
    </div>
  );
}
