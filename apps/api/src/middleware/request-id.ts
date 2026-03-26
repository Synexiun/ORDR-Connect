/**
 * Request ID Middleware — attaches a UUID v4 correlation ID to every request
 *
 * SOC2 CC7.2 — Monitoring: correlate requests across the entire stack.
 * ISO 27001 A.12.4.1 — Event logging with unique identifiers.
 *
 * Generates a new UUID v4 for each request, sets it as the X-Request-Id
 * response header, and stores it in the Hono context for downstream use.
 */

import { randomUUID } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import type { Env } from '../types.js';

export const requestId = createMiddleware<Env>(async (c, next) => {
  // Accept client-provided request ID if present (for distributed tracing),
  // otherwise generate a new one
  const incomingId = c.req.header('x-request-id');
  const id = incomingId && incomingId.length > 0 ? incomingId : randomUUID();

  c.set('requestId', id);

  // Set response header before downstream processing
  c.header('X-Request-Id', id);

  await next();
});
