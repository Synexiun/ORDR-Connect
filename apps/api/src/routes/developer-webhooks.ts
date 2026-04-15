// apps/api/src/routes/developer-webhooks.ts
/**
 * Developer Webhook Routes — CRUD for developer webhook registrations
 *
 * SOC2 CC6.1 — developer-scoped, ownership enforced on all mutations.
 * Rule 1 — HMAC secrets AES-256-GCM encrypted before storage.
 * Rule 2 — raw secret returned ONCE at creation, never again.
 * Rule 3 — all state changes WORM audit-logged.
 * Rule 4 — SSRF protection + https:// enforcement on webhook URLs.
 *
 * Endpoints:
 * GET    /v1/developers/webhooks                       — list webhooks
 * POST   /v1/developers/webhooks                       — create webhook (returns hmacSecret once)
 * DELETE /v1/developers/webhooks/:webhookId            — hard delete
 * PATCH  /v1/developers/webhooks/:webhookId/toggle     — enable/disable
 */

import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import type { FieldEncryptor } from '@ordr/crypto';
import { NotFoundError, ValidationError } from '@ordr/core';
import { DELIVERABLE_EVENTS } from '@ordr/events';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0/,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some((re) => re.test(ip));
}

async function isUrlSsrfSafe(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.localhost')
    ) {
      return false;
    }
    const result = await Promise.race<{ address: string }>([
      dns.lookup(hostname) as Promise<{ address: string }>,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('DNS timeout'));
        }, 5000);
      }),
    ]);
    return !isPrivateIp(result.address);
  } catch {
    return false;
  }
}

const createWebhookSchema = z.object({
  url: z
    .string()
    .url('Must be a valid URL')
    .max(2048, 'URL must not exceed 2048 characters')
    .refine((url) => url.startsWith('https://'), {
      message: 'URL must use https://',
    })
    .refine(async (url) => isUrlSsrfSafe(url), {
      message: 'URL is not allowed (private or internal addresses are blocked)',
    }),
  events: z
    .array(z.enum(DELIVERABLE_EVENTS as unknown as [string, ...string[]]))
    .min(1, 'At least one event is required')
    .max(20, 'Maximum 20 events per webhook'),
});

const toggleSchema = z.object({
  active: z.boolean(),
});

const MAX_WEBHOOKS_PER_DEVELOPER = 10;

interface WebhookRecord {
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

interface WebhookDeps {
  readonly auditLogger: AuditLogger;
  readonly fieldEncryptor: FieldEncryptor;
  readonly createWebhook: (data: {
    developerId: string;
    url: string;
    events: string[];
    hmacSecretEncrypted: string;
  }) => Promise<WebhookRecord>;
  readonly listWebhooks: (developerId: string) => Promise<WebhookRecord[]>;
  readonly countActiveWebhooks: (developerId: string) => Promise<number>;
  readonly findWebhook: (developerId: string, webhookId: string) => Promise<WebhookRecord | null>;
  readonly deleteWebhook: (developerId: string, webhookId: string) => Promise<void>;
  readonly toggleWebhook: (
    developerId: string,
    webhookId: string,
    active: boolean,
  ) => Promise<WebhookRecord>;
}

let deps: WebhookDeps | null = null;

export function configureWebhookRoutes(dependencies: WebhookDeps): void {
  deps = dependencies;
}

function toSafeWebhook(wh: WebhookRecord) {
  return {
    id: wh.id,
    url: wh.url,
    events: wh.events,
    active: wh.active,
    lastTriggeredAt: wh.lastTriggeredAt,
    createdAt: wh.createdAt,
  };
}

function ensureCtx(c: {
  get(key: 'tenantContext'): { userId: string } | undefined;
  get(key: 'requestId'): string;
}): {
  userId: string;
  requestId: string;
} {
  const ctx = c.get('tenantContext');
  if (!ctx) throw new Error('[ORDR:API] Auth required');
  return { userId: ctx.userId, requestId: c.get('requestId') };
}

export const developerWebhooksRouter = new Hono<Env>();

developerWebhooksRouter.get('/', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Webhook routes not configured');
  const { userId } = ensureCtx(c);
  const webhooks = await deps.listWebhooks(userId);
  return c.json({ success: true as const, data: webhooks.map(toSafeWebhook) });
});

developerWebhooksRouter.post('/', requireAuth(), rateLimit('write'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Webhook routes not configured');
  const { userId, requestId } = ensureCtx(c);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = await createWebhookSchema.safeParseAsync(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid webhook data',
      {
        url: parsed.error.issues.filter((i) => i.path[0] === 'url').map((i) => i.message),
        events: parsed.error.issues.filter((i) => i.path[0] === 'events').map((i) => i.message),
      },
      requestId,
    );
  }

  const { url, events } = parsed.data;

  const activeCount = await deps.countActiveWebhooks(userId);
  if (activeCount >= MAX_WEBHOOKS_PER_DEVELOPER) {
    return c.json(
      {
        success: false as const,
        message: `Webhook limit reached (max ${String(MAX_WEBHOOKS_PER_DEVELOPER)} active)`,
        requestId,
      },
      422,
    );
  }

  const rawSecret = randomBytes(32).toString('hex');
  const hmacSecretEncrypted = deps.fieldEncryptor.encryptField('hmac_secret', rawSecret);
  const webhook = await deps.createWebhook({
    developerId: userId,
    url,
    events,
    hmacSecretEncrypted,
  });

  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.created',
    actorType: 'user',
    actorId: userId,
    resource: 'developer_webhooks',
    resourceId: webhook.id,
    action: 'create_webhook',
    details: { url, eventCount: events.length },
    timestamp: new Date(),
  });

  return c.json(
    { success: true as const, data: { ...toSafeWebhook(webhook), hmacSecret: rawSecret } },
    201,
  );
});

developerWebhooksRouter.delete('/:webhookId', requireAuth(), rateLimit('write'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Webhook routes not configured');
  const { userId, requestId } = ensureCtx(c);
  const webhookId = c.req.param('webhookId');

  const webhook = await deps.findWebhook(userId, webhookId);
  if (!webhook) throw new NotFoundError('Webhook not found', requestId);

  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.deleted',
    actorType: 'user',
    actorId: userId,
    resource: 'developer_webhooks',
    resourceId: webhookId,
    action: 'delete_webhook',
    details: { url: webhook.url },
    timestamp: new Date(),
  });

  await deps.deleteWebhook(userId, webhookId);
  return c.json({ success: true as const });
});

developerWebhooksRouter.patch(
  '/:webhookId/toggle',
  requireAuth(),
  rateLimit('write'),
  async (c) => {
    if (!deps) throw new Error('[ORDR:API] Webhook routes not configured');
    const { userId, requestId } = ensureCtx(c);
    const webhookId = c.req.param('webhookId');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = toggleSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid toggle data',
        {
          active: parsed.error.issues.map((i) => i.message),
        },
        requestId,
      );
    }

    const existing = await deps.findWebhook(userId, webhookId);
    if (!existing) throw new NotFoundError('Webhook not found', requestId);

    const updated = await deps.toggleWebhook(userId, webhookId, parsed.data.active);

    await deps.auditLogger.log({
      tenantId: 'developer-portal',
      eventType: 'data.updated',
      actorType: 'user',
      actorId: userId,
      resource: 'developer_webhooks',
      resourceId: webhookId,
      action: 'toggle_webhook',
      details: { active: parsed.data.active },
      timestamp: new Date(),
    });

    return c.json({ success: true as const, data: toSafeWebhook(updated) });
  },
);
