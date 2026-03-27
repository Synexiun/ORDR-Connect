/**
 * TicketStatusBadge — Maps ticket status to colored badge.
 *
 * Status -> Variant mapping:
 *   open       -> info (blue)
 *   in-progress -> warning (amber)
 *   waiting    -> neutral (slate)
 *   resolved   -> success (green)
 *   closed     -> neutral (slate)
 */

import { type ReactNode } from 'react';
import { Badge } from '../ui/Badge';
import type { TicketStatus } from '../../lib/tickets-api';

interface TicketStatusBadgeProps {
  status: TicketStatus;
  size?: 'sm' | 'md';
}

const statusConfig: Record<
  TicketStatus,
  { variant: 'info' | 'warning' | 'neutral' | 'success'; label: string }
> = {
  open: { variant: 'info', label: 'Open' },
  'in-progress': { variant: 'warning', label: 'In Progress' },
  waiting: { variant: 'neutral', label: 'Waiting' },
  resolved: { variant: 'success', label: 'Resolved' },
  closed: { variant: 'neutral', label: 'Closed' },
};

export function TicketStatusBadge({ status, size = 'sm' }: TicketStatusBadgeProps): ReactNode {
  const config = statusConfig[status];
  return (
    <Badge variant={config.variant} size={size} dot>
      {config.label}
    </Badge>
  );
}
