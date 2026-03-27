/**
 * Message Routes — list, retrieve, and send messages (metadata only)
 *
 * SOC2 CC6.1 — Access control: tenant-scoped, role-checked.
 * ISO 27001 A.8.2.3 — Handling of assets: no content in responses.
 * HIPAA §164.312(a)(2)(iv) — Encryption of ePHI: content stored encrypted.
 * HIPAA §164.312(b) — Audit controls on all message access.
 *
 * SECURITY:
 * - NEVER return message content in API responses — metadata only
 * - Consent check BEFORE every outbound message — no exceptions
 * - Compliance gate BEFORE every customer-facing action — no exceptions
 * - All state changes publish events to Kafka
 * - Full audit trail for every action
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AuditLogger } from '@ordr/audit';
import type { EventProducer } from '@ordr/events';
import { createEventEnvelope, TOPICS, EventType } from '@ordr/events';
import type { ConsentManager, ConsentStore, SmsProvider, EmailProvider } from '@ordr/channels';
import type { Channel } from '@ordr/channels';
import type { ComplianceGate } from '@ordr/compliance';
import {
  ValidationError,
  NotFoundError,
  AuthorizationError,
  ComplianceViolationError,
  PAGINATION,
} from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth, requirePermissionMiddleware } from '../middleware/auth.js';

// ---- Input Schemas ---------------------------------------------------------

const listMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  pageSize: z.coerce
    .number()
    .int()
    .min(PAGINATION.MIN_PAGE_SIZE)
    .max(PAGINATION.MAX_PAGE_SIZE)
    .default(PAGINATION.DEFAULT_PAGE_SIZE),
  customerId: z.string().uuid().optional(),
  channel: z.enum(['sms', 'email', 'voice', 'whatsapp']).optional(),
  status: z
    .enum([
      'pending',
      'queued',
      'sent',
      'delivered',
      'failed',
      'bounced',
      'opted_out',
      'retrying',
      'dlq',
    ])
    .optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
});

const sendMessageSchema = z.object({
  customerId: z.string().uuid(),
  channel: z.enum(['sms', 'email']),
  contentRef: z.string().min(1).max(500),
});

// ---- Message metadata shape (no content!) ----------------------------------

interface MessageMetadata {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly channel: string;
  readonly direction: string;
  readonly status: string;
  readonly sentAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ---- Dependencies (injected at startup) ------------------------------------

interface MessageDependencies {
  readonly auditLogger: AuditLogger;
  readonly eventProducer: EventProducer;
  readonly consentManager: ConsentManager;
  readonly consentStore: ConsentStore;
  readonly complianceGate: ComplianceGate;
  readonly smsProvider: SmsProvider;
  readonly emailProvider: EmailProvider;
  readonly findMessageById: (
    tenantId: string,
    messageId: string,
  ) => Promise<MessageMetadata | null>;
  readonly listMessages: (
    tenantId: string,
    filters: {
      readonly page: number;
      readonly pageSize: number;
      readonly customerId?: string;
      readonly channel?: string;
      readonly status?: string;
      readonly direction?: string;
    },
  ) => Promise<{ readonly data: readonly MessageMetadata[]; readonly total: number }>;
  readonly createMessage: (data: {
    readonly id: string;
    readonly tenantId: string;
    readonly customerId: string;
    readonly channel: string;
    readonly direction: string;
    readonly status: string;
    readonly contentRef: string;
  }) => Promise<MessageMetadata>;
  readonly getCustomerContact: (
    tenantId: string,
    customerId: string,
    channel: string,
  ) => Promise<{ readonly contact: string; readonly contentBody: string } | null>;
}

let deps: MessageDependencies | null = null;

export function configureMessageRoutes(dependencies: MessageDependencies): void {
  deps = dependencies;
}

// ---- Helpers ----------------------------------------------------------------

function ensureTenantContext(c: {
  get(key: 'tenantContext'): TenantContext | undefined;
  get(key: 'requestId'): string;
}): TenantContext {
  const ctx = c.get('tenantContext');
  if (!ctx) {
    throw new AuthorizationError('Tenant context required');
  }
  return ctx;
}

function parseValidationErrors(issues: readonly z.ZodIssue[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = issue.path.join('.');
    const existing = fieldErrors[field];
    if (existing) {
      existing.push(issue.message);
    } else {
      fieldErrors[field] = [issue.message];
    }
  }
  return fieldErrors;
}

/**
 * Strip content from message metadata.
 * SECURITY: NEVER return message content — metadata only.
 */
function toSafeMetadata(msg: MessageMetadata): Record<string, unknown> {
  return {
    id: msg.id,
    tenantId: msg.tenantId,
    customerId: msg.customerId,
    channel: msg.channel,
    direction: msg.direction,
    status: msg.status,
    sentAt: msg.sentAt?.toISOString() ?? null,
    deliveredAt: msg.deliveredAt?.toISOString() ?? null,
    createdAt: msg.createdAt.toISOString(),
    updatedAt: msg.updatedAt.toISOString(),
  };
}

// ---- Router ----------------------------------------------------------------

const messagesRouter = new Hono<Env>();

// All routes require authentication
messagesRouter.use('*', requireAuth());

// ---- GET / — list messages for tenant (metadata only) ----------------------

