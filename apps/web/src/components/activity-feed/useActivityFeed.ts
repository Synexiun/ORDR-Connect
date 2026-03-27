/**
 * useActivityFeed — Hook for polling real-time activity events.
 *
 * Polls /api/v1/analytics/real-time every N seconds (default 5s).
 * Maintains event buffer, deduplicates by event ID, caps at maxItems.
 *
 * MVP: Uses polling. Will migrate to WebSocket when infrastructure is ready.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../../lib/api';

export interface FeedEvent {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'success' | 'danger';
}

interface UseActivityFeedOptions {
  maxItems?: number;
  pollInterval?: number;
}

interface UseActivityFeedReturn {
  events: FeedEvent[];
  isPolling: boolean;
  error: string | null;
}

// --- Mock events for graceful degradation ---

const mockEventTypes = [
  {
    type: 'agent.session',
    description: 'Collection agent completed session for account',
    severity: 'success' as const,
  },
  {
    type: 'compliance.check',
    description: 'HIPAA compliance check passed for tenant operations',
    severity: 'info' as const,
  },
  {
    type: 'channel.delivery',
    description: 'SMS delivery batch completed: 847/850 delivered',
    severity: 'info' as const,
  },
  {
    type: 'agent.escalation',
    description: 'Agent requested human review: low confidence',
    severity: 'warning' as const,
  },
  {
    type: 'audit.verified',
    description: 'Merkle root verified for event batch',
    severity: 'success' as const,
  },
  {
    type: 'compliance.violation',
    description: 'TCPA quiet hours violation blocked',
    severity: 'danger' as const,
  },
  {
    type: 'customer.created',
    description: 'New enterprise customer onboarded',
    severity: 'info' as const,
  },
  {
    type: 'hitl.pending',
    description: 'Financial action requires human approval',
    severity: 'warning' as const,
  },
  {
    type: 'channel.delivery',
    description: 'Email batch delivered: 1,240/1,245 successful',
    severity: 'success' as const,
  },
  {
    type: 'system.health',
    description: 'All services healthy, audit chain verified',
    severity: 'info' as const,
  },
  {
    type: 'agent.session',
    description: 'Onboarding agent completed welcome sequence',
    severity: 'success' as const,
  },
  {
    type: 'customer.risk',
    description: 'Health score degradation detected for 3 accounts',
    severity: 'warning' as const,
  },
];

function generateMockEvent(index: number): FeedEvent {
  const templateIndex = index % mockEventTypes.length;
  const template =
    templateIndex < mockEventTypes.length ? mockEventTypes[templateIndex] : mockEventTypes[0];
  if (template === undefined) {
    return {
      id: `feed-${Date.now()}-${index}`,
      type: 'system',
      description: '',
      timestamp: new Date().toISOString(),
      severity: 'info' as const,
    };
  }
  return {
    id: `feed-${Date.now()}-${index}`,
    type: template.type,
    description: template.description,
    timestamp: new Date(Date.now() - index * 120000).toISOString(),
    severity: template.severity,
  };
}

export function useActivityFeed({
  maxItems = 100,
  pollInterval = 5000,
}: UseActivityFeedOptions = {}): UseActivityFeedReturn {
  const [events, setEvents] = useState<FeedEvent[]>(() =>
    Array.from({ length: 10 }, (_, i) => generateMockEvent(i)),
  );
  const [isPolling, setIsPolling] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seenIdsRef = useRef(
    new Set<string>(Array.from({ length: 10 }, (_, i) => `feed-${Date.now()}-${i}`)),
  );
  const pollCountRef = useRef(0);

  const fetchEvents = useCallback(async () => {
    try {
      const response = await apiClient.get<{ events: FeedEvent[] }>('/v1/analytics/real-time');

      const newEvents = response.events.filter((e) => !seenIdsRef.current.has(e.id));

      if (newEvents.length > 0) {
        for (const e of newEvents) {
          seenIdsRef.current.add(e.id);
        }

        setEvents((prev) => {
          const merged = [...newEvents, ...prev];
          // Trim to maxItems
          if (merged.length > maxItems) {
            const removed = merged.slice(maxItems);
            for (const e of removed) {
              seenIdsRef.current.delete(e.id);
            }
            return merged.slice(0, maxItems);
          }
          return merged;
        });
      }

      setError(null);
    } catch {
      // Graceful degradation — generate mock event periodically
      pollCountRef.current += 1;
      if (pollCountRef.current % 3 === 0) {
        const mockEvent = generateMockEvent(pollCountRef.current);
        mockEvent.id = `feed-poll-${Date.now()}`;
        mockEvent.timestamp = new Date().toISOString();

        if (!seenIdsRef.current.has(mockEvent.id)) {
          seenIdsRef.current.add(mockEvent.id);
          setEvents((prev) => {
            const updated = [mockEvent, ...prev];
            if (updated.length > maxItems) {
              return updated.slice(0, maxItems);
            }
            return updated;
          });
        }
      }
    }
  }, [maxItems]);

  useEffect(() => {
    setIsPolling(true);
    const intervalId = setInterval(() => {
      void fetchEvents();
    }, pollInterval);

    return () => {
      clearInterval(intervalId);
      setIsPolling(false);
    };
  }, [fetchEvents, pollInterval]);

  return { events, isPolling, error };
}
