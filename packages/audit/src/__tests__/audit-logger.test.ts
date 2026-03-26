import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLogger } from '../audit-logger.js';
import type { AuditEventInput } from '../audit-logger.js';
import { InMemoryAuditStore } from '../in-memory-store.js';
import { GENESIS_HASH, verifyChainLink, verifyChain } from '../hash-chain.js';
import { computeLeafHash, verifyMerkleProof } from '../merkle-tree.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeInput(overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    tenantId: overrides?.tenantId ?? 'tenant-1',
    eventType: overrides?.eventType ?? 'data.created',
    actorType: overrides?.actorType ?? 'user',
    actorId: overrides?.actorId ?? 'user-1',
    resource: overrides?.resource ?? 'record',
    resourceId: overrides?.resourceId ?? 'rec-1',
    action: overrides?.action ?? 'create',
    details: overrides?.details ?? { key: 'value' },
    timestamp: overrides?.timestamp ?? new Date('2026-01-01T00:00:00.000Z'),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('AuditLogger', () => {
  let store: InMemoryAuditStore;
  let logger: AuditLogger;

  beforeEach(() => {
    store = new InMemoryAuditStore();
    logger = new AuditLogger(store);
  });

  describe('log()', () => {
    it('creates an event with correct hash chain from genesis', async () => {
      const event = await logger.log(makeInput());

      expect(event.sequenceNumber).toBe(1);
      expect(event.previousHash).toBe(GENESIS_HASH);
      expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(event.id).toBeTruthy();

      // Verify the hash is correct
      expect(verifyChainLink(event, GENESIS_HASH)).toBe(true);
    });

    it('assigns monotonically increasing sequence numbers', async () => {
      const e1 = await logger.log(makeInput());
      const e2 = await logger.log(makeInput({ resourceId: 'rec-2' }));
      const e3 = await logger.log(makeInput({ resourceId: 'rec-3' }));

      expect(e1.sequenceNumber).toBe(1);
      expect(e2.sequenceNumber).toBe(2);
      expect(e3.sequenceNumber).toBe(3);
    });

    it('chains hashes correctly across sequential events', async () => {
      const e1 = await logger.log(makeInput());
      const e2 = await logger.log(makeInput({ resourceId: 'rec-2' }));
      const e3 = await logger.log(makeInput({ resourceId: 'rec-3' }));

      expect(e1.previousHash).toBe(GENESIS_HASH);
      expect(e2.previousHash).toBe(e1.hash);
      expect(e3.previousHash).toBe(e2.hash);

      expect(verifyChainLink(e1, GENESIS_HASH)).toBe(true);
      expect(verifyChainLink(e2, e1.hash)).toBe(true);
      expect(verifyChainLink(e3, e2.hash)).toBe(true);
    });

    it('preserves all input fields on the stored event', async () => {
      const input = makeInput({
        tenantId: 'tenant-x',
        eventType: 'auth.login',
        actorType: 'agent',
        actorId: 'agent-007',
        resource: 'session',
        resourceId: 'sess-42',
        action: 'login',
        details: { ip: '10.0.0.1', userAgent: 'test' },
        timestamp: new Date('2026-06-15T12:00:00.000Z'),
      });

      const event = await logger.log(input);

      expect(event.tenantId).toBe('tenant-x');
      expect(event.eventType).toBe('auth.login');
      expect(event.actorType).toBe('agent');
      expect(event.actorId).toBe('agent-007');
      expect(event.resource).toBe('session');
      expect(event.resourceId).toBe('sess-42');
      expect(event.action).toBe('login');
      expect(event.details).toEqual({ ip: '10.0.0.1', userAgent: 'test' });
      expect(event.timestamp).toEqual(new Date('2026-06-15T12:00:00.000Z'));
    });
  });

  describe('multi-tenant isolation', () => {
    it('maintains independent chains per tenant', async () => {
      const t1e1 = await logger.log(makeInput({ tenantId: 'tenant-1' }));
      const t2e1 = await logger.log(makeInput({ tenantId: 'tenant-2' }));
      const t1e2 = await logger.log(makeInput({ tenantId: 'tenant-1', resourceId: 'rec-2' }));
      const t2e2 = await logger.log(makeInput({ tenantId: 'tenant-2', resourceId: 'rec-2' }));

      // Independent sequence numbers
      expect(t1e1.sequenceNumber).toBe(1);
      expect(t2e1.sequenceNumber).toBe(1);
      expect(t1e2.sequenceNumber).toBe(2);
      expect(t2e2.sequenceNumber).toBe(2);

      // Independent hash chains
      expect(t1e1.previousHash).toBe(GENESIS_HASH);
      expect(t2e1.previousHash).toBe(GENESIS_HASH);
      expect(t1e2.previousHash).toBe(t1e1.hash);
      expect(t2e2.previousHash).toBe(t2e1.hash);

      // Chains don't cross
      expect(t1e1.hash).not.toBe(t2e1.hash);
    });
  });

  describe('verifyIntegrity()', () => {
    it('returns valid for untampered chain', async () => {
      for (let i = 0; i < 5; i++) {
        await logger.log(makeInput({ resourceId: `rec-${String(i)}` }));
      }

      const status = await logger.verifyIntegrity('tenant-1');

      expect(status.valid).toBe(true);
      expect(status.totalEvents).toBe(5);
      expect(status.lastSequence).toBe(5);
      expect(status.brokenAt).toBeUndefined();
    });

    it('returns valid for empty tenant', async () => {
      const status = await logger.verifyIntegrity('nonexistent-tenant');

      expect(status.valid).toBe(true);
      expect(status.totalEvents).toBe(0);
    });

    it('verifies a sub-range of the chain', async () => {
      for (let i = 0; i < 10; i++) {
        await logger.log(makeInput({ resourceId: `rec-${String(i)}` }));
      }

      // Verify only events 1-5
      const status = await logger.verifyIntegrity('tenant-1', 1, 5);

      expect(status.valid).toBe(true);
      expect(status.totalEvents).toBe(5);
      expect(status.lastSequence).toBe(5);
    });
  });

  describe('getLastEvent()', () => {
    it('returns null for empty tenant', async () => {
      const last = await logger.getLastEvent('nonexistent');
      expect(last).toBeNull();
    });

    it('returns the most recent event', async () => {
      await logger.log(makeInput({ resourceId: 'rec-1' }));
      const e2 = await logger.log(makeInput({ resourceId: 'rec-2' }));

      const last = await logger.getLastEvent('tenant-1');
      expect(last?.id).toBe(e2.id);
      expect(last?.sequenceNumber).toBe(2);
    });
  });

  describe('concurrent writes', () => {
    it('maintains sequence integrity under concurrent writes', async () => {
      // Fire 20 concurrent writes to the same tenant
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 20; i++) {
        promises.push(logger.log(makeInput({ resourceId: `rec-${String(i)}` })));
      }

      await Promise.all(promises);

      // Verify no gaps in sequence
      const events = store.getAllEvents('tenant-1');
      const sequences = events.map((e) => e.sequenceNumber).sort((a, b) => a - b);

      expect(sequences.length).toBe(20);
      for (let i = 0; i < sequences.length; i++) {
        expect(sequences[i]).toBe(i + 1);
      }

      // Verify full chain integrity
      const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      const status = verifyChain(sorted);
      expect(status.valid).toBe(true);
      expect(status.totalEvents).toBe(20);
    });
  });

  describe('Merkle root generation', () => {
    it('generates a Merkle root for a batch of events', async () => {
      for (let i = 0; i < 10; i++) {
        await logger.log(makeInput({ resourceId: `rec-${String(i)}` }));
      }

      const merkleRoot = await logger.generateMerkleRoot('tenant-1', 1, 10);

      expect(merkleRoot.batchStart).toBe(1);
      expect(merkleRoot.batchEnd).toBe(10);
      expect(merkleRoot.eventCount).toBe(10);
      expect(merkleRoot.root).toMatch(/^[0-9a-f]{64}$/);
      expect(merkleRoot.timestamp).toBeInstanceOf(Date);
    });

    it('stores the Merkle root', async () => {
      for (let i = 0; i < 5; i++) {
        await logger.log(makeInput({ resourceId: `rec-${String(i)}` }));
      }

      await logger.generateMerkleRoot('tenant-1', 1, 5);

      const roots = store.getAllMerkleRoots();
      expect(roots.length).toBe(1);
      expect(roots[0]!.eventCount).toBe(5);
    });

    it('throws for empty range', async () => {
      await expect(
        logger.generateMerkleRoot('tenant-1', 1, 10),
      ).rejects.toThrow('No events found');
    });

    it('is deterministic for the same events', async () => {
      for (let i = 0; i < 5; i++) {
        await logger.log(makeInput({ resourceId: `rec-${String(i)}` }));
      }

      const root1 = await logger.generateMerkleRoot('tenant-1', 1, 5);
      const root2 = await logger.generateMerkleRoot('tenant-1', 1, 5);

      expect(root1.root).toBe(root2.root);
    });
  });

  describe('Merkle proof generation and verification', () => {
    it('generates and verifies a proof for a specific event', async () => {
      for (let i = 0; i < 10; i++) {
        await logger.log(makeInput({ resourceId: `rec-${String(i)}` }));
      }

      const proof = await logger.generateProof('tenant-1', 5);

      expect(proof.leaf).toMatch(/^[0-9a-f]{64}$/);
      expect(proof.root).toMatch(/^[0-9a-f]{64}$/);
      expect(proof.proof.length).toBeGreaterThan(0);

      // Verify the proof
      expect(logger.verifyProof(proof)).toBe(true);
    });

    it('proof roundtrip: generate then verify for each event', async () => {
      for (let i = 0; i < 8; i++) {
        await logger.log(makeInput({ resourceId: `rec-${String(i)}` }));
      }

      for (let seq = 1; seq <= 8; seq++) {
        const proof = await logger.generateProof('tenant-1', seq);
        expect(logger.verifyProof(proof)).toBe(true);

        // Verify the leaf corresponds to the right event
        const event = await store.getBySequence('tenant-1', seq);
        expect(proof.leaf).toBe(computeLeafHash(event!));
      }
    });

    it('proof fails after tampering', async () => {
      for (let i = 0; i < 8; i++) {
        await logger.log(makeInput({ resourceId: `rec-${String(i)}` }));
      }

      const proof = await logger.generateProof('tenant-1', 3);

      // Tamper with the leaf
      const tampered = { ...proof, leaf: 'f'.repeat(64) };
      expect(logger.verifyProof(tampered)).toBe(false);
    });

    it('throws for nonexistent event sequence', async () => {
      for (let i = 0; i < 5; i++) {
        await logger.log(makeInput({ resourceId: `rec-${String(i)}` }));
      }

      await expect(logger.generateProof('tenant-1', 999)).rejects.toThrow(
        'not found in batch',
      );
    });
  });
});

describe('InMemoryAuditStore — WORM enforcement', () => {
  let store: InMemoryAuditStore;

  beforeEach(() => {
    store = new InMemoryAuditStore();
  });

  it('rejects duplicate event IDs', async () => {
    const logger = new AuditLogger(store);
    const event = await logger.log(makeInput());

    // Attempt to re-append the same event
    await expect(store.append(event)).rejects.toThrow('WORM violation');
  });

  it('rejects duplicate sequence numbers', async () => {
    const logger = new AuditLogger(store);
    const event = await logger.log(makeInput());

    // Build a fake event with same sequence but different ID
    const fake = { ...event, id: 'fake-id' };
    await expect(store.append(fake)).rejects.toThrow('WORM violation');
  });
});
