/**
 * @ordr/audit — SHA-256 Hash Chain
 *
 * Each audit event cryptographically binds to its predecessor via SHA-256.
 * Tampering with any event breaks the chain — mathematically detectable.
 *
 * Uses Node.js native `crypto` only. Zero external dependencies.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuditEvent } from './types.js';

/**
 * Genesis hash — the "previous hash" for the very first event in any chain.
 * Deterministic: SHA-256('ORDR-CONNECT-GENESIS-BLOCK-v1')
 */
export const GENESIS_HASH: string = createHash('sha256')
  .update('ORDR-CONNECT-GENESIS-BLOCK-v1')
  .digest('hex');

/**
 * Sort object keys recursively for deterministic JSON serialization.
 * Critical: identical details must always produce identical hashes.
 */
function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    const value = obj[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      sorted[key] = sortObjectKeys(value as Record<string, unknown>);
    } else {
      sorted[key] = value;
    }
  }
  return sorted;
}

/**
 * Compute the SHA-256 hash for an audit event.
 *
 * Hash input: previousHash + sequenceNumber + tenantId + eventType +
 *             actorId + resource + resourceId + action +
 *             timestamp.toISOString() + JSON.stringify(sortedDetails)
 *
 * @param event - The event (without its own hash field)
 * @param previousHash - Hash of the preceding event (or GENESIS_HASH)
 * @returns Hex-encoded SHA-256 hash
 */
export function computeEventHash(
  event: Omit<AuditEvent, 'hash'>,
  previousHash: string,
): string {
  const sortedDetails = sortObjectKeys(event.details);

  const payload =
    previousHash +
    String(event.sequenceNumber) +
    event.tenantId +
    event.eventType +
    event.actorId +
    event.resource +
    event.resourceId +
    event.action +
    event.timestamp.toISOString() +
    JSON.stringify(sortedDetails);

  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Verify a single chain link: recompute the event's hash and compare.
 * Uses timing-safe comparison to prevent side-channel attacks.
 *
 * @param event - The event to verify
 * @param previousHash - Expected previous hash
 * @returns true if the link is valid
 */
export function verifyChainLink(event: AuditEvent, previousHash: string): boolean {
  const expectedHash = computeEventHash(event, previousHash);

  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const actualBuffer = Buffer.from(event.hash, 'hex');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

/**
 * Verify an entire chain of audit events from genesis.
 *
 * Events MUST be sorted by sequenceNumber ascending.
 * Returns status including the first broken link if any.
 *
 * @param events - Ordered array of events to verify
 * @returns Chain verification status
 */
export function verifyChain(events: ReadonlyArray<AuditEvent>): import('./types.js').AuditChainStatus {
  if (events.length === 0) {
    return {
      valid: true,
      totalEvents: 0,
      lastSequence: 0,
      lastHash: GENESIS_HASH,
    };
  }

  let previousHash = GENESIS_HASH;

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;

    // Verify sequence continuity — no gaps allowed
    const expectedSequence = i + 1;
    if (event.sequenceNumber !== expectedSequence) {
      return {
        valid: false,
        totalEvents: events.length,
        lastSequence: event.sequenceNumber,
        lastHash: event.hash,
        brokenAt: event.sequenceNumber,
      };
    }

    // Verify previousHash pointer
    if (event.previousHash !== previousHash) {
      return {
        valid: false,
        totalEvents: events.length,
        lastSequence: event.sequenceNumber,
        lastHash: event.hash,
        brokenAt: event.sequenceNumber,
      };
    }

    // Verify hash integrity
    if (!verifyChainLink(event, previousHash)) {
      return {
        valid: false,
        totalEvents: events.length,
        lastSequence: event.sequenceNumber,
        lastHash: event.hash,
        brokenAt: event.sequenceNumber,
      };
    }

    previousHash = event.hash;
  }

  const lastEvent = events[events.length - 1]!;
  return {
    valid: true,
    totalEvents: events.length,
    lastSequence: lastEvent.sequenceNumber,
    lastHash: lastEvent.hash,
  };
}
