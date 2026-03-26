/**
 * Activity Feed — Real-time event stream component.
 *
 * Polls /api/v1/analytics/real-time every 5 seconds (WebSocket stub for MVP).
 * Deduplicates by event ID. Max 100 items in view.
 *
 * COMPLIANCE: No PHI/PII in event descriptions — metadata only.
 */

import { type ReactNode, useEffect, useRef, useCallback } from 'react';
import { Badge } from '../ui/Badge';
import { cn } from '../../lib/cn';
import { useActivityFeed, type FeedEvent } from './useActivityFeed';

// --- Event type styling ---

type EventCategory = 'agent' | 'compliance' | 'channel' | 'customer' | 'audit' | 'hitl' | 'system';

function categorize(eventType: string): EventCategory {
  if (eventType.startsWith('agent.')) return 'agent';
  if (eventType.startsWith('compliance.')) return 'compliance';
  if (eventType.startsWith('channel.')) return 'channel';
  if (eventType.startsWith('customer.')) return 'customer';
  if (eventType.startsWith('audit.')) return 'audit';
  if (eventType.startsWith('hitl.')) return 'hitl';
  return 'system';
}

const categoryIcon: Record<EventCategory, string> = {
  agent: '\u25B2',
  compliance: '\u25C6',
  channel: '\u2709',
  customer: '\u25CF',
  audit: '\u25A0',
  hitl: '\u26A0',
  system: '\u2699',
};

const categoryBadge: Record<EventCategory, 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  agent: 'info',
  compliance: 'warning',
  channel: 'success',
  customer: 'info',
  audit: 'neutral',
  hitl: 'danger',
  system: 'neutral',
};

// --- Timestamp formatter ---

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// --- ActivityItem ---

interface ActivityItemProps {
  event: FeedEvent;
}

export function ActivityItem({ event }: ActivityItemProps): ReactNode {
  const category = categorize(event.type);

  return (
    <div
      className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
      role="listitem"
      aria-label={`${event.type}: ${event.description}`}
    >
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-xs"
        aria-hidden="true"
      >
        {categoryIcon[category]}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant={categoryBadge[category]} size="sm">
            {event.type.split('.')[0] ?? event.type}
          </Badge>
          <Badge
            variant={
              event.severity === 'danger' ? 'danger' :
              event.severity === 'warning' ? 'warning' :
              event.severity === 'success' ? 'success' : 'neutral'
            }
            size="sm"
            dot
          >
            {event.severity}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-content">{event.description}</p>
        <p className="mt-0.5 text-2xs text-content-tertiary">
          {formatRelativeTime(event.timestamp)}
        </p>
      </div>
    </div>
  );
}

// --- ActivityFeed ---

interface ActivityFeedProps {
  maxItems?: number;
  className?: string;
  pollInterval?: number;
}

export function ActivityFeed({
  maxItems = 100,
  className,
  pollInterval = 5000,
}: ActivityFeedProps): ReactNode {
  const { events, isPolling } = useActivityFeed({ maxItems, pollInterval });
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // Auto-scroll when new events arrive
  useEffect(() => {
    scrollToBottom();
  }, [events.length, scrollToBottom]);

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          {isPolling && (
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
          )}
          <span className="text-2xs text-content-tertiary">
            {events.length} event{events.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="max-h-[480px] overflow-y-auto divide-y divide-border"
        role="list"
        aria-label="Activity feed"
        aria-live="polite"
      >
        {events.length === 0 ? (
          <p className="py-8 text-center text-sm text-content-secondary">
            No recent activity
          </p>
        ) : (
          events.map((event) => (
            <ActivityItem key={event.id} event={event} />
          ))
        )}
      </div>
    </div>
  );
}
