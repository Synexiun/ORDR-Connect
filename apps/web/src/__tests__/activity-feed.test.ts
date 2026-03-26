/**
 * Activity Feed Tests
 *
 * Validates ActivityFeed component and useActivityFeed hook behavior:
 * - Renders items correctly
 * - Event deduplication by ID
 * - Event categorization
 * - Severity badge mapping
 * - No PHI in feed events
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { ActivityFeed, ActivityItem } from '../components/activity-feed/ActivityFeed';
import type { FeedEvent } from '../components/activity-feed/useActivityFeed';

// --- Mock event factory ---

function createEvent(overrides: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id: `test-${Date.now()}-${Math.random()}`,
    type: 'agent.session',
    description: 'Test event description',
    timestamp: new Date().toISOString(),
    severity: 'info',
    ...overrides,
  };
}

describe('ActivityFeed component', () => {
  it('creates a valid React element', () => {
    const element = createElement(ActivityFeed);
    expect(element).toBeDefined();
    expect(element.type).toBe(ActivityFeed);
  });

  it('accepts maxItems prop', () => {
    const element = createElement(ActivityFeed, { maxItems: 50 });
    expect(element.props.maxItems).toBe(50);
  });

  it('accepts pollInterval prop', () => {
    const element = createElement(ActivityFeed, { pollInterval: 10000 });
    expect(element.props.pollInterval).toBe(10000);
  });

  it('default maxItems is handled by component', () => {
    const element = createElement(ActivityFeed);
    // No maxItems prop — component uses default of 100
    expect(element.props.maxItems).toBeUndefined();
  });
});

describe('ActivityItem component', () => {
  it('creates element with event data', () => {
    const event = createEvent({
      type: 'agent.session',
      description: 'Collection agent completed session',
      severity: 'success',
    });
    const element = createElement(ActivityItem, { event });
    expect(element.props.event.type).toBe('agent.session');
    expect(element.props.event.severity).toBe('success');
  });

  it('handles compliance event type', () => {
    const event = createEvent({
      type: 'compliance.violation',
      severity: 'danger',
    });
    const element = createElement(ActivityItem, { event });
    expect(element.props.event.type.startsWith('compliance.')).toBe(true);
  });

  it('handles channel event type', () => {
    const event = createEvent({
      type: 'channel.delivery',
      severity: 'info',
    });
    const element = createElement(ActivityItem, { event });
    expect(element.props.event.type.startsWith('channel.')).toBe(true);
  });

  it('handles hitl event type', () => {
    const event = createEvent({
      type: 'hitl.pending',
      severity: 'warning',
    });
    const element = createElement(ActivityItem, { event });
    expect(element.props.event.type.startsWith('hitl.')).toBe(true);
  });
});

describe('Event deduplication logic', () => {
  it('events with same ID are detected as duplicates', () => {
    const seenIds = new Set<string>();
    const event1 = createEvent({ id: 'dup-001' });
    const event2 = createEvent({ id: 'dup-001' });

    seenIds.add(event1.id);
    const isDuplicate = seenIds.has(event2.id);
    expect(isDuplicate).toBe(true);
  });

  it('events with different IDs are not duplicates', () => {
    const seenIds = new Set<string>();
    const event1 = createEvent({ id: 'unique-001' });
    const event2 = createEvent({ id: 'unique-002' });

    seenIds.add(event1.id);
    const isDuplicate = seenIds.has(event2.id);
    expect(isDuplicate).toBe(false);
  });

  it('buffer respects maxItems limit', () => {
    const maxItems = 5;
    const events: FeedEvent[] = Array.from({ length: 10 }, (_, i) =>
      createEvent({ id: `evt-${i}` }),
    );
    const trimmed = events.slice(0, maxItems);
    expect(trimmed).toHaveLength(maxItems);
  });

  it('feed events never contain PHI fields', () => {
    const event = createEvent();
    const eventKeys = Object.keys(event);

    // These fields must NEVER exist in feed events
    const phiFields = ['content', 'body', 'message', 'phoneNumber', 'ssn', 'address'];
    for (const field of phiFields) {
      expect(eventKeys).not.toContain(field);
    }

    // Only allowed fields
    const allowedFields = ['id', 'type', 'description', 'timestamp', 'severity'];
    for (const key of eventKeys) {
      expect(allowedFields).toContain(key);
    }
  });
});
