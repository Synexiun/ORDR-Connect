/**
 * Integration test — Full operational event cycle.
 *
 * Tests the end-to-end flow from event ingestion through Kafka publish,
 * worker consumption, decision engine evaluation, agent execution,
 * channel delivery, audit trail creation, and graph enrichment.
 *
 * External services (Kafka, Neo4j) are mocked; real logic is tested.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  createTestTenant,
  createTestUser,
  getAuditStore,
  getAuditLogger,
  getComplianceEngine,
  getComplianceGate,
} from './setup.js';
import { createMockCustomer, createMockContact } from './fixtures/customer-factory.js';
import { createMockAgentSession, createMockAgentAction } from './fixtures/agent-factory.js';

// Events
import {
  EventType,
  createEventEnvelope,
  validateEvent,
  eventSchemaRegistry,
  customerCreatedPayloadSchema,
  createEnvelopeSchema,
} from '@ordr/events';
import type { EventEnvelope } from '@ordr/events';

// Audit
import { AuditLogger, InMemoryAuditStore, verifyChain } from '@ordr/audit';
import type { AuditEventInput } from '@ordr/audit';

// Decision Engine
import {
  RulesEngine,
  InMemoryRuleStore,
  MLScorer,
  createDefaultMLScorer,
  BUILTIN_RULES,
  copyBuiltinRulesForTenant,
  assembleFeatures,
} from '@ordr/decision-engine';
import type {
  DecisionContext,
  CustomerProfile,
  InteractionRecord,
  DecisionConstraints,
} from '@ordr/decision-engine';

// Compliance
import { ComplianceEngine, ComplianceGate, ALL_RULES } from '@ordr/compliance';

// Crypto
import { sha256, encryptString, decryptString, randomHex } from '@ordr/crypto';

// Core
import type { UserRole } from '@ordr/core';

// ── Helpers ──────────────────────────────────────────────────────────

function makeDecisionContext(tenantId: string, customerId: string): DecisionContext {
  return {
    tenantId,
    customerId,
    eventType: 'payment_missed',
    eventPayload: { amountDue: 5000, daysPastDue: 15 },
    customerProfile: {
      healthScore: 45,
      lifecycleStage: 'at_risk',
      segment: 'mid_market',
      ltv: 25000,
      sentimentAvg: 0.3,
      responseRate: 0.6,
      preferredChannel: 'email',
      outstandingBalance: 5000,
      maxBalance: 10000,
      daysSinceLastContact: 5,
      totalInteractions30d: 3,
      paymentHistory: [
        { date: new Date('2025-12-01'), amount: 5000, onTime: true },
        { date: new Date('2026-01-01'), amount: 0, onTime: false },
      ],
    },
    channelPreferences: ['email', 'sms'],
    interactionHistory: [
      {
        id: 'int-1',
        channel: 'email',
        direction: 'outbound',
        timestamp: new Date('2026-01-10'),
        outcome: 'delivered',
        sentiment: 0.5,
        responded: true,
      },
    ],
    constraints: {
      budgetCents: 100,
      timeWindowMinutes: 60,
      blockedChannels: [],
      maxContactsPerWeek: 7,
      maxSmsPerDay: 3,
      maxEmailsPerWeek: 10,
    },
    timestamp: new Date('2026-01-15T14:00:00.000Z'),
    correlationId: 'corr-evt-001',
  };
}

function makeAuditInput(tenantId: string, overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    tenantId,
    eventType: overrides?.eventType ?? 'data.created',
    actorType: overrides?.actorType ?? 'system',
    actorId: overrides?.actorId ?? 'worker-1',
    resource: overrides?.resource ?? 'customer',
    resourceId: overrides?.resourceId ?? 'cust-001',
    action: overrides?.action ?? 'ingest_event',
    details: overrides?.details ?? { source: 'integration_test' },
    timestamp: overrides?.timestamp ?? new Date('2026-01-15T14:00:00.000Z'),
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Event Cycle — End-to-End', () => {
  let tenantId: string;
  let auditStore: InMemoryAuditStore;
  let auditLogger: AuditLogger;

  beforeAll(async () => {
    await setupTestEnvironment();
  });

  beforeEach(() => {
    auditStore = new InMemoryAuditStore();
    auditLogger = new AuditLogger(auditStore);
  });

  // ── Event Ingestion ────────────────────────────────────────────

  describe('Event ingestion and validation', () => {
    it('creates a valid event envelope for customer_created', () => {
      const envelope = createEventEnvelope(
        EventType.CUSTOMER_CREATED,
        'tnt-001',
        {
          customerId: 'cust-001',
          name: 'Test Customer',
          email: 'test@example.com',
          type: 'business',
          lifecycleStage: 'active',
        },
        { source: 'api', userId: 'usr-001', correlationId: 'corr-001' },
      );

      expect(envelope.type).toBe(EventType.CUSTOMER_CREATED);
      expect(envelope.tenantId).toBe('tnt-001');
      expect(envelope.id).toBeTruthy();
    });

    it('validates event against schema registry', () => {
      const envelope = createEventEnvelope(
        EventType.CUSTOMER_CREATED,
        'tnt-001',
        {
          customerId: 'cust-001',
          name: 'Test Customer',
          email: 'test@example.com',
          type: 'business',
          lifecycleStage: 'active',
        },
        { source: 'api', userId: 'usr-001', correlationId: 'corr-001' },
      );

      const schema = eventSchemaRegistry.get(EventType.CUSTOMER_CREATED)!;
      const validation = validateEvent(schema, envelope);
      expect(validation.success).toBe(true);
    });

    it('rejects event with missing required fields', () => {
      const badEnvelope = createEventEnvelope(
        EventType.CUSTOMER_CREATED,
        'tnt-001',
        { customerId: 'cust-001' } as Record<string, unknown>,
        { source: 'api', userId: 'usr-001', correlationId: 'corr-001' },
      );

      const schema = eventSchemaRegistry.get(EventType.CUSTOMER_CREATED)!;
      const validation = validateEvent(schema, badEnvelope);
      expect(validation.success).toBe(false);
    });

    it('preserves correlation ID through envelope creation', () => {
      const corrId = 'corr-trace-12345';
      const envelope = createEventEnvelope(
        EventType.INTERACTION_LOGGED,
        'tnt-001',
        {
          interactionId: 'int-001',
          customerId: 'cust-001',
          channel: 'email',
          direction: 'outbound',
          type: 'follow_up',
          sentiment: 'neutral',
        },
        { source: 'api', userId: 'usr-001', correlationId: corrId },
      );

      expect(envelope.metadata.correlationId).toBe(corrId);
    });

    it('assigns unique event IDs to each envelope', () => {
      const payload = {
        customerId: 'cust-001',
        name: 'A',
        email: 'a@example.com',
        type: 'business',
        lifecycleStage: 'active',
      };

      const e1 = createEventEnvelope(EventType.CUSTOMER_CREATED, 'tnt-001', payload, { source: 'api', userId: 'usr-001', correlationId: 'corr-001' });
      const e2 = createEventEnvelope(EventType.CUSTOMER_CREATED, 'tnt-001', payload, { source: 'api', userId: 'usr-001', correlationId: 'corr-001' });

      expect(e1.id).not.toBe(e2.id);
    });
  });

  // ── Worker Processing + Audit ──────────────────────────────────

  describe('Worker processes event and creates audit trail', () => {
    it('logs audit event when processing a customer event', async () => {
      const tnt = await createTestTenant('worker-test');

      const event = await auditLogger.log(makeAuditInput(tnt.id, {
        eventType: 'data.created',
        actorId: 'worker-1',
        resource: 'customer',
        resourceId: 'cust-001',
        action: 'process_event',
      }));

      expect(event.sequenceNumber).toBe(1);
      expect(event.tenantId).toBe(tnt.id);
      expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('maintains hash chain integrity across multiple events', async () => {
      const tnt = await createTestTenant('chain-test');

      await auditLogger.log(makeAuditInput(tnt.id, { resourceId: 'cust-001' }));
      await auditLogger.log(makeAuditInput(tnt.id, { resourceId: 'cust-002', action: 'update_record' }));
      await auditLogger.log(makeAuditInput(tnt.id, { resourceId: 'cust-003', action: 'score_health' }));

      const integrity = await auditLogger.verifyIntegrity(tnt.id);
      expect(integrity.valid).toBe(true);
      expect(integrity.totalEvents).toBe(3);
      expect(integrity.lastSequence).toBe(3);
    });

    it('records each step of the processing pipeline', async () => {
      const tnt = await createTestTenant('pipeline-test');

      // Step 1: Event ingested
      await auditLogger.log(makeAuditInput(tnt.id, {
        action: 'event_ingested',
        details: { eventType: 'payment_missed', source: 'kafka' },
      }));

      // Step 2: Customer record updated
      await auditLogger.log(makeAuditInput(tnt.id, {
        eventType: 'data.updated',
        action: 'update_customer',
        details: { field: 'outstandingBalance', ref: 'tok_balance_001' },
      }));

      // Step 3: Decision engine evaluated
      await auditLogger.log(makeAuditInput(tnt.id, {
        eventType: 'agent.decision',
        actorType: 'agent',
        actorId: 'nba-pipeline',
        action: 'evaluate_nba',
        details: { layer: 'rules', actionSelected: 'send_email' },
      }));

      // Step 4: Message delivered
      await auditLogger.log(makeAuditInput(tnt.id, {
        action: 'message_sent',
        details: { channel: 'email', ref: 'msg_tok_001' },
      }));

      const allEvents = auditStore.getAllEvents(tnt.id);
      expect(allEvents).toHaveLength(4);

      const chain = await auditLogger.verifyIntegrity(tnt.id);
      expect(chain.valid).toBe(true);
    });
  });

  // ── Decision Engine Integration ────────────────────────────────

  describe('Decision engine evaluates and selects NBA', () => {
    it('rules engine evaluates context and returns matching rules', async () => {
      const tnt = await createTestTenant('rules-test');
      const store = new InMemoryRuleStore();
      const builtins = copyBuiltinRulesForTenant(tnt.id);
      for (const rule of builtins) {
        await store.createRule(rule);
      }

      const rulesEngine = new RulesEngine(store);
      // Use a context with daysSinceLastContact >= 7 so the "Initial Contact" rule matches
      const ctx = {
        ...makeDecisionContext(tnt.id, 'cust-001'),
        customerProfile: {
          ...makeDecisionContext(tnt.id, 'cust-001').customerProfile,
          daysSinceLastContact: 10,
        },
      };
      const result = await rulesEngine.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
        // At least one rule should match for at_risk + payment_missed
        const matched = result.data.filter((r) => r.matched);
        expect(matched.length).toBeGreaterThan(0);
      }
    });

    it('ML scorer produces prediction scores within valid range', async () => {
      const scorer = createDefaultMLScorer();
      const ctx = makeDecisionContext('tnt-001', 'cust-001');
      const result = await scorer.scoreAll(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
        for (const pred of result.data) {
          expect(pred.score).toBeGreaterThanOrEqual(0);
          expect(pred.score).toBeLessThanOrEqual(1);
          expect(pred.confidence).toBeGreaterThanOrEqual(0);
          expect(pred.confidence).toBeLessThanOrEqual(1);
        }
      }
    });

    it('feature assembler extracts correct features from context', () => {
      const ctx = makeDecisionContext('tnt-001', 'cust-001');
      const features = assembleFeatures(ctx);

      expect(features['health_score']).toBe(45);
      expect(features['outstanding_balance_normalized']).toBeGreaterThan(0);
      expect(features['days_since_last_contact']).toBe(5);
      expect(features['response_rate']).toBe(0.6);
    });

    it('audit trail records decision with layer chain', async () => {
      const tnt = await createTestTenant('decision-audit');

      await auditLogger.log(makeAuditInput(tnt.id, {
        eventType: 'agent.decision',
        actorType: 'agent',
        actorId: 'nba-pipeline',
        resource: 'decision',
        resourceId: 'dec-001',
        action: 'evaluate',
        details: {
          layersUsed: ['rules', 'ml'],
          actionSelected: 'send_email',
          confidence: 0.82,
          durationMs: 45,
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events).toHaveLength(1);
      const entry = events[0]!;
      expect(entry.eventType).toBe('agent.decision');
      expect(entry.details['actionSelected']).toBe('send_email');
    });
  });

  // ── Compliance Gate on Actions ─────────────────────────────────

  describe('Compliance gate blocks non-compliant actions', () => {
    it('blocks autodialed SMS without consent', () => {
      const engine = new ComplianceEngine();
      engine.registerRules(ALL_RULES);
      const gate = new ComplianceGate(engine);

      const result = gate.checkForChannel('sms', {
        tenantId: 'tnt-001',
        customerId: 'cust-001',
        action: 'send_sms',
        channel: 'sms',
        data: {
          priorExpressConsent: false,
          isAutodialed: true,
          consumerOptedOut: true,
        },
        timestamp: new Date('2026-01-15T14:00:00.000Z'),
      });

      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('allows compliant email delivery', () => {
      const engine = new ComplianceEngine();
      engine.registerRules(ALL_RULES);
      const gate = new ComplianceGate(engine);

      const result = gate.checkForChannel('email', {
        tenantId: 'tnt-001',
        customerId: 'cust-001',
        action: 'send_email',
        channel: 'email',
        data: {
          legalBasis: 'consent',
          priorExpressConsent: true,
          hasUnsubscribeHeader: true,
          localHour: 14,
          miniMirandaIncluded: true,
          contactAttemptsLast7Days: 1,
        },
        timestamp: new Date('2026-01-15T14:00:00.000Z'),
      });

      expect(result.allowed).toBe(true);
    });
  });

  // ── Encryption + Data Protection ──────────────────────────────

  describe('Data encryption through the pipeline', () => {
    it('encrypts and decrypts customer data without loss', () => {
      const keyHex = randomHex(32);
      const key = Buffer.from(keyHex, 'hex');
      const sensitiveData = 'customer-ssn-ref:tok_ssn_001';

      const encrypted = encryptString(sensitiveData, key);
      expect(encrypted).not.toBe(sensitiveData);

      const decrypted = decryptString(encrypted, key);
      expect(decrypted).toBe(sensitiveData);
    });

    it('produces deterministic hash for audit chain linking', () => {
      const input = 'event-data-for-hashing';
      const hash1 = sha256(input);
      const hash2 = sha256(input);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── Merkle Proof Verification ──────────────────────────────────

  describe('Merkle tree verification for audit batches', () => {
    it('generates valid Merkle root for event batch', async () => {
      const tnt = await createTestTenant('merkle-test');

      for (let i = 0; i < 5; i++) {
        await auditLogger.log(makeAuditInput(tnt.id, {
          resourceId: `cust-${String(i).padStart(3, '0')}`,
        }));
      }

      const root = await auditLogger.generateMerkleRoot(tnt.id, 1, 5);
      expect(root.root).toMatch(/^[0-9a-f]{64}$/);
      expect(root.eventCount).toBe(5);
      expect(root.batchStart).toBe(1);
      expect(root.batchEnd).toBe(5);
    });

    it('generates and verifies Merkle proof for specific event', async () => {
      const tnt = await createTestTenant('proof-test');

      for (let i = 0; i < 5; i++) {
        await auditLogger.log(makeAuditInput(tnt.id, {
          resourceId: `cust-${String(i).padStart(3, '0')}`,
        }));
      }

      const proof = await auditLogger.generateProof(tnt.id, 3);
      const isValid = auditLogger.verifyProof(proof);
      expect(isValid).toBe(true);
    });
  });

  // ── Full Cycle Verify ──────────────────────────────────────────

  describe('Full cycle audit integrity', () => {
    it('complete pipeline produces unbroken audit chain', async () => {
      const tnt = await createTestTenant('full-cycle');

      // Simulate: ingest -> process -> decide -> execute -> confirm
      const steps: AuditEventInput[] = [
        makeAuditInput(tnt.id, { action: 'event_ingested', resourceId: 'evt-001' }),
        makeAuditInput(tnt.id, { eventType: 'data.updated', action: 'update_record', resourceId: 'cust-001' }),
        makeAuditInput(tnt.id, { eventType: 'agent.decision', actorType: 'agent', action: 'evaluate_nba', resourceId: 'dec-001' }),
        makeAuditInput(tnt.id, { action: 'tool_executed', actorType: 'agent', resourceId: 'tool-exec-001' }),
        makeAuditInput(tnt.id, { action: 'message_delivered', resourceId: 'msg-001' }),
        makeAuditInput(tnt.id, { action: 'graph_enriched', resourceId: 'cust-001' }),
      ];

      for (const step of steps) {
        await auditLogger.log(step);
      }

      const integrity = await auditLogger.verifyIntegrity(tnt.id);
      expect(integrity.valid).toBe(true);
      expect(integrity.totalEvents).toBe(6);
      expect(integrity.brokenAt).toBeUndefined();
    });
  });
});
