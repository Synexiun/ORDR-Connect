/**
 * Worker shared types
 *
 * Structural interfaces defined here so the worker has no hard dependency on
 * @ordr/db. Callers (e.g., apps/api/src/server.ts) pass in implementations
 * that satisfy these shapes (e.g., DrizzleNotificationWriter from @ordr/db).
 */

// ─── Notification Writer ─────────────────────────────────────────

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

export interface NotificationWriter {
  insert(notification: NotificationInsert): Promise<void>;
}
