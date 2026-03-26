import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import type { AuditEvent } from '../types.js';
import {
  GENESIS_HASH,
  computeEventHash,
  verifyChainLink,
  verifyChain,
} from '../hash-chain.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<AuditEvent> & { sequenceNumber: number }): AuditEvent {
  return {
    id: overrides.id ?? `evt-${String(overrides.sequenceNumber)}`,
    sequenceNumber: overrides.sequenceNumber,
    tenantId: overrides.tenantId ?? 'tenant-1',
    eventType: overrides.eventType ?? 'data.created',
    actorType: overrides.actorType ?? 'user',
    actorId: overrides.actorId ?? 'user-1',
    resource: overrides.resource ?? 'record',
    resourceId: overrides.resourceId ?? 'rec-1',
    action: overrides.action ?? 'create',
    details: overrides.details ?? { field: 'value' },
    previousHash: overrides.previousHash ?? GENESIS_HASH,
    hash: overrides.hash ?? '',
    timestamp: overrides.timestamp ?? new Date('2026-01-01T00:00:00.000Z'),
  };
}

/** Build a valid chain of N events. */
function buildValidChain(count: number): AuditEvent[] {
  const events: AuditEvent[] = [];
  let previousHash = GENESIS_HASH;

  for (let i = 1; i <= count; i++) {
    const partial = makeEvent({
      sequenceNumber: i,
      id: `evt-${String(i)}`,
      previousHash,
      details: { index: i },
    });

    const hash = computeEventHash(partial, previousHash);
    const event: AuditEvent = { ...partial, hash };
    events.push(event);
    previousHash = hash;
  }

  return events;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('GENESIS_HASH', () => {
  it('is deterministic — SHA-256 of the genesis string', () => {
    const expected = createHash('sha256')
      .update('ORDR-CONNECT-GENESIS-BLOCK-v1')
      .digest('hex');

    expect(GENESIS_HASH).toBe(expected);
  });

  it('is a 64-character hex string', () => {
    expect(GENESIS_HASH).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeEventHash', () => {
  it('includes all fields in the hash', () => {
    const event = makeEvent({ sequenceNumber: 1 });
    const hash = computeEventHash(event, GENESIS_HASH);

    // Changing any field must produce a different hash
    const differentTenant = makeEvent({ sequenceNumber: 1, tenantId: 'tenant-2' });
    const differentActor = makeEvent({ sequenceNumber: 1, actorId: 'user-2' });
    const differentResource = makeEvent({ sequenceNumber: 1, resource: 'other' });
    const differentAction = makeEvent({ sequenceNumber: 1, action: 'update' });
    const differentType = makeEvent({ sequenceNumber: 1, eventType: 'data.updated' });
    const differentResourceId = makeEvent({ sequenceNumber: 1, resourceId: 'rec-2' });
    const differentTimestamp = makeEvent({
      sequenceNumber: 1,
      timestamp: new Date('2026-06-01T00:00:00.000Z'),
    });
    const differentDetails = makeEvent({
      sequenceNumber: 1,
      details: { field: 'other' },
    });

    expect(computeEventHash(differentTenant, GENESIS_HASH)).not.toBe(hash);
    expect(computeEventHash(differentActor, GENESIS_HASH)).not.toBe(hash);
    expect(computeEventHash(differentResource, GENESIS_HASH)).not.toBe(hash);
    expect(computeEventHash(differentAction, GENESIS_HASH)).not.toBe(hash);
    expect(computeEventHash(differentType, GENESIS_HASH)).not.toBe(hash);
    expect(computeEventHash(differentResourceId, GENESIS_HASH)).not.toBe(hash);
    expect(computeEventHash(differentTimestamp, GENESIS_HASH)).not.toBe(hash);
    expect(computeEventHash(differentDetails, GENESIS_HASH)).not.toBe(hash);
  });

  it('produces deterministic output for identical inputs', () => {
    const event = makeEvent({ sequenceNumber: 1 });
    const hash1 = computeEventHash(event, GENESIS_HASH);
    const hash2 = computeEventHash(event, GENESIS_HASH);

    expect(hash1).toBe(hash2);
  });

  it('sorts details keys for deterministic hashing', () => {
    const event1 = makeEvent({
      sequenceNumber: 1,
      details: { alpha: 1, beta: 2, gamma: 3 },
    });
    const event2 = makeEvent({
      sequenceNumber: 1,
      details: { gamma: 3, alpha: 1, beta: 2 },
    });

    const hash1 = computeEventHash(event1, GENESIS_HASH);
    const hash2 = computeEventHash(event2, GENESIS_HASH);

    expect(hash1).toBe(hash2);
  });

  it('returns a 64-character hex string', () => {
    const event = makeEvent({ sequenceNumber: 1 });
    const hash = computeEventHash(event, GENESIS_HASH);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifyChainLink', () => {
  it('returns true for a correctly hashed event', () => {
    const partial = makeEvent({ sequenceNumber: 1 });
    const hash = computeEventHash(partial, GENESIS_HASH);
    const event: AuditEvent = { ...partial, hash };

    expect(verifyChainLink(event, GENESIS_HASH)).toBe(true);
  });

  it('returns false for a tampered hash', () => {
    const partial = makeEvent({ sequenceNumber: 1 });
    const event: AuditEvent = {
      ...partial,
      hash: 'a'.repeat(64), // fake hash
    };

    expect(verifyChainLink(event, GENESIS_HASH)).toBe(false);
  });

  it('returns false when previousHash is wrong', () => {
    const partial = makeEvent({ sequenceNumber: 1 });
    const hash = computeEventHash(partial, GENESIS_HASH);
    const event: AuditEvent = { ...partial, hash };

    // Verify against a different previousHash
    expect(verifyChainLink(event, 'b'.repeat(64))).toBe(false);
  });
});

describe('verifyChain', () => {
  it('returns valid for an empty chain', () => {
    const status = verifyChain([]);

    expect(status.valid).toBe(true);
    expect(status.totalEvents).toBe(0);
    expect(status.lastSequence).toBe(0);
    expect(status.lastHash).toBe(GENESIS_HASH);
    expect(status.brokenAt).toBeUndefined();
  });

  it('returns valid for a single-event chain', () => {
    const chain = buildValidChain(1);
    const status = verifyChain(chain);

    expect(status.valid).toBe(true);
    expect(status.totalEvents).toBe(1);
    expect(status.lastSequence).toBe(1);
    expect(status.brokenAt).toBeUndefined();
  });

  it('returns valid for a multi-event chain', () => {
    const chain = buildValidChain(10);
    const status = verifyChain(chain);

    expect(status.valid).toBe(true);
    expect(status.totalEvents).toBe(10);
    expect(status.lastSequence).toBe(10);
    expect(status.brokenAt).toBeUndefined();
  });

  it('detects a tampered event (modified details)', () => {
    const chain = buildValidChain(5);

    // Tamper with event at index 2 (sequence 3)
    const tampered: AuditEvent = {
      ...chain[2]!,
      details: { index: 999, injected: 'malicious' },
    };
    chain[2] = tampered;

    const status = verifyChain(chain);

    expect(status.valid).toBe(false);
    expect(status.brokenAt).toBe(3);
  });

  it('detects a tampered hash', () => {
    const chain = buildValidChain(5);

    // Replace hash on event 2
    const tampered: AuditEvent = {
      ...chain[1]!,
      hash: 'f'.repeat(64),
    };
    chain[1] = tampered;

    const status = verifyChain(chain);

    expect(status.valid).toBe(false);
    expect(status.brokenAt).toBe(2);
  });

  it('detects a deleted event (gap in sequence)', () => {
    const chain = buildValidChain(5);

    // Remove event at index 2 (sequence 3), leaving a gap: 1,2,4,5
    chain.splice(2, 1);

    const status = verifyChain(chain);

    expect(status.valid).toBe(false);
    // Event at index 2 now has sequence 4, but expected 3
    expect(status.brokenAt).toBe(4);
  });

  it('detects reordered events', () => {
    const chain = buildValidChain(5);

    // Swap events at index 1 and 2
    const temp = chain[1]!;
    chain[1] = chain[2]!;
    chain[2] = temp;

    const status = verifyChain(chain);

    expect(status.valid).toBe(false);
  });

  it('correctly reports lastHash on valid chain', () => {
    const chain = buildValidChain(3);
    const status = verifyChain(chain);

    expect(status.lastHash).toBe(chain[2]!.hash);
  });
});
