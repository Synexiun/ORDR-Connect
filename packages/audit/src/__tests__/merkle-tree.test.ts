import { describe, it, expect } from 'vitest';
import type { AuditEvent, MerkleProof } from '../types.js';
import { GENESIS_HASH, computeEventHash } from '../hash-chain.js';
import {
  computeLeafHash,
  buildMerkleTree,
  computeMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
} from '../merkle-tree.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function buildValidChain(count: number): AuditEvent[] {
  const events: AuditEvent[] = [];
  let previousHash = GENESIS_HASH;

  for (let i = 1; i <= count; i++) {
    const partial: Omit<AuditEvent, 'hash'> = {
      id: `evt-${String(i)}`,
      sequenceNumber: i,
      tenantId: 'tenant-1',
      eventType: 'data.created',
      actorType: 'user',
      actorId: 'user-1',
      resource: 'record',
      resourceId: `rec-${String(i)}`,
      action: 'create',
      details: { index: i },
      previousHash,
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
    };

    const hash = computeEventHash(partial, previousHash);
    events.push({ ...partial, hash });
    previousHash = hash;
  }

  return events;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('computeLeafHash', () => {
  it('produces a deterministic 64-char hex hash', () => {
    const events = buildValidChain(1);
    const leaf1 = computeLeafHash(events[0]!);
    const leaf2 = computeLeafHash(events[0]!);

    expect(leaf1).toBe(leaf2);
    expect(leaf1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different events', () => {
    const events = buildValidChain(2);
    const leaf1 = computeLeafHash(events[0]!);
    const leaf2 = computeLeafHash(events[1]!);

    expect(leaf1).not.toBe(leaf2);
  });
});

describe('buildMerkleTree', () => {
  it('returns empty array for no leaves', () => {
    const tree = buildMerkleTree([]);
    expect(tree).toEqual([]);
  });

  it('single leaf tree has one level with one entry', () => {
    const events = buildValidChain(1);
    const leaves = events.map((e) => computeLeafHash(e));
    const tree = buildMerkleTree(leaves);

    // Single leaf: [leaves] => root is the leaf itself
    expect(tree.length).toBe(1);
    expect(tree[0]!.length).toBe(1);
  });

  it('pads odd number of leaves by duplicating the last leaf', () => {
    const events = buildValidChain(3);
    const leaves = events.map((e) => computeLeafHash(e));
    const tree = buildMerkleTree(leaves);

    // Level 0: 3 leaves
    // Level 1: 2 nodes (3 padded to 4, then paired -> 2)
    // Level 2: 1 root
    expect(tree[0]!.length).toBe(3);
    expect(tree[1]!.length).toBe(2);
    expect(tree[2]!.length).toBe(1);
  });

  it('even number of leaves needs no padding', () => {
    const events = buildValidChain(4);
    const leaves = events.map((e) => computeLeafHash(e));
    const tree = buildMerkleTree(leaves);

    expect(tree[0]!.length).toBe(4);
    expect(tree[1]!.length).toBe(2);
    expect(tree[2]!.length).toBe(1);
  });

  it('root is always a single hash', () => {
    for (const count of [1, 2, 3, 5, 8, 16]) {
      const events = buildValidChain(count);
      const leaves = events.map((e) => computeLeafHash(e));
      const tree = buildMerkleTree(leaves);
      const topLevel = tree[tree.length - 1]!;

      expect(topLevel.length).toBe(1);
    }
  });
});

describe('computeMerkleRoot', () => {
  it('is deterministic for the same events', () => {
    const events = buildValidChain(5);
    const root1 = computeMerkleRoot(events);
    const root2 = computeMerkleRoot(events);

    expect(root1).toBe(root2);
    expect(root1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any event differs', () => {
    const events1 = buildValidChain(5);
    const events2 = buildValidChain(6); // Different chain

    const root1 = computeMerkleRoot(events1);
    const root2 = computeMerkleRoot(events2);

    expect(root1).not.toBe(root2);
  });

  it('handles empty events', () => {
    const root = computeMerkleRoot([]);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('generateMerkleProof', () => {
  it('throws for empty event set', () => {
    expect(() => generateMerkleProof([], 0)).toThrow('Cannot generate proof for empty event set');
  });

  it('throws for out-of-range index', () => {
    const events = buildValidChain(3);
    expect(() => generateMerkleProof(events, -1)).toThrow('out of range');
    expect(() => generateMerkleProof(events, 3)).toThrow('out of range');
  });

  it('generates valid proof for every event in a batch', () => {
    const events = buildValidChain(8);

    for (let i = 0; i < events.length; i++) {
      const proof = generateMerkleProof(events, i);

      expect(proof.leaf).toBe(computeLeafHash(events[i]!));
      expect(proof.root).toBe(computeMerkleRoot(events));
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });

  it('generates valid proof for single-event batch', () => {
    const events = buildValidChain(1);
    const proof = generateMerkleProof(events, 0);

    expect(proof.proof.length).toBe(0); // No siblings needed
    expect(proof.leaf).toBe(proof.root); // Leaf IS the root
    expect(verifyMerkleProof(proof)).toBe(true);
  });

  it('generates valid proof for odd-count batch', () => {
    const events = buildValidChain(7);

    for (let i = 0; i < events.length; i++) {
      const proof = generateMerkleProof(events, i);
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });
});

describe('verifyMerkleProof', () => {
  it('fails for a tampered event (wrong leaf)', () => {
    const events = buildValidChain(8);
    const proof = generateMerkleProof(events, 3);

    // Tamper: replace the leaf with a different hash
    const tampered: MerkleProof = {
      ...proof,
      leaf: 'a'.repeat(64),
    };

    expect(verifyMerkleProof(tampered)).toBe(false);
  });

  it('fails with wrong root', () => {
    const events = buildValidChain(8);
    const proof = generateMerkleProof(events, 3);

    const tampered: MerkleProof = {
      ...proof,
      root: 'b'.repeat(64),
    };

    expect(verifyMerkleProof(tampered)).toBe(false);
  });

  it('fails with tampered proof step', () => {
    const events = buildValidChain(8);
    const proof = generateMerkleProof(events, 3);

    // Tamper with a step in the proof path
    const tamperedSteps = [...proof.proof];
    tamperedSteps[0] = { hash: 'c'.repeat(64), position: tamperedSteps[0]!.position };

    const tampered: MerkleProof = {
      ...proof,
      proof: tamperedSteps,
    };

    expect(verifyMerkleProof(tampered)).toBe(false);
  });

  it('tree with 1000 events computes and verifies correctly', () => {
    const events = buildValidChain(1000);

    const root = computeMerkleRoot(events);
    expect(root).toMatch(/^[0-9a-f]{64}$/);

    // Verify proof for first, middle, and last event
    for (const idx of [0, 499, 999]) {
      const proof = generateMerkleProof(events, idx);
      expect(proof.root).toBe(root);
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });
});
