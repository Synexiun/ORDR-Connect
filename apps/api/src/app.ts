/**
 * Main Hono Application — middleware chain and route mounting
 *
 * CRITICAL: Middleware order is security-first:
 * 1. Request ID — correlation tracking for all downstream middleware
 * 2. Security headers — defense-in-depth HTTP response headers
 * 3. CORS — configurable origins, NO wildcard in production
 * 4. Request logging — method, path, status, duration (NO bodies, NO PHI)
 * 5. Rate limiting — per-tenant via auth context
 * 6. Audit — compliance trail for all state-changing operations
 * 7. Error handler — catches all, returns safe response with correlation ID
 *
 * Route groups:
 * - /health — unauthenticated health probes
 * - /api/v1/auth — authentication endpoints
 * - /api/v1/tenants — tenant management (placeholder)
 * - /api/v1/customers — customer CRUD with PHI encryption
 * - /api/v1/agents — agent session management, HITL queue
 * - /api/v1/webhooks — Twilio/SendGrid webhooks (signature auth, NOT JWT)
 * - /api/v1/messages — message listing and manual send
 * - /api/v1/analytics — OLAP analytics, real-time counters, trends
 * - /api/v1/developers — Developer portal (accounts, API keys, sandbox)
 * - /api/v1/marketplace — Agent marketplace (CRUD, installs, reviews)
 * - /api/v1/admin/marketplace — Agent security review pipeline (admin only)
 * - /api/v1/partners — Partner program (registration, earnings, payouts)
 * - /api/v1/ai — AI features (sentiment, insights, entity routing)
 * - /api/v1/compliance — Compliance dashboard (summary, violations, consent)
 * - /api/v1/events — SSE event stream (real-time dashboard updates)
 * - /api/v1/openapi.json — OpenAPI 3.1 specification (public, no auth)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types.js';
import { requestId } from './middleware/request-id.js';
import { securityHeaders } from './middleware/security-headers.js';
import { audit } from './middleware/audit.js';
import { globalErrorHandler } from './middleware/error-handler.js';
import { createTracingMiddleware } from '@ordr/observability';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { customersRouter } from './routes/customers.js';
import { agentsRouter } from './routes/agents.js';
import { webhooksRouter } from './routes/webhooks.js';
import { voiceWebhooksRouter } from './routes/webhooks-voice.js';
import { whatsappWebhooksRouter } from './routes/webhooks-whatsapp.js';
import { messagesRouter } from './routes/messages.js';
import { analyticsRouter } from './routes/analytics.js';
import { ssoRouter } from './routes/sso.js';
import { scimRouter } from './routes/scim.js';
import { organizationsRouter } from './routes/organizations.js';
import { rolesRouter } from './routes/roles.js';
import { brandingRouter } from './routes/branding.js';
import { developersRouter } from './routes/developers.js';
import { marketplaceRouter } from './routes/marketplace.js';
import { marketplaceReviewRouter } from './routes/marketplace-review.js';
import { partnersRouter } from './routes/partners.js';
import { aiRouter } from './routes/ai.js';
import { complianceDashboardRouter } from './routes/compliance-dashboard.js';
import { eventsRouter } from './routes/events.js';
import { notificationsRouter } from './routes/notifications.js';
import { healthcareRouter } from './routes/healthcare.js';
import { devUsageRouter } from './routes/developer-usage.js';
import { partnerStatsRouter } from './routes/partner-stats.js';
import { slaRouter } from './routes/sla.js';
import { teamRouter } from './routes/team.js';
import { profileRouter } from './routes/profile.js';
import { settingsRouter } from './routes/settings.js';
import { openapiRouter } from './routes/openapi.js';

// ---- App Factory -----------------------------------------------------------

export interface AppConfig {
  readonly corsOrigins: readonly string[];
  readonly nodeEnv: string;
}

export function createApp(config: AppConfig): Hono<Env> {
  const app = new Hono<Env>();

  // ── 1. Request ID — MUST be first (all other middleware uses it) ────────
  app.use('*', requestId);

  // ── 2. Security headers — defense-in-depth ──────────────────────────────
  app.use('*', securityHeaders);

  // ── 2.5. Distributed tracing — OTel span per request ──────────────────
  // MUST be early in chain so all downstream middleware/routes are traced.
  // Records: method, path, status, duration, tenant_id. NO bodies, NO PHI.
  app.use('*', createTracingMiddleware({ serviceName: 'ordr-api' }));

  // ── 3. CORS — configurable origins, NO wildcard in production ───────────
  const allowedOrigins =
    config.nodeEnv === 'production'
      ? [...config.corsOrigins]
      : ['http://localhost:3000', 'http://localhost:5173', ...config.corsOrigins];

  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'X-Request-Id'],
      exposeHeaders: ['X-Request-Id', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
      credentials: true,
      maxAge: 600, // 10 minutes preflight cache
    }),
  );

  // ── 4. Request logging — method, path, status, duration ─────────────────
  // SECURITY: Hono's built-in logger logs method, path, status, duration only.
  // It does NOT log request bodies or headers (no PHI leakage).
  app.use('*', logger());

  // ── 5. Audit middleware — compliance trail ───────────────────────────────
  app.use('*', audit);

  // ── 6. Error handler — catches all uncaught errors ──────────────────────
  app.onError(globalErrorHandler);

  // ── 7. 404 handler — structured response for unknown routes ─────────────
  app.notFound((c) => {
    const requestIdValue = c.get('requestId');
    return c.json(
      {
        success: false as const,
        error: {
          code: 'NOT_FOUND' as const,
          message: 'Route not found',
          correlationId: requestIdValue,
        },
      },
      404,
    );
  });

  // ── Route Groups ────────────────────────────────────────────────────────

  // Health checks — unauthenticated (accessible to LBs, K8s probes)
  app.route('/health', healthRouter);

  // Auth routes
  app.route('/api/v1/auth', authRouter);

  // Tenant routes (placeholder for future implementation)
  app.get('/api/v1/tenants', (c) => {
    return c.json({
      success: true as const,
      data: [],
      message: 'Tenant management routes — coming soon',
    });
  });

  // Customer routes
  app.route('/api/v1/customers', customersRouter);

  // Agent routes — session management, HITL queue
  app.route('/api/v1/agents', agentsRouter);

  // Webhook routes — NO auth middleware (signature validation instead)
  app.route('/api/v1/webhooks', webhooksRouter);

  // Voice webhook routes — Twilio Programmable Voice callbacks
  app.route('/api/v1/webhooks/twilio/voice', voiceWebhooksRouter);

  // WhatsApp webhook routes — Twilio WhatsApp Business API callbacks
  app.route('/api/v1/webhooks/twilio/whatsapp', whatsappWebhooksRouter);

  // Message routes — list, retrieve, send (metadata only, NO content)
  app.route('/api/v1/messages', messagesRouter);

  // Analytics routes — OLAP analytics, real-time counters, trends
  app.route('/api/v1/analytics', analyticsRouter);

  // SSO routes — Enterprise Single Sign-On
  app.route('/api/v1/sso', ssoRouter);

  // SCIM routes — Automated user provisioning (bearer token auth, NOT JWT)
  app.route('/api/v1/scim', scimRouter);

  // Organization routes — Org hierarchy management
  app.route('/api/v1/organizations', organizationsRouter);

  // Custom role routes — Tenant-specific role management
  app.route('/api/v1/roles', rolesRouter);

  // Branding routes — White-label configuration
  app.route('/api/v1/branding', brandingRouter);

  // Developer portal routes — account management, API keys, sandbox
  app.route('/api/v1/developers', developersRouter);

  // Marketplace routes — agent marketplace CRUD, installs, reviews
  app.route('/api/v1/marketplace', marketplaceRouter);

  // Marketplace admin routes — agent security review pipeline
  app.route('/api/v1/admin/marketplace', marketplaceReviewRouter);

  // Partner stats — monthly earnings, referral funnel (DB-backed)
  // NOTE: mounted before /api/v1/partners so /stats takes precedence
  app.route('/api/v1/partners/stats', partnerStatsRouter);

  // Partner program routes — registration, earnings, payouts
  app.route('/api/v1/partners', partnersRouter);

  // AI routes — sentiment analysis, agent insights, entity routing
  app.route('/api/v1/ai', aiRouter);

  // Compliance dashboard routes — summary, violations, consent status
  app.route('/api/v1/compliance', complianceDashboardRouter);

  // SSE events stream — real-time dashboard updates
  app.route('/api/v1/events', eventsRouter);

  // Notification center — HITL approvals, compliance alerts, SLA breaches
  app.route('/api/v1/notifications', notificationsRouter);

  // Healthcare dashboard — patient queue, appointments, care plans, compliance
  app.route('/api/v1/healthcare', healthcareRouter);

  // Developer usage stats — aggregate, daily breakdown, top endpoints
  // NOTE: mounted before /api/v1/developers so it takes precedence for /usage
  app.route('/api/v1/developers/usage', devUsageRouter);

  // SLA routes — breach status and manual trigger
  app.route('/api/v1/sla', slaRouter);

  // Team management — member listing, invite, role update, suspend, deactivate, activity
  app.route('/api/v1/team', teamRouter);

  // Profile — current user, password change, MFA, sessions, API tokens
  app.route('/api/v1/profile', profileRouter);

  // Settings — tenant config, SSO, roles, agents, channels, notifications, security
  app.route('/api/v1/settings', settingsRouter);

  // OpenAPI spec — public API documentation (no auth required)
  app.route('/api/v1/openapi.json', openapiRouter);

  return app;
}
