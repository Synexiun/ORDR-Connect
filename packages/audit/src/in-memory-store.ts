/**
 * @ordr/audit — In-Memory Audit Store
 *
 * Testing-only implementation of AuditStore.
 * Enforces WORM (Write Once Read Many) semantics:
 * - Append-only: no updates, no deletes
 * - Rejects duplicate event IDs and sequence numbers
 */

import type { AuditEvent, MerkleRoot } from './types.js';
import type { AuditStore } from './audit-logger.js';

export class InMemoryAuditStore implements AuditStore {
  /** tenant -> ordered events */
  private readonly events = new Map<string, AuditEvent[]>();

  /** All stored Merkle roots */
  private readonly merkleRoots: MerkleRoot[] = [];

  /** Global event ID index for duplicate detection */
  private readonly eventIds = new Set<string>();

  /**
   * Append a new event. Rejects if:
   * - Event ID already exists (duplicate)
   * - Sequence number already exists for this tenant (gap/collision)
   */
  async append(event: AuditEvent): Promise<void> {
    // Reject duplicate event IDs
    if (this.eventIds.has(event.id)) {
      throw new Error(`WORM violation: event ${event.id} already exists — updates are forbidden`);
    }

    const tenantEvents = this.events.get(event.tenantId) ?? [];

    // Reject duplicate sequence numbers within tenant
    const existingSequence = tenantEvents.find(
      (e) => e.sequenceNumber === event.sequenceNumber,
    );
    if (existingSequence !== undefined) {
      throw new Error(
        `WORM violation: sequence ${String(event.sequenceNumber)} already exists for tenant ${event.tenantId}`,
      );
    }

    // Store (freeze the event to prevent post-write mutation)
    tenantEvents.push(Object.freeze({ ...event }));
    this.events.set(event.tenantId, tenantEvents);
    this.eventIds.add(event.id);
  }

  async getBySequence(tenantId: string, sequence: number): Promise<AuditEvent | null> {
    const tenantEvents = this.events.get(tenantId);
    if (tenantEvents === undefined) return null;

    return tenantEvents.find((e) => e.sequenceNumber === sequence) ?? null;
  }

  async getRange(
    tenantId: string,
    fromSequence: number,
    toSequence: number,
  ): Promise<AuditEvent[]> {
    const tenantEvents = this.events.get(tenantId);
    if (tenantEvents === undefined) return [];

    return tenantEvents
      .filter((e) => e.sequenceNumber >= fromSequence && e.sequenceNumber <= toSequence)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  async getLastEvent(tenantId: string): Promise<AuditEvent | null> {
    const tenantEvents = this.events.get(tenantId);
    if (tenantEvents === undefined || tenantEvents.length === 0) return null;

    // Return the event with the highest sequence number
    let last = tenantEvents[0]!;
    for (const event of tenantEvents) {
      if (event.sequenceNumber > last.sequenceNumber) {
        last = event;
      }
    }
    return last;
  }

  async storeMerkleRoot(root: MerkleRoot): Promise<void> {
    this.merkleRoots.push(Object.freeze({ ...root }));
  }

  // ─── Test Helpers (not part of AuditStore interface) ──────────────

  /** Get all events for a tenant (test inspection). */
  getAllEvents(tenantId: string): ReadonlyArray<AuditEvent> {
    return this.events.get(tenantId) ?? [];
  }

  /** Get all stored Merkle roots (test inspection). */
  getAllMerkleRoots(): ReadonlyArray<MerkleRoot> {
    return this.merkleRoots;
  }

  /** Clear all data (test reset). */
  clear(): void {
    this.events.clear();
    this.merkleRoots.length = 0;
    this.eventIds.clear();
  }
}
