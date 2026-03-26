import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface CardProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padding?: boolean;
}

export function Card({
  title,
  actions,
  children,
  className,
  padding = true,
}: CardProps): ReactNode {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface-secondary',
        'transition-colors duration-150',
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          {title && <h3 className="text-sm font-semibold text-content">{title}</h3>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(padding && 'p-5')}>{children}</div>
    </div>
  );
}
