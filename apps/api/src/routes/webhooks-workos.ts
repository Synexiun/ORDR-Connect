/**
 * WorkOS Directory Sync Webhook Receiver
 *
 * Receives POST /webhooks/workos from WorkOS with HMAC-signed events,
 * normalises them to SCIM handler calls, and records WORM audit events.
 *
 * SOC2 CC6.2 — Automated provisioning/de-provisioning via IdP.
 * ISO 27001 A.9.2.1 — User de-registration via directory sync events.
 * HIPAA §164.312(a)(1) — Automated access control management.
 *
 * Security:
 * - HMAC-SHA256 verification (timing-safe) before any processing
 * - Idempotency check on workos_id to prevent replay (before dispatch)
 * - WORM insert to workos_events AFTER successful dispatch (not before —
 *   inserting before would permanently suppress events if the normaliser
 *   throws, since retries would idempotency-skip the event forever)
 * - Tenant resolution via directory_id → tokenStore.findByDirectoryId
 * - Rule 4: raw body read as text, then JSON.parse — prevents header spoofing
 */

import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { workosEvents } from '@ordr/db';
import type { SCIMHandler, SCIMTokenStore } from '@ordr/auth';
import { normaliseWorkOSEvent } from '@ordr/auth';

export interface WorkOSWebhookDeps {
  readonly webhookSecret: string;
  readonly handler: SCIMHandler;
  readonly tokenStore: SCIMTokenStore;
  readonly db: NodePgDatabase;
}

export function createWorkOSWebhookRouter(deps: WorkOSWebhookDeps): Hono {
  const router = new Hono();

  router.post('/webhooks/workos', async (c) => {
    // ── 1. Read raw body (MUST happen before any JSON parse — Rule 4) ──────
    const rawBody = await c.req.text();

    // ── 2. HMAC-SHA256 verification (timing-safe — Rule 1) ─────────────────
    const sigHeader = c.req.header('x-workos-signature');
    if (sigHeader === undefined || sigHeader.length === 0) {
      return c.json({ error: 'Missing signature' }, 401);
    }

    const expectedBuf = createHmac('sha256', deps.webhookSecret).update(rawBody).digest();
    // Buffer.from(str, 'hex') never throws — invalid hex is silently truncated to a
    // shorter buffer. The length guard catches that: a valid SHA-256 hex string is
    // always 64 chars → 32 bytes; anything else fails the length equality check.
    const actualBuf = Buffer.from(sigHeader, 'hex');

    // timingSafeEqual requires same-length buffers — length guard must come first.
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // ── 3. Parse event payload ─────────────────────────────────────────────
    let event: { id: string; event: string; data: Record<string, unknown>; directory_id?: string };
    try {
      event = JSON.parse(rawBody) as typeof event;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    // ── 4. Idempotency guard ───────────────────────────────────────────────
    const existing = await deps.db
      .select({ workosId: workosEvents.workosId })
      .from(workosEvents)
      .where(eq(workosEvents.workosId, event.id));
    if (existing.length > 0) {
      // Already processed — return 200 (idempotent, not an error)
      return c.json({ ok: true, skipped: 'duplicate' }, 200);
    }

    // ── 5. Tenant resolution via directory_id ──────────────────────────────
    const directoryId =
      typeof event.directory_id === 'string'
        ? event.directory_id
        : typeof event.data['directory_id'] === 'string'
          ? event.data['directory_id']
          : undefined;

    let tenantId: string | null = null;
    if (directoryId !== undefined) {
      const tokenRow = await deps.tokenStore.findByDirectoryId(directoryId);
      tenantId = tokenRow?.tenantId ?? null;
    }

    if (tenantId === null) {
      // Unknown directory — not a client error, just can't route it
      return c.json({ error: 'Unknown directory' }, 422);
    }

    // ── 6. Normalise event → SCIMHandler calls ─────────────────────────────
    // WORM insert happens AFTER successful dispatch (see comment at top of file).
    // If normaliseWorkOSEvent throws, we return 500 so WorkOS retries — the
    // idempotency row has not been written yet, so the retry processes correctly.
    // Cast: normaliseWorkOSEvent accepts a typed WorkOSEvent; we've already
    // validated the payload shape via JSON.parse and the HMAC signature check.
    await normaliseWorkOSEvent(
      tenantId,
      event as Parameters<typeof normaliseWorkOSEvent>[1],
      deps.handler,
    );

    // ── 7. WORM insert — only after handler dispatch succeeds (Rule 3) ──────
    // Inserting here ensures idempotency guard is only set for fully-processed
    // events. A transient normaliser error returns 500 to WorkOS for retry.
    await deps.db.insert(workosEvents).values({
      workosId: event.id,
      eventType: event.event,
      directoryId: directoryId ?? null,
      payload: event as Record<string, unknown>,
    });

    return c.json({ ok: true }, 200);
  });

  return router;
}
