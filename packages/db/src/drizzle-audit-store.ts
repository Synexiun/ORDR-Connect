/**
 * DrizzleAuditStore — PostgreSQL-backed WORM audit log store
 *
 * Production implementation of @ordr/audit's AuditStore interface.
 * Uses the audit_logs and merkle_roots tables with enforced WORM semantics:
 * - DB-level: UNIQUE constraint on (tenant_id, sequence_number) + UPDATE/DELETE
 *   triggers that raise exceptions (see migration 0002_audit_worm_triggers.sql)
 * - App-level: catches constraint violations and re-throws as WORM errors
 *
 * SOC2 CC7.2  — Monitoring: immutable audit trail for all state changes.
 * ISO 27001 A.12.4.1 — Event logging: durable, tamper-evident logs.
 * HIPAA §164.312(b) — Audit controls: cryptographically chained log.
 *
 * NOTE: @ordr/audit cannot depend on @ordr/db (that would be circular), so
 * this adapter lives here in @ordr/db which already imports from @ordr/audit.
 *
 * Usage:
 *   import { DrizzleAuditStore } from '@ordr/db';
 *   const auditStore = new DrizzleAuditStore(db);
 *   const auditLogger = new AuditLogger(auditStore);
 */

import { eq, and, gte, lte, desc, asc } from 'drizzle-orm';
import type { AuditStore, AuditEvent, MerkleRoot } from '@ordr/audit';
import type { OrdrDatabase } from './connection.js';
import { auditLogs, merkleRoots } from './schema/index.js';

// ─── Helpers ────────────────────────────────────────────────────

function rowToEvent(row: typeof auditLogs.$inferSelect): AuditEvent {
  return {
    id: row.id,
    sequenceNumber: Number(row.sequenceNumber),
    tenantId: row.tenantId,
    eventType: row.eventType as AuditEvent['eventType'],
    actorType: row.actorType as AuditEvent['actorType'],
    actorId: row.actorId,
    resource: row.resource,
    resourceId: row.resourceId,
    action: row.action,
    details: row.details as Record<string, unknown>,
    previousHash: row.previousHash,
    hash: row.hash,
    timestamp: row.timestamp,
  };
}

// ─── DrizzleAuditStore ──────────────────────────────────────────

export class DrizzleAuditStore implements AuditStore {
  constructor(private readonly db: OrdrDatabase) {}

  /**
   * Append a new audit event.
   *
   * The DB enforces WORM via:
   * 1. UNIQUE(tenant_id, sequence_number) — rejects duplicate sequences
   * 2. UPDATE/DELETE triggers — raise exceptions if attempted
   *
   * If the insert fails due to a unique constraint, we re-throw as a
   * WORM violation with a descriptive message (same contract as InMemoryAuditStore).
   */
  async append(event: AuditEvent): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        id: event.id,
        sequenceNumber: BigInt(event.sequenceNumber),
        tenantId: event.tenantId,
        eventType: event.eventType,
        actorType: event.actorType as 'user' | 'agent' | 'system',
        actorId: event.actorId,
        resource: event.resource,
        resourceId: event.resourceId,
        action: event.action,
        details: event.details,
        previousHash: event.previousHash,
        hash: event.hash,
        timestamp: event.timestamp,
      });
    } catch (err: unknown) {
      // Re-throw constraint violations as WORM violations
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('23505')) {
        throw new Error(
          `WORM violation: duplicate sequence ${String(event.sequenceNumber)} for tenant ${event.tenantId} — updates are forbidden`,
        );
      }
      throw err;
    }
  }

  async getBySequence(tenantId: string, sequence: number): Promise<AuditEvent | null> {
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.sequenceNumber, BigInt(sequence))))
      .limit(1);

    const row = rows[0];
    return row !== undefined ? rowToEvent(row) : null;
  }

  async getRange(
    tenantId: string,
    fromSequence: number,
    toSequence: number,
  ): Promise<AuditEvent[]> {
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          gte(auditLogs.sequenceNumber, BigInt(fromSequence)),
          lte(auditLogs.sequenceNumber, BigInt(toSequence)),
        ),
      )
      .orderBy(asc(auditLogs.sequenceNumber));

    return rows.map(rowToEvent);
  }

  async getLastEvent(tenantId: string): Promise<AuditEvent | null> {
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, tenantId))
      .orderBy(desc(auditLogs.sequenceNumber))
      .limit(1);

    const row = rows[0];
    return row !== undefined ? rowToEvent(row) : null;
  }

  async storeMerkleRoot(root: MerkleRoot): Promise<void> {
    await this.db.insert(merkleRoots).values({
      tenantId: 'system', // Merkle roots are not tenant-scoped — they cover all tenants
      batchStart: BigInt(root.batchStart),
      batchEnd: BigInt(root.batchEnd),
      root: root.root,
      eventCount: root.eventCount,
      timestamp: root.timestamp,
    });
  }
}
