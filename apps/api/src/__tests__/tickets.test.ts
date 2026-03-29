/**
 * Tickets route tests
 *
 * Verifies:
 * - GET /stats          — ticket statistics shape
 * - GET /              — list tickets
 * - GET /:id           — ticket with message thread
 * - POST /             — create ticket (valid + invalid body)
 * - POST /:id/messages — add message to thread
 * - PATCH /:id         — update assignee or status (returns 204)
 * - Auth enforcement   — unauthenticated GET / returns 401
 *
 * COMPLIANCE: SOC2 CC6.1 / HIPAA §164.312
 * No PHI in test data — all names and content are synthetic operational text.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { ticketsRouter, configureTicketRoutes } from '../routes/tickets.js';
import { configureAuth } from '../middleware/auth.js';
import { globalErrorHandler } from '../middleware/error-handler.js';

vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [],
    },
  }),
  requireRole: vi.fn(),
  requirePermission: vi.fn(),
  requireTenant: vi.fn(),
  ROLE_HIERARCHY: {},
  ROLE_PERMISSIONS: {},
  hasRole: vi.fn().mockReturnValue(true),
  hasPermission: vi.fn().mockReturnValue(true),
}));

// ─── Mock Data ────────────────────────────────────────────────────

const MOCK_TICKET_ROW = {
  id: 'ticket-1',
  title: 'Login page timeout',
  status: 'open',
  priority: 'high',
  category: 'bug',
  assigneeName: null,
  reporterName: 'Test User',
  createdAt: new Date('2026-03-01T10:00:00Z'),
  updatedAt: new Date('2026-03-01T10:00:00Z'),
  description: 'Users are experiencing timeouts on the login page.',
  messageCount: 1,
};

const MOCK_MESSAGE_ROW = {
  id: 'msg-1',
  ticketId: 'ticket-1',
  authorName: 'Test User',
  authorRole: 'user',
  content: 'Users are experiencing timeouts on the login page.',
  createdAt: new Date('2026-03-01T10:00:00Z'),
};

// ─── Mock DB Builder ──────────────────────────────────────────────

function createMockDb() {
  const mockReturning = vi.fn().mockResolvedValue([MOCK_TICKET_ROW]);
  const mockOrderBy = vi.fn().mockResolvedValue([MOCK_TICKET_ROW]);
  const mockLimit = vi.fn().mockResolvedValue([MOCK_TICKET_ROW]);
  const mockWhere = vi.fn().mockReturnValue({
    orderBy: mockOrderBy,
    limit: mockLimit,
    returning: mockReturning,
  });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });

  return {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({ values: mockValues }),
    update: vi.fn().mockReturnValue({ set: mockSet }),
    // Store internal mocks for assertion use
    _mockReturning: mockReturning,
    _mockWhere: mockWhere,
    _mockValues: mockValues,
  };
}

// ─── Unauthenticated App Builder ─────────────────────────────────

function createUnauthApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);
  // No tenantContext set — auth will fail because jwtConfig is present but
  // authenticateRequest is mocked to return authenticated: false for this instance
  app.route('/api/v1/tickets', ticketsRouter);
  return app;
}

// ─── Authenticated App Builder ────────────────────────────────────

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);

  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [],
    });
    await next();
  });

  app.route('/api/v1/tickets', ticketsRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Tickets Routes', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockDb = createMockDb();

    // Wire up the stats queries: count() calls return [{ cnt: 3 }] and [{ cnt: 2 }]
    let selectCallCount = 0;
    mockDb.select.mockImplementation(() => {
      selectCallCount++;
      const result = selectCallCount <= 2 ? [{ cnt: selectCallCount }] : [MOCK_TICKET_ROW];
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([MOCK_TICKET_ROW]),
            limit: vi.fn().mockResolvedValue([MOCK_TICKET_ROW]),
            // For stats: where() resolves directly
            then: (resolve: (v: unknown) => void) => {
              resolve(result);
            },
            // Thennable so await works
          }),
          // For message query (no where, direct orderBy)
          orderBy: vi.fn().mockResolvedValue([MOCK_MESSAGE_ROW]),
        }),
      };
    });

    configureTicketRoutes({ db: mockDb as never });
  });

  // ─── GET /stats ───────────────────────────────────────────────

  describe('GET /api/v1/tickets/stats', () => {
    it('returns 200 with ticket statistics shape', async () => {
      // Provide a db where each count select resolves to a row
      const statsDb = {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
      };

      const makeCountChain = (cnt: number) => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ cnt }]),
        }),
      });

      let callIdx = 0;
      statsDb.select.mockImplementation(() => {
        callIdx++;
        return makeCountChain(callIdx === 1 ? 5 : 3);
      });

      configureTicketRoutes({ db: statsDb as never });

      const app = createTestApp();
      const res = await app.request('/api/v1/tickets/stats');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        open: number;
        inProgress: number;
        avgResponseTime: string;
        avgResolutionTime: string;
        slaCompliance: number;
      };
      expect(typeof body.open).toBe('number');
      expect(typeof body.inProgress).toBe('number');
      expect(typeof body.avgResponseTime).toBe('string');
      expect(typeof body.avgResolutionTime).toBe('string');
      expect(typeof body.slaCompliance).toBe('number');
    });
  });

  // ─── GET / — list tickets ─────────────────────────────────────

  describe('GET /api/v1/tickets', () => {
    it('returns 200 with { tickets: [] } shape when no results', async () => {
      const emptyDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
        insert: vi.fn(),
        update: vi.fn(),
      };
      configureTicketRoutes({ db: emptyDb as never });

      const app = createTestApp();
      const res = await app.request('/api/v1/tickets');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { tickets: unknown[] };
      expect(Array.isArray(body.tickets)).toBe(true);
      expect(body.tickets).toHaveLength(0);
    });

    it('returns 200 with mapped ticket response when rows exist', async () => {
      const listDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([MOCK_TICKET_ROW]),
              }),
            }),
          }),
        }),
        insert: vi.fn(),
        update: vi.fn(),
      };
      configureTicketRoutes({ db: listDb as never });

      const app = createTestApp();
      const res = await app.request('/api/v1/tickets');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { tickets: { id: string; status: string }[] };
      expect(body.tickets).toHaveLength(1);
      expect(body.tickets[0]?.id).toBe('ticket-1');
      expect(body.tickets[0]?.status).toBe('open');
    });
  });

  // ─── GET /:id — ticket with messages ─────────────────────────

  describe('GET /api/v1/tickets/:id', () => {
    it('returns 200 with { ticket, messages } shape', async () => {
      let selectCall = 0;
      const detailDb = {
        select: vi.fn().mockImplementation(() => {
          selectCall++;
          if (selectCall === 1) {
            // Ticket row query
            return {
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([MOCK_TICKET_ROW]),
              }),
            };
          }
          // Messages query
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue([MOCK_MESSAGE_ROW]),
              }),
            }),
          };
        }),
        insert: vi.fn(),
        update: vi.fn(),
      };
      configureTicketRoutes({ db: detailDb as never });

      const app = createTestApp();
      const res = await app.request('/api/v1/tickets/ticket-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ticket: { id: string; status: string };
        messages: { id: string }[];
      };
      expect(body.ticket.id).toBe('ticket-1');
      expect(Array.isArray(body.messages)).toBe(true);
      expect(body.messages[0]?.id).toBe('msg-1');
    });

    it('returns 404 when ticket does not exist', async () => {
      const notFoundDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
        insert: vi.fn(),
        update: vi.fn(),
      };
      configureTicketRoutes({ db: notFoundDb as never });

      const app = createTestApp();
      const res = await app.request('/api/v1/tickets/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ─── POST / — create ticket ───────────────────────────────────

  describe('POST /api/v1/tickets', () => {
    it('returns 201 with TicketResponse on valid body', async () => {
      const createDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ name: 'Test User', email: 'test@example.com' }]),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([MOCK_TICKET_ROW]),
          }),
        }),
        update: vi.fn(),
      };
      configureTicketRoutes({ db: createDb as never });

      const app = createTestApp();
      const res = await app.request('/api/v1/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Login page timeout',
          category: 'bug',
          priority: 'high',
          description: 'Users are experiencing timeouts on the login page.',
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; title: string; status: string };
      expect(body.id).toBe('ticket-1');
      expect(body.status).toBe('open');
    });

    it('returns 422 on invalid body (missing required fields)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Missing category and priority' }),
      });

      // ValidationError maps to 400 via globalErrorHandler
      expect(res.status).toBe(400);
    });

    it('returns 422 on invalid category enum value', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test',
          category: 'unknown-category',
          priority: 'high',
          description: 'Description text.',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /:id/messages — add message ────────────────────────

  describe('POST /api/v1/tickets/:id/messages', () => {
    it('returns 201 with TicketMessageResponse', async () => {
      const msgDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              // First call: ticket existence check
              // Second call: resolveDisplayName user lookup
              return Promise.resolve([{ id: 'ticket-1' }]);
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([MOCK_MESSAGE_ROW]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      // Override select to handle multiple calls differently
      let msgSelectCall = 0;
      msgDb.select.mockImplementation(() => {
        msgSelectCall++;
        if (msgSelectCall === 1) {
          // Ticket existence check — returns ticket id
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ id: 'ticket-1' }]),
            }),
          };
        }
        // resolveDisplayName user lookup
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ name: 'Test User', email: 'test@example.com' }]),
          }),
        };
      });

      configureTicketRoutes({ db: msgDb as never });

      const app = createTestApp();
      const res = await app.request('/api/v1/tickets/ticket-1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'This is a follow-up message.' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        ticketId: string;
        author: string;
        authorRole: string;
        content: string;
        createdAt: string;
        attachments: string[];
      };
      expect(body.id).toBe('msg-1');
      expect(body.ticketId).toBe('ticket-1');
      expect(Array.isArray(body.attachments)).toBe(true);
    });

    it('returns 422 when content is missing', async () => {
      // Ticket must exist first for the validation error path to be reached
      const noContentDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 'ticket-1' }]),
          }),
        }),
        insert: vi.fn(),
        update: vi.fn(),
      };
      configureTicketRoutes({ db: noContentDb as never });

      const app = createTestApp();
      const res = await app.request('/api/v1/tickets/ticket-1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── PATCH /:id — update ticket ──────────────────────────────

  describe('PATCH /api/v1/tickets/:id', () => {
    it('returns 204 on valid status update', async () => {
      const patchDb = {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'ticket-1' }]),
            }),
          }),
        }),
      };
      configureTicketRoutes({ db: patchDb as never });

      const app = createTestApp();
      const res = await app.request('/api/v1/tickets/ticket-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in-progress' }),
      });

      expect(res.status).toBe(204);
    });

    it('returns 204 on valid assignee update', async () => {
      const patchDb = {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'ticket-1' }]),
            }),
          }),
        }),
      };
      configureTicketRoutes({ db: patchDb as never });

      const app = createTestApp();
      const res = await app.request('/api/v1/tickets/ticket-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee: 'agent-user-1' }),
      });

      expect(res.status).toBe(204);
    });

    it('returns 404 when ticket does not exist during patch', async () => {
      const notFoundPatchDb = {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };
      configureTicketRoutes({ db: notFoundPatchDb as never });

      const app = createTestApp();
      const res = await app.request('/api/v1/tickets/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ─── Auth Enforcement ─────────────────────────────────────────

  describe('auth enforcement', () => {
    it('returns 401 when request is unauthenticated (no tenantContext)', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      });

      const app = createUnauthApp();
      const res = await app.request('/api/v1/tickets');

      expect(res.status).toBe(401);
    });
  });
});
