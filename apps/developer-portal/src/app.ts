/**
 * Developer Portal — Hono Application Factory
 *
 * CRITICAL: Middleware order is security-first:
 * 1. Request ID — correlation tracking for all downstream middleware
 * 2. Security headers — defense-in-depth HTTP response headers
 * 3. CORS — configurable origins, NO wildcard in production
 * 4. Request logging — method, path, status, duration (NO bodies, NO PHI)
 * 5. Error handler — catches all, returns safe response with correlation ID
 *
 * Route groups:
 * - /health — unauthenticated health probes
 * - /docs — OpenAPI spec (unauthenticated, public documentation)
 * - /v1/developers — developer account management
 * - /v1/sandbox — sandbox tenant lifecycle
 * - /v1/webhook-test — webhook testing tools
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types.js';
import { developersRouter } from './routes/developers.js';
import { sandboxRouter } from './routes/sandbox.js';
import { webhookTestRouter } from './routes/webhooks.js';
import {
  AppError,
  InternalError,
  isAppError,
} from '@ordr/core';

// ---- App Factory -----------------------------------------------------------

export interface PortalAppConfig {
  readonly corsOrigins: readonly string[];
  readonly nodeEnv: string;
}

export function createPortalApp(config: PortalAppConfig): Hono<Env> {
  const app = new Hono<Env>();

  // ── 1. Request ID — MUST be first (all other middleware uses it) ────────
  app.use('*', async (c, next) => {
    const incomingId = c.req.header('x-request-id');
    const id = incomingId && incomingId.length > 0 ? incomingId : randomUUID();
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    await next();
  });

  // ── 2. Security headers — defense-in-depth ──────────────────────────────
  app.use('*', async (c, next) => {
    await next();
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-XSS-Protection', '0');
    c.header('Content-Security-Policy', "default-src 'self'");
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header('Cache-Control', 'no-store');
    c.res.headers.delete('X-Powered-By');
  });

  // ── 3. CORS — configurable origins, NO wildcard in production ───────────
  const allowedOrigins = config.nodeEnv === 'production'
    ? [...config.corsOrigins]
    : ['http://localhost:3000', 'http://localhost:5173', ...config.corsOrigins];

  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-Api-Key', 'X-Request-Id'],
      exposeHeaders: ['X-Request-Id', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
      credentials: true,
      maxAge: 600,
    }),
  );

  // ── 4. Request logging — method, path, status, duration ─────────────────
  app.use('*', logger());

  // ── 5. Error handler — catches all uncaught errors ──────────────────────
  app.onError((error, c) => {
    const requestId = c.get('requestId') ?? 'unknown';

    let appError: AppError;
    if (isAppError(error)) {
      appError = error;
      if (!appError.correlationId) {
        appError = new AppError(
          appError.message,
          appError.code,
          appError.statusCode,
          appError.isOperational,
          requestId,
        );
      }
    } else {
      appError = new InternalError(
        error instanceof Error ? error.message : 'Unknown error',
        requestId,
      );
    }

    // Log full error internally (NEVER expose to client)
    const logPayload = {
      correlationId: requestId,
      code: appError.code,
      statusCode: appError.statusCode,
      message: appError.message,
      isOperational: appError.isOperational,
      stack: error instanceof Error ? error.stack : undefined,
    };

    if (appError.isOperational) {
      console.warn('[ORDR:DEV-PORTAL] Operational error:', JSON.stringify(logPayload));
    } else {
      console.error('[ORDR:DEV-PORTAL] Unexpected error:', JSON.stringify(logPayload));
    }

    const safeResponse = appError.toSafeResponse();

    return c.json(
      {
        success: false as const,
        error: {
          code: safeResponse.error.code,
          message: safeResponse.error.message,
          correlationId: requestId,
        },
      },
      appError.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 451 | 500,
    );
  });

  // ── 6. 404 handler ──────────────────────────────────────────────────────
  app.notFound((c) => {
    const requestId = c.get('requestId') ?? 'unknown';
    return c.json(
      {
        success: false as const,
        error: {
          code: 'NOT_FOUND' as const,
          message: 'Route not found',
          correlationId: requestId,
        },
      },
      404,
    );
  });

  // ── Route Groups ────────────────────────────────────────────────────────

  // Health check — unauthenticated
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      service: 'developer-portal',
      version: '0.1.0',
      uptime: process.uptime(),
    });
  });

  // OpenAPI spec — unauthenticated (public documentation)
  // The spec is injected at startup via setOpenAPISpec
  app.get('/docs', (c) => {
    if (!openApiSpec) {
      return c.json({
        success: false as const,
        error: {
          code: 'NOT_FOUND' as const,
          message: 'OpenAPI spec not configured',
          correlationId: c.get('requestId') ?? 'unknown',
        },
      }, 404);
    }
    return c.json(openApiSpec);
  });

  // Developer account routes
  app.route('/v1/developers', developersRouter);

  // Sandbox routes
  app.route('/v1/sandbox', sandboxRouter);

  // Webhook test routes
  app.route('/v1/webhook-test', webhookTestRouter);

  return app;
}

// ---- OpenAPI Spec injection -------------------------------------------------

let openApiSpec: Record<string, unknown> | null = null;

export function setOpenAPISpec(spec: Record<string, unknown>): void {
  openApiSpec = spec;
}
