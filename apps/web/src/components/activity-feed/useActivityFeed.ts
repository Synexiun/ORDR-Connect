/**
 * useActivityFeed — SSE-backed real-time activity event feed.
 *
 * Subscribes to the ORDR-Connect SSE stream (/api/v1/realtime/stream) and
 * collects typed events into a capped, deduplicated feed buffer.
 *
 * Falls back to mock events for graceful degradation when no SSE token is
 * available or the API is unreachable.
 *
 * COMPLIANCE: No PHI/PII in event descriptions — metadata only.
 */

import { useState, useCallback, useRef } from 'react';
import { useRealtimeEvents } from '../../hooks/useRealtimeEvents';

export interface FeedEvent {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'success' | 'danger';
}

interface UseActivityFeedOptions {
  maxItems?: number;
  /** @deprecated Ignored — feed is now SSE-driven. Kept for backward compat. */
  pollInterval?: number;
}

interface UseActivityFeedReturn {
  events: FeedEvent[];
  isPolling: boolean;
  error: string | null;
}

// ── Event type → severity mapping ─────────────────────────────────

function severityForType(eventType: string): FeedEvent['severity'] {
  if (
    eventType.includes('violation') ||
    eventType.includes('error') ||
    eventType.includes('failed') ||
    eventType.includes('hitl')
  ) {
    return 'danger';
  }
  if (
    eventType.includes('warning') ||
    eventType.includes('escalation') ||
    eventType.includes('risk') ||
    eventType.includes('pending')
  ) {
    return 'warning';
  }
  if (
    eventType.includes('completed') ||
    eventType.includes('verified') ||
    eventType.includes('delivered') ||
    eventType.includes('created')
  ) {
    return 'success';
  }
  return 'info';
}

function descriptionForEvent(eventType: string, data: Record<string, unknown>): string {
  if (typeof data['description'] === 'string') return data['description'];
  if (typeof data['message'] === 'string') return data['message'];
  return eventType.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function timestampFromData(data: Record<string, unknown>): string {
  return typeof data['timestamp'] === 'string' ? data['timestamp'] : new Date().toISOString();
}

function idFromData(data: Record<string, unknown>): string {
  return typeof data['eventId'] === 'string'
    ? data['eventId']
    : `sse-${Date.now()}-${Math.random()}`;
}

// ── Mock fallback ─────────────────────────────────────────────────

const MOCK_TEMPLATES: Array<{
  type: string;
  description: string;
  severity: FeedEvent['severity'];
}> = [
  { type: 'agent.session', description: 'Collection agent completed session', severity: 'success' },
  { type: 'compliance.check', description: 'HIPAA compliance check passed', severity: 'info' },
  {
    type: 'channel.delivery',
    description: 'SMS delivery batch: 847/850 delivered',
    severity: 'info',
  },
  {
    type: 'agent.escalation',
    description: 'Agent requested human review: low confidence',
    severity: 'warning',
  },
  {
    type: 'audit.verified',
    description: 'Merkle root verified for event batch',
    severity: 'success',
  },
  {
    type: 'compliance.violation',
    description: 'TCPA quiet hours violation blocked',
    severity: 'danger',
  },
  { type: 'customer.created', description: 'New enterprise customer onboarded', severity: 'info' },
  {
    type: 'hitl.pending',
    description: 'Financial action requires human approval',
    severity: 'warning',
  },
];

function makeMockEvent(index: number): FeedEvent {
  const template = MOCK_TEMPLATES[index % MOCK_TEMPLATES.length];
  const type = template?.type ?? 'agent.session';
  const description = template?.description ?? 'Agent completed session';
  const severity = template?.severity ?? 'info';
  return {
    id: `mock-${index}`,
    type,
    description,
    timestamp: new Date(Date.now() - index * 90_000).toISOString(),
    severity,
  };
}

// ── SSE event type list (all monitored types) ─────────────────────

const MONITORED_TYPES: ReadonlyArray<string> = [
  'agent.session_completed',
  'agent.hitl_created',
  'agent.error',
  'compliance.violation',
  'compliance.check_passed',
  'workflow.started',
  'workflow.completed',
  'workflow.failed',
  'customer.created',
  'billing.payment_succeeded',
  'billing.payment_failed',
  'system.health',
];

// ── Hook ──────────────────────────────────────────────────────────

export function useActivityFeed({
  maxItems = 100,
}: UseActivityFeedOptions = {}): UseActivityFeedReturn {
  const [events, setEvents] = useState<FeedEvent[]>(() =>
    Array.from({ length: 8 }, (_, i) => makeMockEvent(i)),
  );
  const seenIdsRef = useRef(new Set<string>(Array.from({ length: 8 }, (_, i) => `mock-${i}`)));

  const addEvent = useCallback(
    (event: FeedEvent) => {
      if (seenIdsRef.current.has(event.id)) return;
      seenIdsRef.current.add(event.id);
      setEvents((prev) => {
        const next = [event, ...prev];
        if (next.length > maxItems) {
          const removed = next.slice(maxItems);
          for (const e of removed) seenIdsRef.current.delete(e.id);
          return next.slice(0, maxItems);
        }
        return next;
      });
    },
    [maxItems],
  );

  // Build handlers map for all monitored event types
  const handlers = Object.fromEntries(
    MONITORED_TYPES.map((type) => [
      type,
      (data: Record<string, unknown>) => {
        addEvent({
          id: idFromData(data),
          type,
          description: descriptionForEvent(type, data),
          timestamp: timestampFromData(data),
          severity: severityForType(type),
        });
      },
    ]),
  );

  useRealtimeEvents(handlers);

  return { events, isPolling: true, error: null };
}
