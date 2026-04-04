import { describe, it, expect } from 'vitest';
import { TOPICS, DEFAULT_TOPIC_CONFIGS } from '../topics.js';
import { EventType } from '../types.js';
import { eventSchemaRegistry } from '../schemas.js';

describe('integration events', () => {
  it('TOPICS.INTEGRATION_EVENTS is defined', () => {
    expect(TOPICS.INTEGRATION_EVENTS).toBe('ordr.integration.events');
  });

  it('INTEGRATION_EVENTS topic config has 6 partitions and 14-day retention', () => {
    const cfg = DEFAULT_TOPIC_CONFIGS[TOPICS.INTEGRATION_EVENTS];
    expect(cfg.partitions).toBe(6);
    expect(cfg.retentionMs).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('EventType has all 5 integration constants', () => {
    expect(EventType.INTEGRATION_WEBHOOK_RECEIVED).toBe('integration.webhook_received');
    expect(EventType.INTEGRATION_SYNC_COMPLETED).toBe('integration.sync_completed');
    expect(EventType.INTEGRATION_SYNC_FAILED).toBe('integration.sync_failed');
    expect(EventType.INTEGRATION_CONNECTED).toBe('integration.connected');
    expect(EventType.INTEGRATION_DISCONNECTED).toBe('integration.disconnected');
  });

  it('eventSchemaRegistry has integration.webhook_received schema', () => {
    expect(eventSchemaRegistry.has('integration.webhook_received')).toBe(true);
  });

  it('webhook_received schema validates correct payload', () => {
    const schema = eventSchemaRegistry.get('integration.webhook_received');
    const result = schema?.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      type: 'integration.webhook_received',
      tenantId: 'tenant-1',
      payload: {
        tenantId: 'tenant-1',
        provider: 'salesforce',
        entityType: 'contact',
        externalId: 'sf-001',
        eventType: 'contact.created',
        webhookLogId: '00000000-0000-0000-0000-000000000002',
      },
      metadata: {
        correlationId: 'c-1',
        causationId: 'ca-1',
        source: 'api',
        version: 1,
      },
      timestamp: new Date().toISOString(),
    });
    expect(result?.success).toBe(true);
  });
});
