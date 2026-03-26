/**
 * @ordr/audit — Immutable Audit Logger
 *
 * WORM (Write Once Read Many) audit logger with:
 * - SHA-256 hash chain for tamper detection
 * - Merkle tree batch verification
 * - Per-tenant sequence isolation
 * - Mutex for concurrent write safety (no sequence gaps)
 *
 * The `AuditStore` interface decouples storage — implementations live
 * in the database package. This package provides `InMemoryAuditStore`
 * for testing only.
 */

import { randomUUID } from 'node:crypto';
import type {
  AuditEvent,
  AuditChainStatus,
  MerkleRoot,
  MerkleProof,
} from './types.js';
import { computeEventHash, GENESIS_HASH, verifyChain } from './hash-chain.js';
import {
  computeMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof as verifyMerkleProofInternal,
} from './merkle-tree.js';

// ─── AuditStore Interface ────────────────────────────────────────────

/**
 * Storage adapter for audit events.
 *
 * Implementations MUST enforce append-only semantics:
 * - `append` inserts a new event; updates/deletes MUST be rejected.
 * - No method for update or delete exists by design.
 */
export interface AuditStore {
  /** Append a new event. MUST reject if event ID or sequence already exists. */
  append(event: AuditEvent): Promise<void>;

  /** Get a single event by tenant + sequence number. */
  getBySequence(tenantId: string, sequence: number): Promise<AuditEvent | null>;

  /** Get a range of events [fromSequence, toSequence] inclusive, ordered by sequence. */
  getRange(tenantId: string, fromSequence: number, toSequence: number): Promise<AuditEvent[]>;

  /** Get the most recent event for a tenant. */
  getLastEvent(tenantId: string): Promise<AuditEvent | null>;

  /** Store a computed Merkle root for a batch. */
  storeMerkleRoot(root: MerkleRoot): Promise<void>;
}

// ─── Tenant Mutex ────────────────────────────────────────────────────

/**
 * Simple async mutex per tenant key.
 * Prevents concurrent writes from creating sequence gaps or duplicate numbers.
 */
class TenantMutex {
  private readonly locks = new Map<string, Promise<void>>();

  async acquire(tenantId: string): Promise<() => void> {
    // Wait for any existing lock on this tenant
    while (this.locks.has(tenantId)) {
      await this.locks.get(tenantId);
    }

    let releaseFn!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseFn = resolve;
    });

    this.locks.set(tenantId, lockPromise);

    return () => {
      this.locks.delete(tenantId);
      releaseFn();
    };
  }
}

// ─── Input Type ──────────────────────────────────────────────────────

/** Fields the caller provides when logging an audit event. */
export type AuditEventInput = Omit<
  AuditEvent,
  'id' | 'sequenceNumber' | 'previousHash' | 'hash'
>;

// ─── AuditLogger ─────────────────────────────────────────────────────

export class AuditLogger {
  private readonly store: AuditStore;
  private readonly mutex = new TenantMutex();

  /** In-memory sequence counters per tenant, initialized from store on first write. */
  private readonly sequenceCounters = new Map<string, number>();

  constructor(store: AuditStore) {
    this.store = store;
  }

  /**
   * Log an audit event.
   *
   * Atomically:
   * 1. Acquires per-tenant mutex
   * 2. Retrieves last event (or genesis)
   * 3. Assigns next sequence number
   * 4. Computes SHA-256 hash chain link
   * 5. Appends to store
   *
   * @returns The complete, immutable AuditEvent
   */
  async log(input: AuditEventInput): Promise<AuditEvent> {
    const release = await this.mutex.acquire(input.tenantId);

    try {
      // Get previous chain state
      const lastEvent = await this.store.getLastEvent(input.tenantId);
      const previousHash = lastEvent?.hash ?? GENESIS_HASH;
      const nextSequence = (lastEvent?.sequenceNumber ?? 0) + 1;

      // Build the event without its own hash
      const partialEvent: Omit<AuditEvent, 'hash'> = {
        id: randomUUID(),
        sequenceNumber: nextSequence,
        tenantId: input.tenantId,
        eventType: input.eventType,
        actorType: input.actorType,
        actorId: input.actorId,
        resource: input.resource,
        resourceId: input.resourceId,
        action: input.action,
        details: input.details,
        previousHash,
        timestamp: input.timestamp,
      };

      // Compute hash chain link
      const hash = computeEventHash(partialEvent, previousHash);

      const event: AuditEvent = {
        ...partialEvent,
        hash,
      };

      // Append to store (store enforces append-only)
      await this.store.append(event);

      // Update in-memory counter
      this.sequenceCounters.set(input.tenantId, nextSequence);

      return event;
    } finally {
      release();
    }
  }

