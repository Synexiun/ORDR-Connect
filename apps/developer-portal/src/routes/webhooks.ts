/**
 * Webhook Testing Routes — echo and event simulation for developers
 *
 * SOC2 CC7.1 — Monitoring: webhook simulation with full audit trail.
 * ISO 27001 A.14.2.8 — System security testing.
 *
 * Provides developer-facing tools for testing webhook integrations:
 * - Echo endpoint: returns request body with metadata for debugging
 * - Simulate endpoint: generates realistic webhook events and delivers them
 *
 * SECURITY:
 * - All webhook test actions are audit-logged (Rule 3)
 * - Body hashes use SHA-256 for integrity verification
 * - Only known event types are allowed (Rule 4)
 */

import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import {
  ValidationError,
  AuthenticationError,
} from '@ordr/core';
import type { Env, DeveloperContext } from '../types.js';
import { requireApiKey } from '../middleware/api-key-auth.js';

// ---- Constants --------------------------------------------------------------

const SUPPORTED_EVENTS = [
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'agent.completed',
  'agent.failed',
  'compliance.violation',
  'message.delivered',
  'message.failed',
] as const;

type SupportedEvent = (typeof SUPPORTED_EVENTS)[number];

// ---- Input Schemas ----------------------------------------------------------

const simulateEventSchema = z.object({
  webhookUrl: z.string().url().max(2048).optional(),
});

// ---- Types ------------------------------------------------------------------

interface WebhookDependencies {
  readonly auditLogger: AuditLogger;
  readonly deliverWebhook?: ((url: string, payload: Record<string, unknown>) => Promise<boolean>) | undefined;
}

let deps: WebhookDependencies | null = null;

export function configureWebhookRoutes(dependencies: WebhookDependencies): void {
  deps = dependencies;
}

// ---- Helpers ----------------------------------------------------------------

function ensureDeveloperContext(c: {
  get(key: 'developerContext'): DeveloperContext | undefined;
  get(key: 'requestId'): string;
}): DeveloperContext {
  const ctx = c.get('developerContext');
  if (!ctx) {
    throw new AuthenticationError('Developer authentication required');
  }
  return ctx;
}

function computeBodyHash(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

function isSupportedEvent(event: string): event is SupportedEvent {
  return (SUPPORTED_EVENTS as readonly string[]).includes(event);
}

function generateSamplePayload(eventType: SupportedEvent): Record<string, unknown> {
  const timestamp = new Date().toISOString();

  switch (eventType) {
    case 'customer.created':
      return {
        event: 'customer.created',
        timestamp,
        data: {
          customerId: 'cust_sample_001',
          name: '[SAMPLE] Jane Doe',
          email: 'jane@example.com',
          type: 'individual',
          lifecycleStage: 'lead',
        },
      };
    case 'customer.updated':
      return {
        event: 'customer.updated',
        timestamp,
        data: {
          customerId: 'cust_sample_001',
          changes: { lifecycleStage: { old: 'lead', new: 'qualified' } },
        },
      };
    case 'customer.deleted':
      return {
        event: 'customer.deleted',
        timestamp,
        data: { customerId: 'cust_sample_001' },
      };
    case 'agent.completed':
      return {
        event: 'agent.completed',
        timestamp,
        data: {
          sessionId: 'sess_sample_001',
          agentRole: 'outreach',
          actionsTaken: 3,
          durationMs: 4500,
        },
      };
    case 'agent.failed':
      return {
        event: 'agent.failed',
        timestamp,
        data: {
          sessionId: 'sess_sample_002',
          agentRole: 'compliance',
          errorCode: 'CONFIDENCE_BELOW_THRESHOLD',
        },
      };
    case 'compliance.violation':
      return {
        event: 'compliance.violation',
        timestamp,
        data: {
          ruleId: 'rule_hipaa_phi_exposure',
          regulation: 'HIPAA',
          severity: 'high',
          description: '[SAMPLE] PHI detected in outbound message',
        },
      };
    case 'message.delivered':
      return {
        event: 'message.delivered',
        timestamp,
        data: {
          messageId: 'msg_sample_001',
          channel: 'sms',
          recipientHash: 'sha256:abc123',
          deliveredAt: timestamp,
        },
      };
    case 'message.failed':
      return {
        event: 'message.failed',
        timestamp,
        data: {
          messageId: 'msg_sample_002',
          channel: 'email',
          errorCode: 'BOUNCE_HARD',
          description: 'Email address not found',
        },
      };
  }
}

// ---- Router -----------------------------------------------------------------

const webhookTestRouter = new Hono<Env>();

// All webhook test routes require API key authentication
webhookTestRouter.use('*', requireApiKey());

// ── POST /v1/webhook-test/echo — echo request body with metadata ─────────

webhookTestRouter.post('/echo', async (c) => {
  if (!deps) throw new Error('[ORDR:DEV-PORTAL] Webhook routes not configured');

  const ctx = ensureDeveloperContext(c);
  const requestId = c.get('requestId') ?? 'unknown';

  // Read raw body
  const rawBody = await c.req.text();
  const bodyHash = computeBodyHash(rawBody);

  // Parse body as JSON if possible
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    parsedBody = rawBody;
  }

  // Collect headers (exclude sensitive ones)
  const receivedHeaders: Record<string, string> = {};
  const sensitiveHeaders = new Set(['authorization', 'x-api-key', 'cookie']);

  c.req.raw.headers.forEach((value, key) => {
    if (!sensitiveHeaders.has(key.toLowerCase())) {
      receivedHeaders[key] = value;
    }
  });

  // Audit log
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'api.request',
    actorType: 'user',
    actorId: ctx.developerId,
    resource: 'webhook_test',
    resourceId: requestId,
    action: 'echo',
    details: { bodyHash },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      echo: parsedBody,
      metadata: {
        timestamp: new Date().toISOString(),
        headersReceived: receivedHeaders,
        bodyHash,
        bodyLength: rawBody.length,
        requestId,
      },
    },
  });
});

