import { describe, it, expect } from 'vitest';
import {
  validateEvent,
  eventSchemaRegistry,
  customerCreatedPayloadSchema,
  customerUpdatedPayloadSchema,
  interactionLoggedPayloadSchema,
  agentActionExecutedPayloadSchema,
  complianceCheckPayloadSchema,
  authEventPayloadSchema,
  createEnvelopeSchema,
} from '../schemas.js';
import { EventType } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────

function makeEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    type: 'customer.created',
    tenantId: 'tenant-001',
    payload: {
      customerId: 'cust-001',
      name: 'Acme Corp',
      email: 'contact@acme.com',
      type: 'enterprise',
      lifecycleStage: 'onboarding',
    },
    metadata: {
      correlationId: '11111111-1111-1111-1111-111111111111',
      causationId: '22222222-2222-2222-2222-222222222222',
      source: 'api-gateway',
      version: 1,
    },
    timestamp: '2026-03-24T12:00:00.000Z',
    ...overrides,
  };
}

// ─── Payload Schema Tests ─────────────────────────────────────────

describe('Payload schemas', () => {
  describe('customerCreatedPayloadSchema', () => {
    it('accepts a valid payload', () => {
      const result = customerCreatedPayloadSchema.safeParse({
        customerId: 'cust-001',
        name: 'Acme Corp',
        email: 'test@example.com',
        type: 'enterprise',
        lifecycleStage: 'onboarding',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required fields', () => {
      const result = customerCreatedPayloadSchema.safeParse({
        customerId: 'cust-001',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid email', () => {
      const result = customerCreatedPayloadSchema.safeParse({
        customerId: 'cust-001',
        name: 'Acme',
        email: 'not-an-email',
        type: 'enterprise',
        lifecycleStage: 'onboarding',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('customerUpdatedPayloadSchema', () => {
    it('accepts a valid payload with changes', () => {
      const result = customerUpdatedPayloadSchema.safeParse({
        customerId: 'cust-001',
        changes: {
          name: { old: 'Old Corp', new: 'New Corp' },
          email: { old: 'old@test.com', new: 'new@test.com' },
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing customerId', () => {
      const result = customerUpdatedPayloadSchema.safeParse({
        changes: { name: { old: 'a', new: 'b' } },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('interactionLoggedPayloadSchema', () => {
    it('accepts a valid payload with optional sentiment', () => {
      const result = interactionLoggedPayloadSchema.safeParse({
        interactionId: 'int-001',
        customerId: 'cust-001',
        channel: 'email',
        direction: 'inbound',
        type: 'support',
        sentiment: 'positive',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a valid payload without sentiment', () => {
      const result = interactionLoggedPayloadSchema.safeParse({
        interactionId: 'int-001',
        customerId: 'cust-001',
        channel: 'phone',
        direction: 'outbound',
        type: 'sales',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('agentActionExecutedPayloadSchema', () => {
    it('accepts a valid payload', () => {
      const result = agentActionExecutedPayloadSchema.safeParse({
        actionId: 'act-001',
        agentId: 'agent-lead-qual',
        agentRole: 'lead_qualifier',
        actionType: 'score_lead',
        confidence: 0.87,
        approved: true,
      });
      expect(result.success).toBe(true);
    });

    it('rejects confidence out of range', () => {
      const result = agentActionExecutedPayloadSchema.safeParse({
        actionId: 'act-001',
        agentId: 'agent-001',
        agentRole: 'lead_qualifier',
        actionType: 'score_lead',
        confidence: 1.5,
        approved: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative confidence', () => {
      const result = agentActionExecutedPayloadSchema.safeParse({
        actionId: 'act-001',
        agentId: 'agent-001',
        agentRole: 'lead_qualifier',
        actionType: 'score_lead',
        confidence: -0.1,
        approved: false,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('complianceCheckPayloadSchema', () => {
    it('accepts a valid payload with optional customerId', () => {
      const result = complianceCheckPayloadSchema.safeParse({
        recordId: 'rec-001',
        regulation: 'HIPAA',
        ruleId: 'hipaa-phi-access',
        result: 'pass',
        customerId: 'cust-001',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a valid payload without customerId', () => {
      const result = complianceCheckPayloadSchema.safeParse({
        recordId: 'rec-001',
        regulation: 'SOC2',
        ruleId: 'soc2-access-control',
        result: 'fail',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('authEventPayloadSchema', () => {
    it('accepts all valid actions', () => {
      const actions = ['login', 'logout', 'failed', 'mfa_verified'] as const;
      for (const action of actions) {
        const result = authEventPayloadSchema.safeParse({
          userId: 'user-001',
          action,
          ipAddress: '10.0.0.1',
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid action', () => {
      const result = authEventPayloadSchema.safeParse({
        userId: 'user-001',
        action: 'hack',
      });
      expect(result.success).toBe(false);
    });
  });
});

// ─── Envelope Schema Tests ────────────────────────────────────────

describe('Envelope validation', () => {
  it('validates a complete customer.created envelope', () => {
    const schema = createEnvelopeSchema(customerCreatedPayloadSchema);
    const result = validateEvent(schema, makeEnvelope());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(result.data.tenantId).toBe('tenant-001');
    }
  });

  it('rejects envelope with invalid UUID', () => {
    const schema = createEnvelopeSchema(customerCreatedPayloadSchema);
    const result = validateEvent(schema, makeEnvelope({ id: 'not-a-uuid' }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.path === 'id')).toBe(true);
    }
  });

  it('rejects envelope with missing tenantId', () => {
    const data = makeEnvelope();
    delete data['tenantId'];

    const schema = createEnvelopeSchema(customerCreatedPayloadSchema);
    const result = validateEvent(schema, data);

    expect(result.success).toBe(false);
  });

  it('rejects envelope with invalid timestamp format', () => {
    const schema = createEnvelopeSchema(customerCreatedPayloadSchema);
    const result = validateEvent(schema, makeEnvelope({ timestamp: 'yesterday' }));

    expect(result.success).toBe(false);
  });

  it('rejects envelope with missing metadata fields', () => {
    const schema = createEnvelopeSchema(customerCreatedPayloadSchema);
    const result = validateEvent(schema, makeEnvelope({
      metadata: { correlationId: '11111111-1111-1111-1111-111111111111' },
    }));

    expect(result.success).toBe(false);
  });

  it('rejects envelope with wrong payload for schema', () => {
    const schema = createEnvelopeSchema(customerCreatedPayloadSchema);
    const result = validateEvent(schema, makeEnvelope({
      payload: {
        interactionId: 'int-001',
        customerId: 'cust-001',
        channel: 'email',
        direction: 'inbound',
        type: 'support',
      },
    }));

    expect(result.success).toBe(false);
  });
});

// ─── Schema Registry Tests ────────────────────────────────────────

describe('eventSchemaRegistry', () => {
  it('returns a schema for every registered event type', () => {
    const eventTypes = Object.values(EventType);
    for (const type of eventTypes) {
      const schema = eventSchemaRegistry.get(type);
      expect(schema).toBeDefined();
    }
  });

  it('returns undefined for unknown event type', () => {
    const schema = eventSchemaRegistry.get('unknown.event.type');
    expect(schema).toBeUndefined();
  });

  it('validates customer.created events via registry', () => {
    const schema = eventSchemaRegistry.get(EventType.CUSTOMER_CREATED);
    expect(schema).toBeDefined();

    const result = validateEvent(schema!, makeEnvelope());
    expect(result.success).toBe(true);
  });

  it('validates auth events via registry', () => {
    const schema = eventSchemaRegistry.get(EventType.AUTH_LOGIN);
    expect(schema).toBeDefined();

    const result = validateEvent(schema!, makeEnvelope({
      type: 'auth.login',
      payload: {
        userId: 'user-001',
        action: 'login',
        ipAddress: '192.168.1.1',
      },
    }));
    expect(result.success).toBe(true);
  });

  it('rejects invalid events via registry', () => {
    const schema = eventSchemaRegistry.get(EventType.CUSTOMER_CREATED);
    expect(schema).toBeDefined();

    const result = validateEvent(schema!, makeEnvelope({
      payload: { invalid: true },
    }));
    expect(result.success).toBe(false);
  });
});

// ─── validateEvent Helper Tests ───────────────────────────────────

describe('validateEvent', () => {
  it('returns success with parsed data for valid input', () => {
    const result = validateEvent(customerCreatedPayloadSchema, {
      customerId: 'cust-001',
      name: 'Test',
      email: 'test@example.com',
      type: 'smb',
      lifecycleStage: 'active',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customerId).toBe('cust-001');
    }
  });

  it('returns failure with structured issues for invalid input', () => {
    const result = validateEvent(customerCreatedPayloadSchema, {
      customerId: '',
      name: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Validation failed');
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]).toHaveProperty('path');
      expect(result.issues[0]).toHaveProperty('message');
    }
  });

  it('returns failure for completely wrong type', () => {
    const result = validateEvent(customerCreatedPayloadSchema, 'not-an-object');

    expect(result.success).toBe(false);
  });

  it('returns failure for null input', () => {
    const result = validateEvent(customerCreatedPayloadSchema, null);

    expect(result.success).toBe(false);
  });
});
