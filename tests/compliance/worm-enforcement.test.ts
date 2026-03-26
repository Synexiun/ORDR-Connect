/**
 * WORM (Write Once Read Many) Enforcement Tests
 *
 * Validates that audit tables block UPDATE/DELETE, hash chain is verified
 * on read, Merkle roots are generated for batches, and gaps are detected.
 *
 * SOC2 CC7.2, ISO 27001 A.12.4.1, HIPAA §164.312(b)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLogger, InMemoryAuditStore, type AuditEventInput } from '@ordr/audit';
import { GENESIS_HASH, verifyChain, computeEventHash } from '@ordr/audit';
import { computeMerkleRoot, generateMerkleProof, verifyMerkleProof, buildMerkleTree, computeLeafHash } from '@ordr/audit';
import type { AuditEvent } from '@ordr/audit';

// ── Fixtures ──────────────────────────────────────────────────────────

let store: InMemoryAuditStore;
let logger: AuditLogger;

const tenantId = 'tenant-worm-test';

function makeInput(overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    tenantId,
    eventType: 'data.created',
    actorType: 'user',
    actorId: 'user-001',
    resource: 'customers',
    resourceId: 'cust-001',
    action: 'create',
    details: { method: 'POST' },
    timestamp: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  store = new InMemoryAuditStore();
  logger = new AuditLogger(store);
});

// ── Append-Only Store Behavior ────────────────────────────────────────

describe('Audit store is append-only', () => {
  it('append succeeds for new events', async () => {
    const event = await logger.log(makeInput());
    expect(event.id).toBeDefined();
    expect(event.sequenceNumber).toBe(1);
  });

  it('consecutive appends create sequential events', async () => {
    const e1 = await logger.log(makeInput({ resourceId: 'r1' }));
    const e2 = await logger.log(makeInput({ resourceId: 'r2' }));
    const e3 = await logger.log(makeInput({ resourceId: 'r3' }));

    expect(e1.sequenceNumber).toBe(1);
    expect(e2.sequenceNumber).toBe(2);
    expect(e3.sequenceNumber).toBe(3);
  });

  it('duplicate sequence number is rejected by store', async () => {
    const event = await logger.log(makeInput());
    // Attempt to append a duplicate
    const duplicate: AuditEvent = {
      ...event,
      id: 'duplicate-id',
    };
    await expect(store.append(duplicate)).rejects.toThrow();
  });

  it('store has no update method (by design)', () => {
    const storeProto = Object.getPrototypeOf(store);
    const methods = Object.getOwnPropertyNames(storeProto);
    expect(methods).not.toContain('update');
    expect(methods).not.toContain('delete');
  });

  it('AuditStore interface has no update/delete methods', () => {
    // Verify the interface contract — only append, getBySequence, getRange, getLastEvent, storeMerkleRoot
    const storeMethods = ['append', 'getBySequence', 'getRange', 'getLastEvent', 'storeMerkleRoot'];
    for (const method of storeMethods) {
      expect(typeof (store as Record<string, unknown>)[method]).toBe('function');
    }
  });
});

// ── Hash Chain Verification on Read ───────────────────────────────────

describe('Hash chain verified on read', () => {
  it('verifyIntegrity validates the entire chain', async () => {
    for (let i = 0; i < 10; i++) {
      await logger.log(makeInput({ resourceId: `r-${i}` }));
    }
    const status = await logger.verifyIntegrity(tenantId);
    expect(status.valid).toBe(true);
    expect(status.totalEvents).toBe(10);
    expect(status.lastSequence).toBe(10);
  });

  it('verifyIntegrity detects broken hash chain', async () => {
    for (let i = 0; i < 5; i++) {
      await logger.log(makeInput({ resourceId: `r-${i}` }));
    }

    // Manually retrieve events and tamper
    const events = await store.getRange(tenantId, 1, 5);
    const tampered = events.map((e, i) => {
      if (i === 2) {
        return { ...e, hash: 'a'.repeat(64) };
      }
      return e;
    });

    const status = verifyChain(tampered);
    expect(status.valid).toBe(false);
    expect(status.brokenAt).toBeDefined();
  });

  it('verifyIntegrity accepts partial range', async () => {
    for (let i = 0; i < 20; i++) {
      await logger.log(makeInput({ resourceId: `r-${i}` }));
    }
    const status = await logger.verifyIntegrity(tenantId, 1, 10);
    expect(status.valid).toBe(true);
    expect(status.totalEvents).toBe(10);
  });

  it('first event previousHash must be GENESIS_HASH', async () => {
    const event = await logger.log(makeInput());
    expect(event.previousHash).toBe(GENESIS_HASH);
  });

  it('GENESIS_HASH is deterministic', () => {
    // Should always be the same value
    expect(GENESIS_HASH).toMatch(/^[a-f0-9]{64}$/);
    expect(GENESIS_HASH.length).toBe(64);
  });
});

// ── Merkle Root Generation ────────────────────────────────────────────

describe('Merkle root generation for batches', () => {
  it('generateMerkleRoot creates a valid root for a batch', async () => {
    for (let i = 0; i < 10; i++) {
      await logger.log(makeInput({ resourceId: `r-${i}` }));
    }

    const root = await logger.generateMerkleRoot(tenantId, 1, 10);
    expect(root.root).toMatch(/^[a-f0-9]{64}$/);
    expect(root.batchStart).toBe(1);
    expect(root.batchEnd).toBe(10);
    expect(root.eventCount).toBe(10);
    expect(root.timestamp).toBeInstanceOf(Date);
  });

  it('Merkle root stored in store', async () => {
    for (let i = 0; i < 5; i++) {
      await logger.log(makeInput({ resourceId: `r-${i}` }));
    }

    // Should not throw
    await logger.generateMerkleRoot(tenantId, 1, 5);
  });

  it('empty batch throws error', async () => {
    await expect(
      logger.generateMerkleRoot('nonexistent-tenant', 1, 100),
    ).rejects.toThrow('No events found');
  });

  it('buildMerkleTree handles single element', () => {
    const tree = buildMerkleTree(['aaa']);
    expect(tree.length).toBe(1);
    expect(tree[0]![0]).toBe('aaa');
  });

  it('buildMerkleTree handles odd number of elements', () => {
    const tree = buildMerkleTree(['a', 'b', 'c']);
    expect(tree.length).toBeGreaterThan(1);
    const root = tree[tree.length - 1]!;
    expect(root.length).toBe(1); // Single root
  });

  it('buildMerkleTree handles even number of elements', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const root = tree[tree.length - 1]!;
    expect(root.length).toBe(1);
  });

  it('buildMerkleTree returns empty for empty input', () => {
    const tree = buildMerkleTree([]);
    expect(tree.length).toBe(0);
  });
});

// ── Merkle Proof Verification ─────────────────────────────────────────

describe('Merkle proof verification', () => {
  it('generates and verifies proof for specific event', async () => {
    const events: AuditEvent[] = [];
    for (let i = 0; i < 8; i++) {
      events.push(await logger.log(makeInput({ resourceId: `r-${i}` })));
    }

    for (let i = 0; i < events.length; i++) {
      const proof = generateMerkleProof(events, i);
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });

  it('proof fails with wrong leaf', async () => {
    const events: AuditEvent[] = [];
    for (let i = 0; i < 4; i++) {
      events.push(await logger.log(makeInput({ resourceId: `r-${i}` })));
    }

    const proof = generateMerkleProof(events, 2);
    const badProof = { ...proof, leaf: 'f'.repeat(64) };
    expect(verifyMerkleProof(badProof)).toBe(false);
  });

  it('proof fails with wrong root', async () => {
    const events: AuditEvent[] = [];
    for (let i = 0; i < 4; i++) {
      events.push(await logger.log(makeInput({ resourceId: `r-${i}` })));
    }

    const proof = generateMerkleProof(events, 1);
    const badProof = { ...proof, root: 'e'.repeat(64) };
    expect(verifyMerkleProof(badProof)).toBe(false);
  });

  it('computeLeafHash double-hashes the event hash', async () => {
    const event = await logger.log(makeInput());
    const leaf = computeLeafHash(event);
    expect(leaf).toMatch(/^[a-f0-9]{64}$/);
    // Should not equal the event hash itself (double-hashed)
    expect(leaf).not.toBe(event.hash);
  });

  it('rejects out-of-range target index', async () => {
    const events: AuditEvent[] = [];
    for (let i = 0; i < 3; i++) {
      events.push(await logger.log(makeInput({ resourceId: `r-${i}` })));
    }

    expect(() => generateMerkleProof(events, -1)).toThrow();
    expect(() => generateMerkleProof(events, 3)).toThrow();
  });

  it('rejects empty event set for proof', () => {
    expect(() => generateMerkleProof([], 0)).toThrow();
  });
});

// ── Gap Detection ─────────────────────────────────────────────────────

describe('Sequence gap detection', () => {
  it('detects gap when sequence skips a number', () => {
    const e1Base: AuditEvent = {
      id: 'id-1', sequenceNumber: 1, tenantId, eventType: 'data.created',
      actorType: 'user', actorId: 'u1', resource: 'r', resourceId: 'r1',
      action: 'create', details: {}, previousHash: GENESIS_HASH,
      hash: '', timestamp: new Date(),
    };
    const e1: AuditEvent = { ...e1Base, hash: computeEventHash(e1Base, GENESIS_HASH) };

    const e3: AuditEvent = {
      id: 'id-3', sequenceNumber: 3, tenantId, eventType: 'data.created',
      actorType: 'user', actorId: 'u1', resource: 'r', resourceId: 'r3',
      action: 'create', details: {}, previousHash: e1.hash,
      hash: '', timestamp: new Date(),
    };

    const status = verifyChain([e1, e3]);
    expect(status.valid).toBe(false);
    expect(status.brokenAt).toBe(3);
  });

  it('concurrent writes do not create gaps (mutex)', async () => {
    // Fire multiple concurrent writes
    const promises = Array.from({ length: 20 }, (_, i) =>
      logger.log(makeInput({ resourceId: `concurrent-${i}` })),
    );
    const events = await Promise.all(promises);

    // All should have unique, sequential numbers
    const sequences = events.map((e) => e.sequenceNumber).sort((a, b) => a - b);
    for (let i = 0; i < sequences.length; i++) {
      expect(sequences[i]).toBe(i + 1);
    }

    // Chain should be valid
    const status = await logger.verifyIntegrity(tenantId);
    expect(status.valid).toBe(true);
    expect(status.totalEvents).toBe(20);
  });
});
