import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageBus } from '../message-protocol.js';
import type { AgentMessage, MessageType } from '../message-protocol.js';

// ─── Tests ──────────────────────────────────────────────────────

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus('tenant-1');
  });

  // ── Message Creation ──────────────────────────────

  describe('createMessage', () => {
    it('should create a message with all required fields', () => {
      const msg = MessageBus.createMessage(
        'collections',
        'session-1',
        'escalation',
        'handoff_request',
        { reason: 'Customer wants human' },
      );

      expect(msg.id).toBeDefined();
      expect(msg.fromAgent.role).toBe('collections');
      expect(msg.fromAgent.sessionId).toBe('session-1');
      expect(msg.toAgent.role).toBe('escalation');
      expect(msg.type).toBe('handoff_request');
      expect(msg.payload).toEqual({ reason: 'Customer wants human' });
      expect(msg.timestamp).toBeInstanceOf(Date);
      expect(msg.correlationId).toBeDefined();
    });

    it('should use provided correlation ID', () => {
      const msg = MessageBus.createMessage(
        'collections',
        'session-1',
        'escalation',
        'handoff_request',
        {},
        'corr-123',
      );

      expect(msg.correlationId).toBe('corr-123');
    });

    it('should generate unique IDs for different messages', () => {
      const msg1 = MessageBus.createMessage('collections', 's-1', 'escalation', 'handoff_request', {});
      const msg2 = MessageBus.createMessage('collections', 's-2', 'escalation', 'handoff_request', {});
      expect(msg1.id).not.toBe(msg2.id);
    });
  });

  // ── Send & Subscribe ──────────────────────────────

  describe('send and subscribe', () => {
    it('should deliver message to subscriber of target role', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      bus.subscribe('escalation', handler);

      const msg = MessageBus.createMessage(
        'collections',
        'session-1',
        'escalation',
        'handoff_request',
        { data: 'test' },
      );

      await bus.send(msg);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(msg);
    });

    it('should not deliver to subscribers of different role', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      bus.subscribe('support_triage', handler);

      const msg = MessageBus.createMessage(
        'collections',
        'session-1',
        'escalation',
        'handoff_request',
        {},
      );

      await bus.send(msg);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should deliver to multiple subscribers of same role', async () => {
      const handler1 = vi.fn().mockResolvedValue(undefined);
      const handler2 = vi.fn().mockResolvedValue(undefined);
      bus.subscribe('escalation', handler1);
      bus.subscribe('escalation', handler2);

      const msg = MessageBus.createMessage(
        'collections',
        'session-1',
        'escalation',
        'handoff_request',
        {},
      );

      await bus.send(msg);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should handle send with no subscribers gracefully', async () => {
      const msg = MessageBus.createMessage(
        'collections',
        'session-1',
        'escalation',
        'handoff_request',
        {},
      );

      // Should not throw
      await expect(bus.send(msg)).resolves.toBeUndefined();
    });
  });

  // ── Message History ───────────────────────────────

  describe('message history', () => {
    it('should store messages by session ID', async () => {
      const msg1 = MessageBus.createMessage('collections', 'session-1', 'escalation', 'handoff_request', {});
      const msg2 = MessageBus.createMessage('collections', 'session-1', 'escalation', 'status_update', {});
      const msg3 = MessageBus.createMessage('support_triage', 'session-2', 'escalation', 'info_request', {});

      await bus.send(msg1);
      await bus.send(msg2);
      await bus.send(msg3);

      const session1Messages = bus.getMessages('session-1');
      expect(session1Messages).toHaveLength(2);

      const session2Messages = bus.getMessages('session-2');
      expect(session2Messages).toHaveLength(1);
    });

    it('should return empty array for unknown session', () => {
      expect(bus.getMessages('non-existent')).toHaveLength(0);
    });

    it('should track total message count', async () => {
      expect(bus.totalMessageCount).toBe(0);

      await bus.send(MessageBus.createMessage('collections', 's-1', 'escalation', 'handoff_request', {}));
      expect(bus.totalMessageCount).toBe(1);

      await bus.send(MessageBus.createMessage('collections', 's-2', 'escalation', 'status_update', {}));
      expect(bus.totalMessageCount).toBe(2);
    });
  });

  // ── Correlation Tracking ──────────────────────────

  describe('correlation tracking', () => {
    it('should find messages by correlation ID', async () => {
      const correlationId = 'corr-abc';
      const msg1 = MessageBus.createMessage('collections', 's-1', 'escalation', 'handoff_request', {}, correlationId);
      const msg2 = MessageBus.createMessage('escalation', 's-2', 'collections', 'handoff_accept', {}, correlationId);
      const msg3 = MessageBus.createMessage('collections', 's-1', 'support_triage', 'info_request', {}, 'other-corr');

      await bus.send(msg1);
      await bus.send(msg2);
      await bus.send(msg3);

      const correlated = bus.getByCorrelationId(correlationId);
      expect(correlated).toHaveLength(2);
    });

    it('should return empty for unknown correlation ID', () => {
      expect(bus.getByCorrelationId('non-existent')).toHaveLength(0);
    });
  });

  // ── Message Types ─────────────────────────────────

  describe('message types', () => {
    it('should support all message types', async () => {
      const types: MessageType[] = [
        'handoff_request',
        'handoff_accept',
        'info_request',
        'info_response',
        'escalation',
        'status_update',
      ];

      for (const type of types) {
        const msg = MessageBus.createMessage('collections', 's-1', 'escalation', type, {});
        await bus.send(msg);
        expect(msg.type).toBe(type);
      }

      expect(bus.totalMessageCount).toBe(types.length);
    });
  });

  // ── Unsubscribe ───────────────────────────────────

  describe('unsubscribe', () => {
    it('should remove all handlers for a role', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      bus.subscribe('escalation', handler);

      bus.unsubscribe('escalation');

      const msg = MessageBus.createMessage('collections', 's-1', 'escalation', 'handoff_request', {});
      await bus.send(msg);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── Audit Logging ─────────────────────────────────

  describe('audit logging', () => {
    it('should audit log messages when audit logger provided', async () => {
      const auditLog = { log: vi.fn().mockResolvedValue(undefined) };
      const auditBus = new MessageBus('tenant-1', auditLog);

      const msg = MessageBus.createMessage('collections', 's-1', 'escalation', 'handoff_request', { data: 'test' });
      await auditBus.send(msg);

      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'message_sent_handoff_request',
          tenantId: 'tenant-1',
        }),
      );
    });

    it('should log metadata only — not payload content', async () => {
      const auditLog = { log: vi.fn().mockResolvedValue(undefined) };
      const auditBus = new MessageBus('tenant-1', auditLog);

      const msg = MessageBus.createMessage('collections', 's-1', 'escalation', 'handoff_request', { sensitiveData: 'should not appear' });
      await auditBus.send(msg);

      const auditCall = auditLog.log.mock.calls[0]?.[0];
      expect(auditCall?.details).not.toHaveProperty('sensitiveData');
      expect(auditCall?.details).toHaveProperty('fromRole');
      expect(auditCall?.details).toHaveProperty('toRole');
      expect(auditCall?.details).toHaveProperty('messageType');
    });
  });
});
