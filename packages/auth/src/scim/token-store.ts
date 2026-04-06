import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { scimTokens } from '@ordr/db';
import type { SCIMTokenStore } from './types';

export class DrizzleTokenStore implements SCIMTokenStore {
  constructor(private readonly db: NodePgDatabase) {}

  async findByToken(
    hashedToken: string,
  ): Promise<{ tenantId: string; directoryId: string | null } | null> {
    const rows = await this.db

      .select({ tenantId: scimTokens.tenantId, directoryId: scimTokens.directoryId })
      .from(scimTokens)
      .where(eq(scimTokens.tokenHash, hashedToken));

    if (rows.length === 0) {
      return null;
    }

    return rows[0] ?? null;
  }

  /** Used by WorkOS webhook handler to resolve directory_id → tenantId */
  async findByDirectoryId(directoryId: string): Promise<{ tenantId: string } | null> {
    const rows = await this.db
      .select({ tenantId: scimTokens.tenantId })
      .from(scimTokens)
      .where(eq(scimTokens.directoryId, directoryId));

    if (rows.length === 0) {
      return null;
    }

    return rows[0] ?? null;
  }
}
