/**
 * Internal Messaging Routes — Enterprise chat for ORDR-Connect users
 *
 * Endpoints:
 * GET    /channels                    — List channels accessible to user
 * POST   /channels                    — Create channel or DM
 * GET    /channels/:id                — Get channel detail
 * PATCH  /channels/:id                — Update channel (admin only)
 * DELETE /channels/:id/members/:uid   — Remove member
 * POST   /channels/:id/members        — Add member
 * GET    /channels/:id/messages       — List messages (cursor-based)
 * POST   /channels/:id/messages       — Send message
 * PATCH  /channels/:id/messages/:mid  — Edit message
 * DELETE /channels/:id/messages/:mid  — Delete message
 * POST   /channels/:id/messages/:mid/reactions — Add reaction
 * DELETE /channels/:id/messages/:mid/reactions/:emoji — Remove reaction
 * POST   /channels/:id/read           — Mark messages as read
 * POST   /channels/:id/typing         — Typing indicator
 * GET    /presence                    — Get online users
 * PUT    /presence                    — Set own status
 * GET    /search                      — Search messages
 * GET    /events                      — SSE stream for real-time events
 *
 * SOC2 CC6.3 — Logical access: tenant isolation enforced.
 * ISO 27001 A.8.1.3 — Acceptable use of assets.
 * HIPAA §164.312(a)(1) — Access control on PHI in messages.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import {
  ChannelManager,
  InMemoryChannelStore,
  MessageService,
  InMemoryMessageStore,
  PresenceManager,
} from '@ordr/messaging';
import type { ChatChannel, ChatMessage, MessageEvent } from '@ordr/messaging';

// ─── Singletons ──────────────────────────────────────────────────────────────

const channelStore = new InMemoryChannelStore();
const messageStore = new InMemoryMessageStore();
const channelManager = new ChannelManager(channelStore);
const messageService = new MessageService(messageStore);
export const presenceManager = new PresenceManager();

// ─── SSE Event Bus ───────────────────────────────────────────────────────────
// tenantId -> Set of subscriber callbacks

type EventSubscriber = (event: MessageEvent) => void | Promise<void>;
const subscribers = new Map<string, Set<EventSubscriber>>();

function publishEvent(event: MessageEvent): void {
  const tenantSubs = subscribers.get(event.tenantId);
  if (tenantSubs !== undefined) {
    for (const cb of tenantSubs) void cb(event);
  }
}

function subscribe(tenantId: string, cb: EventSubscriber): () => void {
  let subs = subscribers.get(tenantId);
  if (subs === undefined) {
    subs = new Set();
    subscribers.set(tenantId, subs);
  }
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

function channelToDto(ch: ChatChannel) {
  return {
    id: ch.id,
    name: ch.name,
    type: ch.type,
    description: ch.description,
    topic: ch.topic,
    memberCount: ch.memberIds.length,
    createdAt: ch.createdAt.toISOString(),
    updatedAt: ch.updatedAt.toISOString(),
    isArchived: ch.isArchived,
    isPinned: ch.isPinned,
  };
}

function messageToDto(m: ChatMessage) {
  return {
    id: m.id,
    channelId: m.channelId,
    senderId: m.senderId,
    senderName: m.senderName,
    content: m.deletedAt !== undefined ? '[Message deleted]' : m.content,
    contentType: m.contentType,
    attachments: m.attachments,
    replyToId: m.replyToId,
    mentions: m.mentions,
    reactions: m.reactions,
    readBy: m.readBy,
    editedAt: m.editedAt?.toISOString(),
    deletedAt: m.deletedAt?.toISOString(),
    isSystemMessage: m.isSystemMessage,
    createdAt: m.createdAt.toISOString(),
  };
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createChannelSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(['public', 'private', 'direct', 'announcement']),
  description: z.string().max(280).optional(),
  memberIds: z.array(z.string().uuid()).max(500),
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(10_000),
  contentType: z.enum(['text', 'markdown', 'code']).default('text'),
  replyToId: z.string().uuid().optional(),
  mentions: z.array(z.string().uuid()).max(50).optional(),
});

const editMessageSchema = z.object({ content: z.string().min(1).max(10_000) });

const setStatusSchema = z.object({
  status: z.enum(['online', 'away', 'dnd', 'offline']),
  statusMessage: z.string().max(100).optional(),
});

const markReadSchema = z.object({ messageIds: z.array(z.string().uuid()).max(100) });

const searchSchema = z.object({
  q: z.string().min(1).max(200),
  channelId: z.string().uuid().optional(),
});

// ─── Router ──────────────────────────────────────────────────────────────────

const messagingRouter = new Hono<Env>();

// GET /channels
messagingRouter.get('/channels', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const channels = await channelManager.getForUser(ctx.tenantId, ctx.userId);
  return c.json({ success: true as const, data: channels.map(channelToDto) });
});

// POST /channels
messagingRouter.post('/channels', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const body: unknown = await c.req.json();
  const parsed = createChannelSchema.safeParse(body);
  if (!parsed.success)
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          correlationId: c.get('requestId'),
        },
      },
      400,
    );
  const channel = await channelManager.create({
    tenantId: ctx.tenantId,
    createdBy: ctx.userId,
    ...parsed.data,
  });
  publishEvent({
    type: 'channel.created',
    tenantId: ctx.tenantId,
    channelId: channel.id,
    userId: ctx.userId,
    payload: channelToDto(channel),
    timestamp: new Date(),
  });
  return c.json({ success: true as const, data: channelToDto(channel) }, 201);
});

// GET /channels/:id
messagingRouter.get('/channels/:id', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const channel = await channelManager.get(c.req.param('id'), ctx.tenantId);
  if (channel === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Channel not found',
          correlationId: c.get('requestId'),
        },
      },
      404,
    );
  return c.json({ success: true as const, data: channelToDto(channel) });
});

// POST /channels/:id/members
messagingRouter.post('/channels/:id/members', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const body = (await c.req.json()) as unknown as { userId?: string };
  if (typeof body.userId !== 'string')
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'userId required',
          correlationId: c.get('requestId'),
        },
      },
      400,
    );
  await channelManager.addMember(c.req.param('id'), ctx.tenantId, body.userId, ctx.userId);
  return c.json({ success: true as const });
});

// DELETE /channels/:id/members/:uid
messagingRouter.delete('/channels/:id/members/:uid', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  await channelManager.removeMember(
    c.req.param('id'),
    ctx.tenantId,
    c.req.param('uid'),
    ctx.userId,
  );
  return c.json({ success: true as const });
});

// GET /channels/:id/messages
messagingRouter.get('/channels/:id/messages', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const cursor = c.req.query('cursor');
  const result = await messageService.list(c.req.param('id'), ctx.tenantId, limit, cursor);
  return c.json({
    success: true as const,
    data: result.messages.map(messageToDto),
    meta: { hasMore: result.hasMore, cursor: result.cursor },
  });
});

// POST /channels/:id/messages
messagingRouter.post('/channels/:id/messages', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const body: unknown = await c.req.json();
  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success)
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          correlationId: c.get('requestId'),
        },
      },
      400,
    );
  const message = await messageService.send({
    channelId: c.req.param('id'),
    tenantId: ctx.tenantId,
    senderId: ctx.userId,
    senderName: ctx.userId,
    ...parsed.data,
  });
  publishEvent({
    type: 'message.new',
    tenantId: ctx.tenantId,
    channelId: c.req.param('id'),
    userId: ctx.userId,
    payload: messageToDto(message),
    timestamp: new Date(),
  });
  return c.json({ success: true as const, data: messageToDto(message) }, 201);
});

// PATCH /channels/:id/messages/:mid
messagingRouter.patch('/channels/:id/messages/:mid', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const body: unknown = await c.req.json();
  const parsed = editMessageSchema.safeParse(body);
  if (!parsed.success)
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          correlationId: c.get('requestId'),
        },
      },
      400,
    );
  const message = await messageService.edit(
    c.req.param('mid'),
    ctx.tenantId,
    ctx.userId,
    parsed.data.content,
  );
  publishEvent({
    type: 'message.edit',
    tenantId: ctx.tenantId,
    channelId: c.req.param('id'),
    userId: ctx.userId,
    payload: messageToDto(message),
    timestamp: new Date(),
  });
  return c.json({ success: true as const, data: messageToDto(message) });
});

// DELETE /channels/:id/messages/:mid
messagingRouter.delete('/channels/:id/messages/:mid', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const message = await messageService.delete(c.req.param('mid'), ctx.tenantId, ctx.userId);
  publishEvent({
    type: 'message.delete',
    tenantId: ctx.tenantId,
    channelId: c.req.param('id'),
    userId: ctx.userId,
    payload: { id: message.id },
    timestamp: new Date(),
  });
  return c.json({ success: true as const, data: { id: message.id } });
});

// POST /channels/:id/messages/:mid/reactions
messagingRouter.post('/channels/:id/messages/:mid/reactions', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const body = (await c.req.json()) as unknown as { emoji?: string };
  if (typeof body.emoji !== 'string' || body.emoji.length === 0 || body.emoji.length > 10) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'emoji required',
          correlationId: c.get('requestId'),
        },
      },
      400,
    );
  }
  const message = await messageService.addReaction(
    c.req.param('mid'),
    ctx.tenantId,
    ctx.userId,
    body.emoji,
  );
  publishEvent({
    type: 'message.reaction',
    tenantId: ctx.tenantId,
    channelId: c.req.param('id'),
    userId: ctx.userId,
    payload: messageToDto(message),
    timestamp: new Date(),
  });
  return c.json({ success: true as const, data: messageToDto(message) });
});

// DELETE /channels/:id/messages/:mid/reactions/:emoji
messagingRouter.delete('/channels/:id/messages/:mid/reactions/:emoji', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const message = await messageService.removeReaction(
    c.req.param('mid'),
    ctx.tenantId,
    ctx.userId,
    decodeURIComponent(c.req.param('emoji')),
  );
  return c.json({ success: true as const, data: messageToDto(message) });
});

// POST /channels/:id/read
messagingRouter.post('/channels/:id/read', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const body: unknown = await c.req.json();
  const parsed = markReadSchema.safeParse(body);
  if (!parsed.success)
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          correlationId: c.get('requestId'),
        },
      },
      400,
    );
  await messageService.markRead(
    c.req.param('id'),
    ctx.tenantId,
    ctx.userId,
    parsed.data.messageIds,
  );
  publishEvent({
    type: 'read.receipt',
    tenantId: ctx.tenantId,
    channelId: c.req.param('id'),
    userId: ctx.userId,
    payload: { messageIds: parsed.data.messageIds },
    timestamp: new Date(),
  });
  return c.json({ success: true as const });
});

// POST /channels/:id/typing
messagingRouter.post('/channels/:id/typing', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const body = (await c.req.json()) as unknown as { typing?: boolean; userName?: string };
  if (body.typing === true) {
    presenceManager.startTyping(c.req.param('id'), ctx.userId, body.userName ?? ctx.userId);
    publishEvent({
      type: 'typing.start',
      tenantId: ctx.tenantId,
      channelId: c.req.param('id'),
      userId: ctx.userId,
      payload: { userName: body.userName ?? ctx.userId },
      timestamp: new Date(),
    });
  } else {
    presenceManager.stopTyping(c.req.param('id'), ctx.userId);
    publishEvent({
      type: 'typing.stop',
      tenantId: ctx.tenantId,
      channelId: c.req.param('id'),
      userId: ctx.userId,
      payload: {},
      timestamp: new Date(),
    });
  }
  return c.json({ success: true as const });
});

// GET /presence
messagingRouter.get('/presence', requireAuth(), (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const online = presenceManager.getOnlineUsers(ctx.tenantId);
  return c.json({ success: true as const, data: online });
});

// PUT /presence
messagingRouter.put('/presence', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const body: unknown = await c.req.json();
  const parsed = setStatusSchema.safeParse(body);
  if (!parsed.success)
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          correlationId: c.get('requestId'),
        },
      },
      400,
    );
  const record = presenceManager.setStatus(
    ctx.userId,
    ctx.tenantId,
    parsed.data.status,
    parsed.data.statusMessage,
  );
  publishEvent({
    type: 'presence.update',
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    payload: record,
    timestamp: new Date(),
  });
  return c.json({ success: true as const, data: record });
});

// GET /search
messagingRouter.get('/search', requireAuth(), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const parsed = searchSchema.safeParse({
    q: c.req.query('q'),
    channelId: c.req.query('channelId'),
  });
  if (!parsed.success)
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'q required',
          correlationId: c.get('requestId'),
        },
      },
      400,
    );
  const results = await messageService.search(
    ctx.tenantId,
    parsed.data.q,
    parsed.data.channelId !== undefined ? [parsed.data.channelId] : undefined,
  );
  return c.json({ success: true as const, data: results.map(messageToDto) });
});

// GET /events — SSE stream for real-time updates
messagingRouter.get('/events', requireAuth(), (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );

  presenceManager.setStatus(ctx.userId, ctx.tenantId, 'online');

  return streamSSE(c, async (stream) => {
    let unsubscribe: (() => void) | undefined;
    try {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'connected', userId: ctx.userId }),
        event: 'connected',
        id: '0',
      });

      let eventId = 1;
      unsubscribe = subscribe(ctx.tenantId, async (event) => {
        try {
          await stream.writeSSE({
            data: JSON.stringify(event),
            event: event.type,
            id: String(eventId++),
          });
        } catch {
          // Client disconnected — suppress
        }
      });

      // Heartbeat every 30s
      while (!stream.aborted) {
        await new Promise<void>((resolve) => setTimeout(resolve, 30_000));
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!stream.aborted) {
          await stream.writeSSE({
            data: JSON.stringify({ type: 'heartbeat', ts: Date.now() }),
            event: 'heartbeat',
            id: String(eventId++),
          });
        }
      }
    } finally {
      unsubscribe?.();
      presenceManager.markOffline(ctx.userId, ctx.tenantId);
    }
  });
});

export { messagingRouter };
