/**
 * packages/db/src/queries/developer-webhooks.ts
 *
 * Data-access functions for the developer_webhooks table.
 * Injected as WebhookDeps into configureWebhookRoutes().
 *
 * All queries are tenant-scoped via developer_id (Rule 2).
 * Note: deleteWebhook takes only webhookId — ownership pre-verified by caller via findWebhook.
 *
 * SOC2 CC6.1 — developer-scoped, never cross-tenant.
 * All mutations are audited at the route layer.
 */

import { eq, and, count } from 'drizzle-orm';
import type { OrdrDatabase } from '../connection.js';
import { developerWebhooks } from '../schema/developer-webhooks.js';

// ─── Types ────────────────────────────────────────────────────────

export interface WebhookRecord {
  readonly id: string;
  readonly developerId: string;
  readonly url: string;
  readonly events: string[];
  readonly hmacSecretEncrypted: string;
  readonly active: boolean;
  readonly lastTriggeredAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─── Query functions ──────────────────────────────────────────────

/**
 * Factory function to create webhook query helpers.
 * Injects the Drizzle database instance.
 */
export function makeWebhookQueries(db: OrdrDatabase) {
  return {
    /**
     * Create a new webhook registration.
     * Called by POST /api/dev/webhooks after HMAC secret encryption.
     */
    async createWebhook(data: {
      developerId: string;
      url: string;
      events: string[];
      hmacSecretEncrypted: string;
    }): Promise<WebhookRecord> {
      const rows = await db
        .insert(developerWebhooks)
        .values({
          developerId: data.developerId,
          url: data.url,
          events: data.events,
          hmacSecretEncrypted: data.hmacSecretEncrypted,
          active: true,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Insert returned no rows');
      return row as WebhookRecord;
    },

    /**
     * List all webhooks for a given developer.
     * Ordered by creation date (oldest first).
     */
    async listWebhooks(developerId: string): Promise<WebhookRecord[]> {
      const rows = await db
        .select()
        .from(developerWebhooks)
        .where(eq(developerWebhooks.developerId, developerId))
        .orderBy(developerWebhooks.createdAt);
      return rows as WebhookRecord[];
    },

    /**
     * Count active webhooks for a developer.
     * Used to enforce per-developer quotas (Phase 54).
     */
    async countActiveWebhooks(developerId: string): Promise<number> {
      const rows = await db
        .select({ total: count() })
        .from(developerWebhooks)
        .where(
          and(eq(developerWebhooks.developerId, developerId), eq(developerWebhooks.active, true)),
        );
      return rows[0]?.total ?? 0;
    },

    /**
     * Find a single webhook by ID and developer ID.
     * Returns null if not found or not owned by developer.
     *
     * OWNERSHIP CHECK: Always call this before delete/update to verify access.
     */
    async findWebhook(developerId: string, webhookId: string): Promise<WebhookRecord | null> {
      const rows = await db
        .select()
        .from(developerWebhooks)
        .where(
          and(eq(developerWebhooks.id, webhookId), eq(developerWebhooks.developerId, developerId)),
        )
        .limit(1);
      return (rows[0] as WebhookRecord | undefined) ?? null;
    },

    /**
     * Delete a webhook by ID (ownership pre-verified by caller).
     * Called by DELETE /api/dev/webhooks/:id after access control.
     */
    async deleteWebhook(webhookId: string): Promise<void> {
      await db.delete(developerWebhooks).where(eq(developerWebhooks.id, webhookId));
    },

    /**
     * Toggle webhook active status.
     * Called by PATCH /api/dev/webhooks/:id/toggle.
     *
     * @throws if webhook not found
     */
    async toggleWebhook(webhookId: string, active: boolean): Promise<WebhookRecord> {
      const rows = await db
        .update(developerWebhooks)
        .set({ active, updatedAt: new Date() })
        .where(eq(developerWebhooks.id, webhookId))
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Webhook not found');
      return row as WebhookRecord;
    },
  };
}

/**
 * Type alias for the return value of makeWebhookQueries.
 * Used in route dependencies:
 *   type WebhookDeps = ReturnType<typeof makeWebhookQueries>;
 */
export type WebhookQueries = ReturnType<typeof makeWebhookQueries>;
