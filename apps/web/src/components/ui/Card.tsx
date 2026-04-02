import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

type AccentColor = 'blue' | 'green' | 'red' | 'purple' | 'amber';

const accentBorder: Record<AccentColor, string> = {
  blue: 'border-t-3 border-t-kpi-blue',
  green: 'border-t-3 border-t-kpi-green',
  red: 'border-t-3 border-t-kpi-red',
  purple: 'border-t-3 border-t-kpi-purple',
  amber: 'border-t-3 border-t-kpi-amber',
};

interface CardProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padding?: boolean;
  accent?: AccentColor;
}

export function Card({
  title,
  actions,
  children,
  className,
  padding = true,
  accent,
}: CardProps): ReactNode {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface-secondary/80 shadow-kpi backdrop-blur-md',
        'transition-all duration-200 hover:shadow-card-hover',
        accent && accentBorder[accent],
        className,
      )}
    >
      {(title !== undefined || actions !== undefined) && (
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          {title !== undefined && (
            <h3 className="text-xs font-mono font-semibold uppercase tracking-[0.1em] text-content-tertiary">
              {title}
            </h3>
          )}
          {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(padding && 'p-5')}>{children}</div>
    </div>
  );
}
