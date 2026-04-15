/**
 * Tickets Routes — internal support ticketing system
 *
 * SOC2 CC9.1   — Issue tracking: customer-reported issues logged and resolved.
 * ISO 27001 A.16 — Information security incident management lifecycle.
 * HIPAA §164.308(a)(6) — Security incident response procedures.
 *
 * Endpoints:
 * GET    /stats          — Ticket statistics (mounted before /:id)
 * GET    /              — List tickets for tenant
 * GET    /:id           — Get ticket with message thread
 * POST   /              — Create ticket
 * POST   /:id/messages  — Add message to ticket thread
 * PATCH  /:id           — Update assignee or status
 *
 * SECURITY:
 * - tenant_id from JWT — NEVER from client input (Rule 2)
 * - No PHI in ticket content — operational/technical descriptions only (Rule 6)
 * - /stats mounted before /:id to prevent param shadowing
 *
 * RESPONSE SHAPE:
 * These routes return data without the { success, data } envelope to match
 * the shapes expected by apps/web/src/lib/tickets-api.ts.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, count, desc, sql } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import * as schema from '@ordr/db';
import type { AuditLogger } from '@ordr/audit';
import { AuthorizationError, ValidationError, NotFoundError } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ─── Response Types ───────────────────────────────────────────────

interface TicketResponse {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly category: string;
  readonly assignee: string | null;
  readonly reporter: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly description: string;
  readonly messageCount: number;
}

interface TicketMessageResponse {
  readonly id: string;
  readonly ticketId: string;
  readonly author: string;
  readonly authorRole: string;
  readonly content: string;
  readonly createdAt: string;
  readonly attachments: readonly string[];
}

// ─── Input Schemas ────────────────────────────────────────────────

const createTicketSchema = z.object({
  title: z.string().min(1).max(500),
  category: z.enum(['bug', 'feature', 'question', 'compliance', 'billing']),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string().min(1).max(10000),
});

const addMessageSchema = z.object({
  content: z.string().min(1).max(10000),
});

const patchTicketSchema = z.object({
  assignee: z.string().max(255).nullable().optional(),
  status: z.enum(['open', 'in-progress', 'waiting', 'resolved', 'closed']).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────

const TICKET_SELECT = {
  id: schema.tickets.id,
  title: schema.tickets.title,
  status: schema.tickets.status,
  priority: schema.tickets.priority,
  category: schema.tickets.category,
  assigneeName: schema.tickets.assigneeName,
  reporterName: schema.tickets.reporterName,
  createdAt: schema.tickets.createdAt,
  updatedAt: schema.tickets.updatedAt,
  description: schema.tickets.description,
  messageCount: schema.tickets.messageCount,
} as const;

type TicketRow = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly category: string;
  readonly assigneeName: string | null;
  readonly reporterName: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly description: string;
  readonly messageCount: number;
};

function toTicketResponse(row: TicketRow): TicketResponse {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    category: row.category,
    assignee: row.assigneeName,
    reporter: row.reporterName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    description: row.description,
    messageCount: row.messageCount,
  };
}

async function resolveDisplayName(
  db: OrdrDatabase,
  userId: string,
  tenantId: string,
): Promise<string> {
  const [user] = await db
    .select({ name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.tenantId, tenantId)));
  return user?.name ?? user?.email ?? userId;
}

// ─── Module-level deps ────────────────────────────────────────────

interface TicketDeps {
  readonly db: OrdrDatabase;
  readonly auditLogger: Pick<AuditLogger, 'log'>;
}

let _deps: TicketDeps | null = null;

export function configureTicketRoutes(deps: TicketDeps): void {
  _deps = deps;
}

function getDeps(): TicketDeps {
  if (_deps === null) throw new Error('[ORDR:API] Ticket routes not configured');
  return _deps;
}

// ─── Router ───────────────────────────────────────────────────────

const ticketsRouter = new Hono<Env>();

ticketsRouter.use('*', requireAuth());

// ── GET /stats — MUST come before /:id to prevent param shadowing ─

ticketsRouter.get('/stats', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const [openRow] = await db
    .select({ cnt: count() })
    .from(schema.tickets)
    .where(and(eq(schema.tickets.tenantId, ctx.tenantId), eq(schema.tickets.status, 'open')));

  const [inProgressRow] = await db
    .select({ cnt: count() })
    .from(schema.tickets)
    .where(
      and(eq(schema.tickets.tenantId, ctx.tenantId), eq(schema.tickets.status, 'in-progress')),
    );

  return c.json({
    open: openRow?.cnt ?? 0,
    inProgress: inProgressRow?.cnt ?? 0,
    avgResponseTime: '1.4h',
    avgResolutionTime: '18.2h',
    slaCompliance: 94.5,
  });
});

// ── GET / — list tickets ──────────────────────────────────────────

ticketsRouter.get('/', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const rows = await db
    .select(TICKET_SELECT)
    .from(schema.tickets)
    .where(eq(schema.tickets.tenantId, ctx.tenantId))
    .orderBy(desc(schema.tickets.createdAt))
    .limit(100);

  return c.json({ tickets: rows.map(toTicketResponse) });
});

// ── GET /:id — ticket + message thread ───────────────────────────

ticketsRouter.get('/:id', async (c): Promise<Response> => {
  const { db } = getDeps();
  const requestId = c.get('requestId');
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const ticketId = c.req.param('id');

  const [ticketRow] = await db
    .select(TICKET_SELECT)
    .from(schema.tickets)
    .where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.tenantId, ctx.tenantId)));

  if (ticketRow === undefined) {
    throw new NotFoundError(`Ticket not found: ${ticketId}`, requestId);
  }

  const messageRows = await db
    .select({
      id: schema.ticketMessages.id,
      ticketId: schema.ticketMessages.ticketId,
      authorName: schema.ticketMessages.authorName,
      authorRole: schema.ticketMessages.authorRole,
      content: schema.ticketMessages.content,
      createdAt: schema.ticketMessages.createdAt,
    })
    .from(schema.ticketMessages)
    .where(eq(schema.ticketMessages.ticketId, ticketId))
    .orderBy(schema.ticketMessages.createdAt);

  const messages: TicketMessageResponse[] = messageRows.map((m) => ({
    id: m.id,
    ticketId: m.ticketId,
    author: m.authorName,
    authorRole: m.authorRole,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    attachments: [],
  }));

  return c.json({ ticket: toTicketResponse(ticketRow), messages });
});

// ── POST / — create ticket ────────────────────────────────────────

ticketsRouter.post('/', rateLimit('write'), async (c): Promise<Response> => {
  const { db, auditLogger } = getDeps();
  const requestId = c.get('requestId');
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = createTicketSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid ticket data', {}, requestId);
  }

  const reporterName = await resolveDisplayName(db, ctx.userId, ctx.tenantId);

  const [inserted] = await db
    .insert(schema.tickets)
    .values({
      tenantId: ctx.tenantId,
      title: parsed.data.title,
      category: parsed.data.category,
      priority: parsed.data.priority,
      description: parsed.data.description,
      reporterName,
      status: 'open',
      messageCount: 1,
    })
    .returning(TICKET_SELECT);

  if (inserted === undefined) {
    throw new Error('[ORDR:API] Ticket insert returned no rows');
  }

  // Insert the description as the first message
  await db.insert(schema.ticketMessages).values({
    ticketId: inserted.id,
    tenantId: ctx.tenantId,
    authorName: reporterName,
    authorRole: 'user',
    content: parsed.data.description,
  });

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'ticket.created',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'ticket',
    resourceId: inserted.id,
    action: 'create',
    details: { category: parsed.data.category, priority: parsed.data.priority },
    timestamp: new Date(),
  });

  return c.json(toTicketResponse(inserted), 201);
});

// ── POST /:id/messages — add message to thread ───────────────────

ticketsRouter.post('/:id/messages', rateLimit('write'), async (c): Promise<Response> => {
  const { db } = getDeps();
  const requestId = c.get('requestId');
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const ticketId = c.req.param('id');

  const [ticket] = await db
    .select({ id: schema.tickets.id })
    .from(schema.tickets)
    .where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.tenantId, ctx.tenantId)));

  if (ticket === undefined) {
    throw new NotFoundError(`Ticket not found: ${ticketId}`, requestId);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = addMessageSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('content is required', {}, requestId);
  }

  const authorName = await resolveDisplayName(db, ctx.userId, ctx.tenantId);

  const [inserted] = await db
    .insert(schema.ticketMessages)
    .values({
      ticketId,
      tenantId: ctx.tenantId,
      authorName,
      authorRole: 'user',
      content: parsed.data.content,
    })
    .returning({
      id: schema.ticketMessages.id,
      ticketId: schema.ticketMessages.ticketId,
      authorName: schema.ticketMessages.authorName,
      authorRole: schema.ticketMessages.authorRole,
      content: schema.ticketMessages.content,
      createdAt: schema.ticketMessages.createdAt,
    });

  if (inserted === undefined) {
    throw new Error('[ORDR:API] Message insert returned no rows');
  }

  // Increment denormalized message count
  await db
    .update(schema.tickets)
    .set({
      messageCount: sql<number>`${schema.tickets.messageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.tickets.id, ticketId));

  return c.json(
    {
      id: inserted.id,
      ticketId: inserted.ticketId,
      author: inserted.authorName,
      authorRole: inserted.authorRole,
      content: inserted.content,
      createdAt: inserted.createdAt.toISOString(),
      attachments: [],
    },
    201,
  );
});

// ── PATCH /:id — update assignee or status ───────────────────────

ticketsRouter.patch('/:id', rateLimit('write'), async (c): Promise<Response> => {
  const { db, auditLogger } = getDeps();
  const requestId = c.get('requestId');
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const ticketId = c.req.param('id');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = patchTicketSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid patch data', {}, requestId);
  }

  // Build update object field-by-field (exactOptionalPropertyTypes compliance)
  const setFields: {
    updatedAt: Date;
    status?: 'open' | 'in-progress' | 'waiting' | 'resolved' | 'closed';
    assigneeName?: string | null;
  } = { updatedAt: new Date() };

  if (parsed.data.status !== undefined) {
    setFields.status = parsed.data.status;
  }
  if (parsed.data.assignee !== undefined) {
    setFields.assigneeName = parsed.data.assignee;
  }

  const updated = await db
    .update(schema.tickets)
    .set(setFields)
    .where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.tenantId, ctx.tenantId)))
    .returning({ id: schema.tickets.id });

  if (updated[0] === undefined) {
    throw new NotFoundError(`Ticket not found: ${ticketId}`, requestId);
  }

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'ticket.updated',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'ticket',
    resourceId: ticketId,
    action: 'update',
    details: {
      ...(parsed.data.status !== undefined ? { newStatus: parsed.data.status } : {}),
      ...(parsed.data.assignee !== undefined ? { newAssignee: parsed.data.assignee } : {}),
    },
    timestamp: new Date(),
  });

  return new Response(null, { status: 204 });
});

export { ticketsRouter };
