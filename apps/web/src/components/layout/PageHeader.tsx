/**
 * PageHeader — Reusable page header with title, subtitle, breadcrumbs, and action buttons.
 *
 * SECURITY:
 * - No PHI/PII in titles or breadcrumbs (Rule 6)
 * - Action buttons are passed as ReactNode — caller is responsible for auth gating (Rule 2)
 */

import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { ChevronRight } from '../icons';

// ─── Types ───────────────────────────────────────────────────

interface Breadcrumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: Breadcrumb[];
  actions?: ReactNode;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps): ReactNode {
  return (
    <div className={cn('mb-6', className)}>
      {/* Breadcrumb trail */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-3 flex items-center gap-1" aria-label="Breadcrumbs">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 && (
                <ChevronRight className="h-3 w-3 text-content-tertiary" aria-hidden="true" />
              )}
              {crumb.href !== undefined && index < breadcrumbs.length - 1 ? (
                <Link
                  to={crumb.href}
                  className="text-sm text-content-tertiary transition-colors hover:text-content"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    'text-sm',
                    index === breadcrumbs.length - 1
                      ? 'font-medium text-content'
                      : 'text-content-tertiary',
                  )}
                >
                  {crumb.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* Title row with actions */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-content">{title}</h1>
          {subtitle !== undefined && (
            <p className="mt-1 text-sm text-content-secondary">{subtitle}</p>
          )}
        </div>

        {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