  /**
   * Get the last audit event for a tenant.
   */
  async getLastEvent(tenantId: string): Promise<AuditEvent | null> {
    return this.store.getLastEvent(tenantId);
  }

  /**
   * Verify the integrity of the audit chain for a tenant.
   *
   * @param tenantId - Tenant to verify
   * @param fromSequence - Start of range (default: 1)
   * @param toSequence - End of range (default: latest)
   * @returns Chain verification status
   */
  async verifyIntegrity(
    tenantId: string,
    fromSequence?: number,
    toSequence?: number,
  ): Promise<AuditChainStatus> {
    const from = fromSequence ?? 1;
    const lastEvent = await this.store.getLastEvent(tenantId);

    if (lastEvent === null) {
      return {
        valid: true,
        totalEvents: 0,
        lastSequence: 0,
        lastHash: GENESIS_HASH,
      };
    }

    const to = toSequence ?? lastEvent.sequenceNumber;
    const events = await this.store.getRange(tenantId, from, to);

    return verifyChain(events);
  }

  /**
   * Generate a Merkle root for a batch of sequential events.
   *
   * @param tenantId - Tenant
   * @param batchStart - First sequence number in batch
   * @param batchEnd - Last sequence number in batch
   * @returns MerkleRoot with root hash and metadata
   */
  async generateMerkleRoot(
    tenantId: string,
    batchStart: number,
    batchEnd: number,
  ): Promise<MerkleRoot> {
    const events = await this.store.getRange(tenantId, batchStart, batchEnd);

    if (events.length === 0) {
      throw new Error(
        `No events found for tenant ${tenantId} in range [${String(batchStart)}, ${String(batchEnd)}]`,
      );
    }

    const root = computeMerkleRoot(events);

    const merkleRoot: MerkleRoot = {
      batchStart,
      batchEnd,
      root,
      timestamp: new Date(),
      eventCount: events.length,
    };

    await this.store.storeMerkleRoot(merkleRoot);

    return merkleRoot;
  }

  /**
   * Generate a Merkle proof that a specific event exists within its batch.
   *
   * @param tenantId - Tenant
   * @param eventSequence - Sequence number of the event to prove
   * @returns MerkleProof for the specified event
   */
  async generateProof(tenantId: string, eventSequence: number): Promise<MerkleProof> {
    // Determine batch boundaries
    const batchStart =
      Math.floor((eventSequence - 1) / 1000) * 1000 + 1;
    const batchEnd = batchStart + 999;

    const events = await this.store.getRange(tenantId, batchStart, batchEnd);

    if (events.length === 0) {
      throw new Error(
        `No events found for tenant ${tenantId} in batch [${String(batchStart)}, ${String(batchEnd)}]`,
      );
    }

    // Find the target event's index within the batch
    const targetIndex = events.findIndex(
      (e) => e.sequenceNumber === eventSequence,
    );

    if (targetIndex === -1) {
      throw new Error(
        `Event sequence ${String(eventSequence)} not found in batch`,
      );
    }

    return generateMerkleProof(events, targetIndex);
  }

  /**
   * Verify a Merkle proof.
   *
   * @param proof - The proof to verify
   * @returns true if the proof is valid
   */
  verifyProof(proof: MerkleProof): boolean {
    return verifyMerkleProofInternal(proof);
  }
}
