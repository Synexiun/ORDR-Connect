/**
 * DrizzleSSOConnectionStore — PostgreSQL-backed SSO connection persistence.
 *
 * Implements the SSOConnectionStore interface for SSOManager using Drizzle ORM.
 * All queries are tenant-scoped — no cross-tenant reads.
 *
 * SOC2 CC6.1 — Tenant-scoped SSO connection management.
 * ISO 27001 A.9.2.1 — User registration and de-registration via SSO.
 */

import { eq, and } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import * as schema from '@ordr/db';
import type {
  SSOConnection,
  SSOConnectionStore,
  SSOConnectionType,
  SSOProvider,
  SSOConnectionStatus,
} from './sso.js';

// ─── Row mapper ──────────────────────────────────────────────────────────────

function rowToSSOConnection(row: typeof schema.ssoConnections.$inferSelect): SSOConnection {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    type: row.type as SSOConnectionType,
    provider: row.provider as SSOProvider,
    status: row.status as SSOConnectionStatus,
    enforceSso: row.enforceSso,
    createdAt: row.createdAt,
  };
}

// ─── DrizzleSSOConnectionStore ───────────────────────────────────────────────

export class DrizzleSSOConnectionStore implements SSOConnectionStore {
  constructor(private readonly db: OrdrDatabase) {}

  async create(connection: SSOConnection): Promise<void> {
    await this.db.insert(schema.ssoConnections).values({
      id: connection.id,
      tenantId: connection.tenantId,
      name: connection.name,
      type: connection.type,
      provider: connection.provider,
      status: connection.status,
      enforceSso: connection.enforceSso,
      createdAt: connection.createdAt,
    });
  }

  async getById(tenantId: string, connectionId: string): Promise<SSOConnection | null> {
    const rows = await this.db
      .select()
      .from(schema.ssoConnections)
      .where(
        and(
          eq(schema.ssoConnections.tenantId, tenantId),
          eq(schema.ssoConnections.id, connectionId),
        ),
      )
      .limit(1);
    return rows[0] !== undefined ? rowToSSOConnection(rows[0]) : null;
  }

  async getByConnectionId(connectionId: string): Promise<SSOConnection | null> {
    const rows = await this.db
      .select()
      .from(schema.ssoConnections)
      .where(eq(schema.ssoConnections.id, connectionId))
      .limit(1);
    return rows[0] !== undefined ? rowToSSOConnection(rows[0]) : null;
  }

  async listByTenant(tenantId: string): Promise<readonly SSOConnection[]> {
    const rows = await this.db
      .select()
      .from(schema.ssoConnections)
      .where(eq(schema.ssoConnections.tenantId, tenantId));
    return rows.map(rowToSSOConnection);
  }

  async delete(tenantId: string, connectionId: string): Promise<void> {
    await this.db
      .delete(schema.ssoConnections)
      .where(
        and(
          eq(schema.ssoConnections.tenantId, tenantId),
          eq(schema.ssoConnections.id, connectionId),
        ),
      );
  }

  async getActiveByTenant(tenantId: string): Promise<SSOConnection | null> {
    const rows = await this.db
      .select()
      .from(schema.ssoConnections)
      .where(
        and(
          eq(schema.ssoConnections.tenantId, tenantId),
          eq(schema.ssoConnections.status, 'active'),
        ),
      )
      .limit(1);
    return rows[0] !== undefined ? rowToSSOConnection(rows[0]) : null;
  }
}
