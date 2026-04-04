import { describe, it, expect } from 'vitest';
import { TOPICS, EventType } from '../index.js';
import { eventSchemaRegistry } from '../schemas.js';

describe('DSR events', () => {
  it('TOPICS.DSR_EVENTS resolves to correct topic string', () => {
    expect(TOPICS.DSR_EVENTS).toBe('ordr.dsr.events');
  });

  it('EventType.DSR_APPROVED is defined', () => {
    expect(EventType.DSR_APPROVED).toBe('dsr.approved');
  });

  it('eventSchemaRegistry has dsr.approved schema', () => {
    expect(eventSchemaRegistry.has('dsr.approved')).toBe(true);
  });

  it('dsr.approved schema validates a valid envelope', () => {
    const schema = eventSchemaRegistry.get('dsr.approved')!;
    const result = schema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      type: 'dsr.approved',
      tenantId: 'tenant-1',
      payload: {
        dsrId: '00000000-0000-0000-0000-000000000002',
        tenantId: 'tenant-1',
        customerId: '00000000-0000-0000-0000-000000000003',
        type: 'access',
      },
      metadata: {
        correlationId: 'corr-1',
        causationId: 'cause-1',
        source: 'api',
        version: 1,
      },
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });
});