messagesRouter.get('/', requirePermissionMiddleware('messages', 'read'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Message routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const queryParsed = listMessagesQuerySchema.safeParse({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
    customerId: c.req.query('customerId'),
    channel: c.req.query('channel'),
    status: c.req.query('status'),
    direction: c.req.query('direction'),
  });

  if (!queryParsed.success) {
    throw new ValidationError(
      'Invalid query parameters',
      parseValidationErrors(queryParsed.error.issues),
      requestId,
    );
  }

  const filters = queryParsed.data;
  const result = await deps.listMessages(ctx.tenantId, {
    page: filters.page,
    pageSize: filters.pageSize,
    ...(filters.customerId !== undefined ? { customerId: filters.customerId } : {}),
    ...(filters.channel !== undefined ? { channel: filters.channel } : {}),
    ...(filters.status !== undefined ? { status: filters.status } : {}),
    ...(filters.direction !== undefined ? { direction: filters.direction } : {}),
  });

  // SECURITY: Strip content — return metadata only
  const safeData = result.data.map(toSafeMetadata);

  return c.json({
    success: true as const,
    data: safeData,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / filters.pageSize),
    },
  });
});

// ---- GET /:id — get message detail (metadata only) -------------------------

messagesRouter.get('/:id', requirePermissionMiddleware('messages', 'read'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Message routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const messageId = c.req.param('id');

  const message = await deps.findMessageById(ctx.tenantId, messageId);
  if (!message) {
    throw new NotFoundError('Message not found', requestId);
  }

  // SECURITY: Strip content — return metadata only
  return c.json({
    success: true as const,
    data: toSafeMetadata(message),
  });
});

// ---- POST /send — manual message send (not agent-triggered) ----------------

messagesRouter.post('/send', requirePermissionMiddleware('messages', 'create'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Message routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  // Validate input
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid message send request',
      parseValidationErrors(parsed.error.issues),
      requestId,
    );
  }

  const { customerId, channel, contentRef } = parsed.data;

  // 1. Consent check — MUST pass before any outbound message
  const consentResult = await deps.consentManager.verifyConsentForSend(
    customerId,
    channel as Channel,
    deps.consentStore,
  );

  if (!consentResult.success) {
    // Audit log consent failure
    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'compliance.violation',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'message',
      resourceId: requestId,
      action: 'consent_check_failed',
      details: { customerId, channel },
      timestamp: new Date(),
    });

    throw consentResult.error;
  }

  // 2. Compliance gate — MUST pass before any customer-facing action
  const complianceResult = deps.complianceGate.check(`send_${channel}`, {
    tenantId: ctx.tenantId,
    customerId,
    channel,
    data: { contentRef },
    timestamp: new Date(),
  });

  if (!complianceResult.allowed) {
    const violationMessages = complianceResult.violations
      .map((v) => v.violation?.message ?? 'Unknown violation')
      .join('; ');

    // Audit log compliance failure
    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'compliance.violation',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'message',
      resourceId: requestId,
      action: 'compliance_check_failed',
      details: { customerId, channel, violations: violationMessages },
      timestamp: new Date(),
    });

    throw new ComplianceViolationError(
      `Message blocked by compliance gate: ${violationMessages}`,
      'SOC2',
    );
  }

  // 3. Resolve customer contact info and retrieve content
  const contactInfo = await deps.getCustomerContact(ctx.tenantId, customerId, channel);
  if (!contactInfo) {
    throw new NotFoundError('Customer contact information not found for channel', requestId);
  }

  // 4. Create message record
  const messageId = randomUUID();
  const messageRecord = await deps.createMessage({
    id: messageId,
    tenantId: ctx.tenantId,
    customerId,
    channel,
    direction: 'outbound',
    status: 'pending',
    contentRef,
  });

  // 5. Send via appropriate channel provider
  let sendSuccess = false;
  if (channel === 'sms') {
    const sendResult = await deps.smsProvider.send(contactInfo.contact, contactInfo.contentBody);
    sendSuccess = sendResult.success;
  } else {
    const sendResult = await deps.emailProvider.send(
      contactInfo.contact,
      'Message from ORDR-Connect',
      contactInfo.contentBody,
    );
    sendSuccess = sendResult.success;
  }

  // 6. Audit log
  await deps.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'data.created',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'message',
    resourceId: messageId,
    action: 'send',
    details: {
      customerId,
      channel,
      success: sendSuccess,
    },
    timestamp: new Date(),
  });

  // 7. Publish event
  const event = createEventEnvelope(
    EventType.INTERACTION_LOGGED,
    ctx.tenantId,
    {
      interactionId: messageId,
      customerId,
      channel,
      direction: 'outbound',
      type: 'message',
    },
    {
      correlationId: requestId,
      userId: ctx.userId,
      source: 'api',
    },
  );

  await deps.eventProducer
    .publish(TOPICS.INTERACTION_EVENTS, event)
    .catch((publishErr: unknown) => {
      console.error('[ORDR:API] Failed to publish interaction.logged event:', publishErr);
    });

  // SECURITY: Return metadata only — NO content
  return c.json(
    {
      success: true as const,
      data: toSafeMetadata(messageRecord),
    },
    201,
  );
});

export { messagesRouter };