// ── POST /v1/webhook-test/simulate/:event — simulate webhook event ───────

webhookTestRouter.post('/simulate/:event', async (c) => {
  if (!deps) throw new Error('[ORDR:DEV-PORTAL] Webhook routes not configured');

  const ctx = ensureDeveloperContext(c);
  const requestId = c.get('requestId') ?? 'unknown';

  const eventType = c.req.param('event');

  // Validate event type
  if (!isSupportedEvent(eventType)) {
    throw new ValidationError(
      `Unknown event type: ${eventType}`,
      {
        event: [
          `Must be one of: ${SUPPORTED_EVENTS.join(', ')}`,
        ],
      },
      requestId,
    );
  }

  // Parse optional webhook URL from body
  const body = await c.req.json().catch(() => ({}));
  const parsed = simulateEventSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.');
      const existing = fieldErrors[field];
      if (existing) {
        existing.push(issue.message);
      } else {
        fieldErrors[field] = [issue.message];
      }
    }
    throw new ValidationError('Invalid simulation request', fieldErrors, requestId);
  }

  // Generate sample payload
  const samplePayload = generateSamplePayload(eventType);
  const payloadJson = JSON.stringify(samplePayload);
  const payloadHash = computeBodyHash(payloadJson);

  // Deliver to webhook URL if provided
  let delivered = false;
  if (parsed.data.webhookUrl && deps.deliverWebhook) {
    try {
      delivered = await deps.deliverWebhook(parsed.data.webhookUrl, samplePayload);
    } catch {
      delivered = false;
    }
  }

  // Audit log
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'api.request',
    actorType: 'user',
    actorId: ctx.developerId,
    resource: 'webhook_test',
    resourceId: requestId,
    action: 'simulate',
    details: {
      eventType,
      payloadHash,
      delivered,
      webhookUrl: parsed.data.webhookUrl ? '[redacted]' : undefined,
    },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      eventType,
      payload: samplePayload,
      payloadHash,
      delivered,
      deliveredTo: parsed.data.webhookUrl ? '[provided]' : null,
      timestamp: new Date().toISOString(),
    },
  });
});

export { webhookTestRouter, SUPPORTED_EVENTS };
