/**
 * ReportCard — Card displaying a report template with generate/schedule actions.
 *
 * COMPLIANCE: No PHI rendered. Shows report metadata only.
 */

import { type ReactNode } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import {
  LayoutDashboard,
  Bot,
  ShieldCheck,
  Mail,
  Users,
  DollarSign,
  Lock,
  Timer,
  Calendar,
  FileText,
} from '../icons';
import type { ReportTemplate } from '../../lib/reports-api';

// --- Icon resolver ---

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  Bot,
  ShieldCheck,
  Mail,
  Users,
  DollarSign,
  Lock,
  Timer,
  Calendar,
  FileText,
};

function resolveIcon(name: string): React.ComponentType<{ className?: string }> {
  return iconMap[name] ?? FileText;
}

// --- Helpers ---

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Less than 1h ago';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// --- Props ---

interface ReportCardProps {
  template: ReportTemplate;
  onGenerate: (type: ReportTemplate['type']) => void;
  onSchedule: (type: ReportTemplate['type']) => void;
}

// --- Component ---

export function ReportCard({ template, onGenerate, onSchedule }: ReportCardProps): ReactNode {
  const Icon = resolveIcon(template.icon);

  return (
    <Card>
      <div className="space-y-3">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-accent/10">
            <Icon className="h-5 w-5 text-brand-accent" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-content">{template.name}</h3>
            <p className="mt-0.5 line-clamp-2 text-xs text-content-secondary">
              {template.description}
            </p>
          </div>
        </div>

        {/* Metrics count + last generated */}
        <div className="flex items-center justify-between">
          <Badge variant="info" size="sm">
            {template.metrics.length} metrics
          </Badge>
          {template.lastGenerated !== undefined && (
            <span className="text-2xs text-content-tertiary">
              Last: {formatRelativeTime(template.lastGenerated)}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1"
            onClick={() => {
              onGenerate(template.type);
            }}
          >
            Generate
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Calendar className="h-3.5 w-3.5" />}
            onClick={() => {
              onSchedule(template.type);
            }}
          >
            Schedule
          </Button>
        </div>
      </div>
    </Card>
  );
}
