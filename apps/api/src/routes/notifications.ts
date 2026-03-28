/**
 * Notification Routes — in-app notification center
 *
 * SOC2 CC7.2 — Monitoring: security-relevant event alerting.
 * ISO 27001 A.16.1.2 — Reporting information security events.
 * HIPAA §164.312(b) — Audit controls: no PHI in notification content.
 *
 * Endpoints:
 * GET  /                — List notifications (filterable by type, read, dismissed)
 * PATCH /:id/read       — Mark a single notification as read
 * PATCH /:id/dismiss    — Dismiss a single notification
 * POST /mark-read-all   — Mark all unread notifications as read
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import { notifications } from '@ordr/db';
import { NotFoundError } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';

// ─── Module-level DB ────────────────────────────────────────────

let _db: OrdrDatabase | null = null;

export function configureNotificationsRoute(db: OrdrDatabase): void {
  _db = db;
}

function getDb(): OrdrDatabase {
  if (_db === null) {
    throw new Error(
      '[ORDR:API] Notifications route not configured — call configureNotificationsRoute()',
    );
  }
  return _db;
}

// ─── Input Schemas ───────────────────────────────────────────────

const listQuerySchema = z.object({
  type: z.enum(['hitl', 'compliance', 'escalation', 'sla', 'system']).optional(),
  read: z.enum(['true', 'false']).optional(),
  includeDismissed: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ─── Response shape ──────────────────────────────────────────────

function rowToDto(row: typeof notifications.$inferSelect) {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    description: row.description,
    timestamp: row.createdAt.toISOString(),
    read: row.read,
    dismissed: row.dismissed,
    actionLabel: row.actionLabel ?? undefined,
    actionRoute: row.actionRoute ?? undefined,
    metadata: row.metadata ?? undefined,
  };
}

// ─── Router ─────────────────────────────────────────────────────

const notificationsRouter = new Hono<Env>();

// ── GET / ──────────────────────────────────────────────────────

notificationsRouter.get('/', requireAuth(), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: {
          code: 'AUTH_FAILED' as const,
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );

  const query = listQuerySchema.safeParse({
    type: c.req.query('type'),
    read: c.req.query('read'),
    includeDismissed: c.req.query('includeDismissed'),
    limit: c.req.query('limit'),
  });

  if (!query.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR' as const,
          message: 'Invalid query parameters',
          correlationId: c.get('requestId'),
        },
      },
      400,
    );
  }

  const db = getDb();
  const { type, read, includeDismissed, limit } = query.data;

  const conditions = [eq(notifications.tenantId, ctx.tenantId)];

  if (type !== undefined) {
    conditions.push(eq(notifications.type, type));
  }
  if (read !== undefined) {
    conditions.push(eq(notifications.read, read === 'true'));
  }
  if (includeDismissed !== 'true') {
    conditions.push(eq(notifications.dismissed, false));
  }

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const unreadCount = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, ctx.tenantId),
        eq(notifications.read, false),
        eq(notifications.dismissed, false),
      ),
    );

  return c.json({
    success: true as const,
    data: rows.map(rowToDto),
    meta: {
      total: rows.length,
      unreadCount: unreadCount.length,
    },
  });
});

// ── PATCH /:id/read ───────────────────────────────────────────

notificationsRouter.patch('/:id/read', requireAuth(), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: {
          code: 'AUTH_FAILED' as const,
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );

  const id = c.req.param('id');
  const db = getDb();
  const now = new Date();

  const rows = await db
    .update(notifications)
    .set({ read: true, readAt: now })
    .where(and(eq(notifications.id, id), eq(notifications.tenantId, ctx.tenantId)))
    .returning();

  const row = rows[0];
  if (row === undefined) {
    throw new NotFoundError('Notification not found', c.get('requestId'));
  }

  return c.json({ success: true as const, data: rowToDto(row) });
});

// ── PATCH /:id/dismiss ────────────────────────────────────────

notificationsRouter.patch('/:id/dismiss', requireAuth(), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: {
          code: 'AUTH_FAILED' as const,
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );

  const id = c.req.param('id');
  const db = getDb();
  const now = new Date();

  const rows = await db
    .update(notifications)
    .set({ dismissed: true, dismissedAt: now })
    .where(and(eq(notifications.id, id), eq(notifications.tenantId, ctx.tenantId)))
    .returning();

  const dismissedRow = rows[0];
  if (dismissedRow === undefined) {
    throw new NotFoundError('Notification not found', c.get('requestId'));
  }

  return c.json({ success: true as const, data: rowToDto(dismissedRow) });
});

// ── POST /mark-read-all ───────────────────────────────────────

notificationsRouter.post('/mark-read-all', requireAuth(), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: {
          code: 'AUTH_FAILED' as const,
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );

  const db = getDb();
  const now = new Date();

  const rows = await db
    .update(notifications)
    .set({ read: true, readAt: now })
    .where(and(eq(notifications.tenantId, ctx.tenantId), eq(notifications.read, false)))
    .returning({ id: notifications.id });

  return c.json({
    success: true as const,
    data: { markedRead: rows.length },
  });
});

export { notificationsRouter };
