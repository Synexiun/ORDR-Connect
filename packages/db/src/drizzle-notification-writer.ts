/**
 * DrizzleNotificationWriter — PostgreSQL-backed notification insert helper
 *
 * Provides a single `insert` method that writes one notification row into the
 * `notifications` table. Used by worker handlers to create in-app alerts for
 * compliance violations, agent escalations, HITL requests, and system events.
 *
 * No PHI may appear in any notification field (title, description, metadata).
 * Use tokenized IDs (messageId, customerId, sessionId) for correlation only.
 *
 * SOC2 CC7.2 — Monitoring: in-app alerts for security-relevant events.
 * ISO 27001 A.16.1.2 — Reporting information security events.
 * HIPAA §164.312(b) — Audit controls: notification lifecycle logged separately.
 *
 * Usage:
 *   import { DrizzleNotificationWriter } from '@ordr/db';
 *   const notificationWriter = new DrizzleNotificationWriter(db);
 *   await notificationWriter.insert({ tenantId, type, severity, title, description });
 */

import type { OrdrDatabase } from './connection.js';
import { notifications } from './schema/index.js';

// ─── Insert Shape ────────────────────────────────────────────────

export interface NotificationInsert {
  readonly tenantId: string;
  readonly type: 'hitl' | 'compliance' | 'escalation' | 'sla' | 'system';
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly title: string;
  readonly description: string;
  readonly actionLabel?: string;
  readonly actionRoute?: string;
  readonly metadata?: Record<string, string>;
}

// ─── DrizzleNotificationWriter ───────────────────────────────────

export class DrizzleNotificationWriter {
  constructor(private readonly db: OrdrDatabase) {}

  async insert(notification: NotificationInsert): Promise<void> {
    await this.db.insert(notifications).values({
      tenantId: notification.tenantId,
      type: notification.type,
      severity: notification.severity,
      title: notification.title,
      description: notification.description,
      actionLabel: notification.actionLabel ?? null,
      actionRoute: notification.actionRoute ?? null,
      metadata: notification.metadata ?? {},
    });
  }
}
