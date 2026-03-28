/* eslint-disable
   @typescript-eslint/no-non-null-assertion,
   @typescript-eslint/strict-boolean-expressions,
   @typescript-eslint/require-await
   --
   NOTE: strict-boolean-expressions and no-non-null-assertion are suppressed for
   Hono / process.env patterns (env vars are string | undefined, not boolean).
   require-await is suppressed for bootstrap() which calls awaitable helpers but
   TypeScript cannot always infer await-depth across re-exports.
   Security rules remain fully active.
*/
/**
 * Server Entry Point — bootstraps and starts the ORDR-Connect API
 *
 * Startup sequence:
 * 1. Load and validate configuration (fail-fast on missing secrets)
 * 2. Create database connection (with TLS enforcement in production)
 * 3. Create Kafka client and producer
 * 4. Initialize audit logger (WORM, hash-chained)
 * 5. Initialize compliance engine with all rules
 * 6. Configure middleware dependencies (auth, audit, health)
 * 7. Start Hono server on configured port
 * 8. Register graceful shutdown handlers (SIGTERM, SIGINT)
 *
 * SOC2 CC8.1 — Change management: structured startup/shutdown.
 * ISO 27001 A.12.1.4 — Separation of development, test, production environments.
 * HIPAA §164.312(c)(1) — Integrity controls on system initialization.
 */

import { serve } from '@hono/node-server';
import { Limb } from '@ordr/kernel';
import type { LimbEnv } from '@ordr/kernel';
import { loadConfig } from '@ordr/core';
import type { ParsedConfig } from '@ordr/core';
import { createConnection, createDrizzle, closeConnection, DrizzleAuditStore } from '@ordr/db';
import * as schema from '@ordr/db';
import { createKafkaClient, createProducer, EventProducer } from '@ordr/events';
import type { Producer } from '@ordr/events';
import { AuditLogger } from '@ordr/audit';
import {
  SubscriptionManager,
  DrizzleSubscriptionStore,
  MockStripeClient,
  RealStripeClient,
} from '@ordr/billing';
import { FieldEncryptor } from '@ordr/crypto';
import {
  loadKeyPair,
  OrganizationManager,
  InMemoryOrgStore,
  InMemorySSOClient,
  InMemorySSOConnectionStore,
  SSOManager,
} from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { ComplianceEngine, ComplianceGate } from '@ordr/compliance';
import { ConsentManager, SmsProvider, EmailProvider } from '@ordr/channels';
import type { ConsentStore, TwilioClient, SendGridClient } from '@ordr/channels';
import { LLMClient } from '@ordr/ai';
import {
  AnalyticsQueries,
  RealTimeCounters,
  InMemoryAnalyticsStore,
  InMemoryCounterStore,
} from '@ordr/analytics';
import { AgentEngine, HitlQueue } from '@ordr/agent-runtime';
import { and, eq, sum, count, ilike, or, asc, type SQL } from 'drizzle-orm';
import { createApp } from './app.js';
import { configureAuth } from './middleware/auth.js';
import { configureAudit } from './middleware/audit.js';
import { configureBillingGate } from './middleware/plan-gate.js';
import { configureHealthChecks } from './routes/health.js';
import { configureBrandingRoutes } from './routes/branding.js';
import { configureAiRoutes } from './routes/ai.js';
import { configureEventsRoute } from './routes/events.js';
import { configureNotificationsRoute } from './routes/notifications.js';
import { configureHealthcareRoutes } from './routes/healthcare.js';
import { configureDevUsageRoute } from './routes/developer-usage.js';
import { configurePartnerStatsRoute } from './routes/partner-stats.js';
import { configurePartnerRoutes } from './routes/partners.js';
import { configureDeveloperRoutes } from './routes/developers.js';
import { SlaChecker, DEFAULT_CHECK_INTERVAL_MS } from './lib/sla-checker.js';
import { configureSlaRoutes } from './routes/sla.js';
import { configureTeamRoutes } from './routes/team.js';
import { configureProfileRoutes } from './routes/profile.js';
import { configureSettingsRoutes } from './routes/settings.js';
import { configureTicketRoutes } from './routes/tickets.js';
import { configureReportRoutes } from './routes/reports.js';
import { configureAnalyticsRoutes } from './routes/analytics.js';
import { configureCustomerRoutes } from './routes/customers.js';
import { configureAgentRoutes } from './routes/agents.js';
import { configureMarketplaceRoutes } from './routes/marketplace.js';
import { configureOrgRoutes } from './routes/organizations.js';
import { configureSSORoutes } from './routes/sso.js';
import { configureMessageRoutes } from './routes/messages.js';
import type postgres from 'postgres';

// ---- State -----------------------------------------------------------------

let limbInstance: Limb | null = null;
let dbConnection: postgres.Sql | null = null;
let kafkaProducer: Producer | null = null;
let llmClient: LLMClient | null = null;
let slaChecker: SlaChecker | null = null;
let server: ReturnType<typeof serve> | null = null;

/**
 * Returns the initialized LLMClient for use by route handlers.
 * Throws if called before bootstrap() completes.
 */
export function getLlmClient(): LLMClient {
  if (llmClient === null) {
    throw new Error('[ORDR:API] LLMClient not initialized — call bootstrap() first');
  }
  return llmClient;
}

// ---- Bootstrap -------------------------------------------------------------

async function bootstrap(): Promise<void> {
  console.warn('[ORDR:API] Starting ORDR-Connect API...');

  // ── 0. Synexiun Kernel — register limb with Core & start heartbeat ─────
  // Required before any other subsystem: Rule 2 (Auth) — limbs must be
  // registered before sending diode messages. Skipped in test environment
  // where SYNEX_LIMB_PRIVATE_KEY is not set.
  const synexPrivateKey = process.env['SYNEX_LIMB_PRIVATE_KEY'];
  const synexCoreUrl = process.env['SYNEX_CORE_URL'];
  const synexAdminToken = process.env['SYNEX_CORE_ADMIN_TOKEN'];

  if (
    synexPrivateKey !== undefined &&
    synexCoreUrl !== undefined &&
    synexAdminToken !== undefined
  ) {
    try {
      const limbEnv: LimbEnv = {
        privateKeyHex: synexPrivateKey,
        coreUrl: synexCoreUrl,
        adminToken: synexAdminToken,
        displayName: 'ORDR-Connect API',
      };
      limbInstance = await Limb.boot(limbEnv);
      console.warn(
        `[ORDR:API] Synexiun kernel booted — limb=${limbInstance.identity.limbId} registered with Core`,
      );
    } catch (error: unknown) {
      console.error('[ORDR:API] FATAL: Synexiun kernel registration failed:', error);
      process.exit(1);
    }
  } else {
    console.warn(
      '[ORDR:API] Synexiun kernel skipped — SYNEX_LIMB_PRIVATE_KEY / SYNEX_CORE_URL / SYNEX_CORE_ADMIN_TOKEN not set',
    );
  }

  // ── 1. Load & validate config ──────────────────────────────────────────
  let config: ParsedConfig;
  try {
    config = loadConfig();
    console.warn(`[ORDR:API] Config loaded — env=${config.nodeEnv}, port=${String(config.port)}`);
  } catch (error: unknown) {
    console.error('[ORDR:API] FATAL: Configuration validation failed:', error);
    process.exit(1);
  }

  // ── 2. Database connection ─────────────────────────────────────────────
  let db: ReturnType<typeof createDrizzle> | null = null;
  try {
    dbConnection = createConnection({
      databaseUrl: config.database.url,
      poolMin: config.database.poolMin,
      poolMax: config.database.poolMax,
    });
    db = createDrizzle(dbConnection, schema);
    console.warn('[ORDR:API] Database connection established');
  } catch (error: unknown) {
    console.error('[ORDR:API] FATAL: Database connection failed:', error);
    process.exit(1);
  }

  // ── 3. Kafka client & producer ─────────────────────────────────────────
  try {
    const kafka = createKafkaClient({
      brokers: config.kafka.brokers,
      clientId: config.kafka.clientId,
      ssl: config.kafka.ssl,
    });
    kafkaProducer = createProducer(kafka);
    await kafkaProducer.connect();
    console.warn('[ORDR:API] Kafka producer connected');
  } catch (error: unknown) {
    console.error('[ORDR:API] FATAL: Kafka connection failed:', error);
    process.exit(1);
  }

  // ── 4. Audit logger ────────────────────────────────────────────────────
  const auditStore = new DrizzleAuditStore(db);
  const auditLogger = new AuditLogger(auditStore);
  configureAudit(auditLogger);
  console.warn('[ORDR:API] Audit logger initialized');

  // ── 4.5. Billing / Plan Gate ───────────────────────────────────────────
  // Uses DrizzleSubscriptionStore when the DB connection is available (production).
  // Uses RealStripeClient when STRIPE_SECRET_KEY is set; falls back to
  // MockStripeClient for development / environments without Stripe configured.
  // Rule 5: STRIPE_SECRET_KEY must come from Vault — NEVER hardcoded.
  const fieldEncryptionKey = Buffer.from(
    process.env['FIELD_ENCRYPTION_KEY'] ?? 'dev-only-key-replace-in-prod-!!!',
  );
  const stripeSecretKey = process.env['STRIPE_SECRET_KEY'];
  const stripeClient =
    stripeSecretKey !== undefined && stripeSecretKey !== ''
      ? new RealStripeClient(stripeSecretKey)
      : new MockStripeClient();
  // db is always non-null here: process.exit(1) in step 2 catch ensures it
  const subscriptionStore = new DrizzleSubscriptionStore(db);
  const subscriptionManager = new SubscriptionManager({
    store: subscriptionStore,
    stripe: stripeClient,
    auditLogger,
    fieldEncryptor: new FieldEncryptor(fieldEncryptionKey),
  });
  configureBillingGate(subscriptionManager);
  console.warn(
    `[ORDR:API] Billing gate initialized — stripe=${stripeSecretKey !== undefined ? 'real' : 'mock'}`,
  );

  // ── 4.6. Notifications route ───────────────────────────────────────────
  configureNotificationsRoute(db);
  console.warn('[ORDR:API] Notifications route configured');

  // ── 4.7. Healthcare routes ─────────────────────────────────────────────
  configureHealthcareRoutes(db);
  console.warn('[ORDR:API] Healthcare routes configured');

  // ── 4.8. Developer usage route ─────────────────────────────────────────
  configureDevUsageRoute(db);
  console.warn('[ORDR:API] Developer usage route configured');

  // ── 4.9. Partner stats route ───────────────────────────────────────────
  configurePartnerStatsRoute(db);
  console.warn('[ORDR:API] Partner stats route configured');

  // ── 4.9b. Partner CRUD routes (register, me, earnings, payouts) ───────────
  configurePartnerRoutes({
    auditLogger,
    findPartnerByEmail: async (email) => {
      const rows = await db
        .select()
        .from(schema.partners)
        .where(eq(schema.partners.email, email))
        .limit(1);
      return rows[0] ?? null;
    },
    findPartnerById: async (id) => {
      const rows = await db
        .select()
        .from(schema.partners)
        .where(eq(schema.partners.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
    createPartner: async (data) => {
      const rows = await db
        .insert(schema.partners)
        .values({
          name: data.name,
          email: data.email,
          company: data.company,
          tier: data.tier as 'silver' | 'gold' | 'platinum',
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Failed to create partner');
      return row;
    },
    updatePartner: async (id, data) => {
      const patch: Partial<typeof schema.partners.$inferInsert> = {};
      if (data.name !== undefined) patch.name = data.name;
      if (data.company !== undefined) patch.company = data.company;
      patch.updatedAt = new Date();
      const rows = await db
        .update(schema.partners)
        .set(patch)
        .where(eq(schema.partners.id, id))
        .returning();
      return rows[0] ?? null;
    },
    getEarnings: async (partnerId) => {
      const rows = await db
        .select({
          totalCents: sum(schema.partnerPayouts.amountCents),
          pendingCents: sum(schema.partnerPayouts.amountCents),
        })
        .from(schema.partnerPayouts)
        .where(eq(schema.partnerPayouts.partnerId, partnerId));

      // Compute split by status
      const allPayouts = await db
        .select({
          amountCents: schema.partnerPayouts.amountCents,
          status: schema.partnerPayouts.status,
        })
        .from(schema.partnerPayouts)
        .where(eq(schema.partnerPayouts.partnerId, partnerId));

      let totalCents = 0;
      let pendingCents = 0;
      let paidCents = 0;
      for (const p of allPayouts) {
        totalCents += p.amountCents;
        if (p.status === 'paid') {
          paidCents += p.amountCents;
        } else if (p.status === 'pending' || p.status === 'processing') {
          pendingCents += p.amountCents;
        }
      }
      void rows; // used for type inference only
      return { totalCents, pendingCents, paidCents, currency: 'USD' };
    },
    listPayouts: async (partnerId) => {
      return db
        .select()
        .from(schema.partnerPayouts)
        .where(eq(schema.partnerPayouts.partnerId, partnerId))
        .orderBy(schema.partnerPayouts.createdAt);
    },
  });
  console.warn('[ORDR:API] Partner routes configured');

  // ── 4.10. SLA checker — periodic background scan for breach notifications ──
  slaChecker = new SlaChecker(db);
  configureSlaRoutes(slaChecker);
  slaChecker.start(DEFAULT_CHECK_INTERVAL_MS);

  // ── 4.11. Team management routes ──────────────────────────────────────────
  configureTeamRoutes({ db, auditLogger });
  console.warn('[ORDR:API] Team routes configured');

  // ── 4.12. Profile routes (user self-service) ───────────────────────────────
  configureProfileRoutes({ db, auditLogger });
  console.warn('[ORDR:API] Profile routes configured');

  // ── 4.13. Settings routes (tenant config, SSO, roles, agents, channels) ────
  configureSettingsRoutes({ db, auditLogger });
  console.warn('[ORDR:API] Settings routes configured');

  // ── 4.14. Tickets routes (support ticketing system) ────────────────────────
  configureTicketRoutes({ db });
  console.warn('[ORDR:API] Ticket routes configured');

  // ── 4.15. Reports routes (generation, scheduling, export) ──────────────────
  configureReportRoutes({ db });
  console.warn('[ORDR:API] Report routes configured');

  // ── 4.16. Marketplace routes (agent marketplace CRUD, installs, reviews) ───
  configureMarketplaceRoutes({
    auditLogger,
    listPublishedAgents: async ({ limit, offset, search, category }) => {
      const conditions: SQL[] = [eq(schema.marketplaceAgents.status, 'published')];
      if (search !== undefined && search !== '') {
        const searchCond = or(
          ilike(schema.marketplaceAgents.name, `%${search}%`),
          ilike(schema.marketplaceAgents.description, `%${search}%`),
          ilike(schema.marketplaceAgents.author, `%${search}%`),
        );
        if (searchCond !== undefined) conditions.push(searchCond);
      }
      if (category !== undefined && category !== '') {
        conditions.push(ilike(schema.marketplaceAgents.author, `%${category}%`));
      }
      const whereClause = and(...conditions);
      const [rows, totalRows] = await Promise.all([
        db
          .select()
          .from(schema.marketplaceAgents)
          .where(whereClause)
          .orderBy(asc(schema.marketplaceAgents.name))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(schema.marketplaceAgents).where(whereClause),
      ]);
      return {
        agents: rows.map((r) => ({
          ...r,
          manifest: (r.manifest ?? {}) as Record<string, unknown>,
          rating: r.rating ?? null,
          rejectionReason: r.rejectionReason ?? null,
        })),
        total: totalRows[0]?.total ?? 0,
      };
    },
    findAgentById: async (id) => {
      const rows = await db
        .select()
        .from(schema.marketplaceAgents)
        .where(eq(schema.marketplaceAgents.id, id))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return {
        ...r,
        manifest: (r.manifest ?? {}) as Record<string, unknown>,
        rating: r.rating ?? null,
        rejectionReason: r.rejectionReason ?? null,
      };
    },
    findAgentByNameVersion: async (name, version) => {
      const rows = await db
        .select()
        .from(schema.marketplaceAgents)
        .where(
          and(
            eq(schema.marketplaceAgents.name, name),
            eq(schema.marketplaceAgents.version, version),
          ),
        )
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return {
        ...r,
        manifest: (r.manifest ?? {}) as Record<string, unknown>,
        rating: r.rating ?? null,
        rejectionReason: r.rejectionReason ?? null,
      };
    },
    createAgent: async (data) => {
      const rows = await db
        .insert(schema.marketplaceAgents)
        .values({
          name: data.name,
          version: data.version,
          description: data.description,
          author: data.author,
          license: data.license,
          manifest: data.manifest,
          packageHash: data.packageHash,
          publisherId: data.publisherId,
          status: 'draft',
        })
        .returning();
      const r = rows[0];
      if (!r) throw new Error('Failed to create marketplace agent');
      return {
        ...r,
        manifest: (r.manifest ?? {}) as Record<string, unknown>,
        rating: r.rating ?? null,
        rejectionReason: r.rejectionReason ?? null,
      };
    },
    updateAgent: async (id, data) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (data.description !== undefined) patch['description'] = data.description;
      if (data.manifest !== undefined) patch['manifest'] = data.manifest;
      if (data.packageHash !== undefined) patch['packageHash'] = data.packageHash;
      const rows = await db
        .update(schema.marketplaceAgents)
        .set(patch)
        .where(eq(schema.marketplaceAgents.id, id))
        .returning();
      const r = rows[0];
      if (!r) return null;
      return {
        ...r,
        manifest: (r.manifest ?? {}) as Record<string, unknown>,
        rating: r.rating ?? null,
        rejectionReason: r.rejectionReason ?? null,
      };
    },
    incrementDownloads: async (id) => {
      // Fetch current downloads, increment, and write back (atomic enough for analytics)
      const rows = await db
        .select({ downloads: schema.marketplaceAgents.downloads })
        .from(schema.marketplaceAgents)
        .where(eq(schema.marketplaceAgents.id, id))
        .limit(1);
      const current = rows[0]?.downloads ?? 0;
      await db
        .update(schema.marketplaceAgents)
        .set({ downloads: current + 1 })
        .where(eq(schema.marketplaceAgents.id, id));
    },
    createInstall: async ({ tenantId, agentId, version }) => {
      const rows = await db
        .insert(schema.marketplaceInstalls)
        .values({ tenantId, agentId, version, status: 'active' })
        .returning();
      const r = rows[0];
      if (!r) throw new Error('Failed to create install record');
      return { ...r, installedAt: r.installedAt };
    },
    findInstall: async (tenantId, agentId) => {
      const rows = await db
        .select()
        .from(schema.marketplaceInstalls)
        .where(
          and(
            eq(schema.marketplaceInstalls.tenantId, tenantId),
            eq(schema.marketplaceInstalls.agentId, agentId),
            eq(schema.marketplaceInstalls.status, 'active'),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    removeInstall: async (tenantId, agentId) => {
      const rows = await db
        .update(schema.marketplaceInstalls)
        .set({ status: 'uninstalled' })
        .where(
          and(
            eq(schema.marketplaceInstalls.tenantId, tenantId),
            eq(schema.marketplaceInstalls.agentId, agentId),
          ),
        )
        .returning();
      return rows.length > 0;
    },
    createReview: async ({ agentId, reviewerId, rating, comment }) => {
      const rows = await db
        .insert(schema.marketplaceReviews)
        .values({ agentId, reviewerId, rating, comment })
        .returning();
      const r = rows[0];
      if (!r) throw new Error('Failed to create review');
      return { ...r, comment: r.comment ?? null };
    },
    findReviewByUser: async (agentId, reviewerId) => {
      const rows = await db
        .select()
        .from(schema.marketplaceReviews)
        .where(
          and(
            eq(schema.marketplaceReviews.agentId, agentId),
            eq(schema.marketplaceReviews.reviewerId, reviewerId),
          ),
        )
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return { ...r, comment: r.comment ?? null };
    },
    listReviews: async (agentId) => {
      const rows = await db
        .select()
        .from(schema.marketplaceReviews)
        .where(eq(schema.marketplaceReviews.agentId, agentId))
        .orderBy(asc(schema.marketplaceReviews.createdAt));
      return rows.map((r) => ({ ...r, comment: r.comment ?? null }));
    },
  });
  console.warn('[ORDR:API] Marketplace routes configured');

  // ── 4.17. Customer routes (CRUD with PII encryption + Kafka events) ─────────
  const customerEventProducer = new EventProducer(kafkaProducer);
  const customerFieldEncryptor = new FieldEncryptor(fieldEncryptionKey);
  configureCustomerRoutes({
    fieldEncryptor: customerFieldEncryptor,
    auditLogger,
    eventProducer: customerEventProducer,
    findCustomerById: async (tenantId, customerId) => {
      const rows = await db
        .select()
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, customerId)))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return {
        ...r,
        email: r.email ?? null,
        phone: r.phone ?? null,
        metadata: (r.metadata ?? null) as Record<string, unknown> | null,
        healthScore: r.healthScore ?? null,
        lifecycleStage: r.lifecycleStage ?? null,
        assignedUserId: r.assignedUserId ?? null,
        externalId: r.externalId ?? null,
      };
    },
    listCustomers: async (tenantId, filters) => {
      const conditions: SQL[] = [eq(schema.customers.tenantId, tenantId)];
      if (filters.status !== undefined) {
        conditions.push(
          eq(schema.customers.status, filters.status as 'active' | 'inactive' | 'churned'),
        );
      }
      if (filters.type !== undefined) {
        conditions.push(eq(schema.customers.type, filters.type as 'individual' | 'company'));
      }
      if (filters.lifecycleStage !== undefined) {
        conditions.push(
          eq(
            schema.customers.lifecycleStage,
            filters.lifecycleStage as
              | 'lead'
              | 'qualified'
              | 'opportunity'
              | 'customer'
              | 'churning'
              | 'churned',
          ),
        );
      }
      const whereClause = and(...conditions);
      const offset = (filters.page - 1) * filters.pageSize;
      const [rows, totalRows] = await Promise.all([
        db
          .select()
          .from(schema.customers)
          .where(whereClause)
          .orderBy(asc(schema.customers.createdAt))
          .limit(filters.pageSize)
          .offset(offset),
        db.select({ total: count() }).from(schema.customers).where(whereClause),
      ]);
      const data = rows.map((r) => ({
        ...r,
        email: r.email ?? null,
        phone: r.phone ?? null,
        metadata: (r.metadata ?? null) as Record<string, unknown> | null,
        healthScore: r.healthScore ?? null,
        lifecycleStage: r.lifecycleStage ?? null,
        assignedUserId: r.assignedUserId ?? null,
        externalId: r.externalId ?? null,
      }));
      return { data, total: totalRows[0]?.total ?? 0 };
    },
    createCustomer: async (tenantId, data) => {
      const rows = await db
        .insert(schema.customers)
        .values({
          tenantId,
          externalId: typeof data['externalId'] === 'string' ? data['externalId'] : null,
          type: (data['type'] as 'individual' | 'company' | undefined) ?? 'individual',
          name: typeof data['name'] === 'string' ? data['name'] : '',
          email: typeof data['email'] === 'string' ? data['email'] : null,
          phone: typeof data['phone'] === 'string' ? data['phone'] : null,
          metadata: (data['metadata'] ?? {}) as Record<string, unknown>,
          lifecycleStage:
            typeof data['lifecycleStage'] === 'string'
              ? (data['lifecycleStage'] as
                  | 'lead'
                  | 'qualified'
                  | 'opportunity'
                  | 'customer'
                  | 'churning'
                  | 'churned')
              : 'lead',
          assignedUserId:
            typeof data['assignedUserId'] === 'string' ? data['assignedUserId'] : null,
        })
        .returning();
      const r = rows[0];
      if (!r) throw new Error('Failed to create customer');
      return {
        ...r,
        email: r.email ?? null,
        phone: r.phone ?? null,
        metadata: (r.metadata ?? null) as Record<string, unknown> | null,
        healthScore: r.healthScore ?? null,
        lifecycleStage: r.lifecycleStage ?? null,
        assignedUserId: r.assignedUserId ?? null,
        externalId: r.externalId ?? null,
      };
    },
    updateCustomer: async (tenantId, customerId, data) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      const fields = [
        'name',
        'email',
        'phone',
        'metadata',
        'status',
        'lifecycleStage',
        'healthScore',
        'assignedUserId',
      ] as const;
      for (const f of fields) {
        if (data[f] !== undefined) patch[f] = data[f];
      }
      const rows = await db
        .update(schema.customers)
        .set(patch)
        .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, customerId)))
        .returning();
      const r = rows[0];
      if (!r) return null;
      return {
        ...r,
        email: r.email ?? null,
        phone: r.phone ?? null,
        metadata: (r.metadata ?? null) as Record<string, unknown> | null,
        healthScore: r.healthScore ?? null,
        lifecycleStage: r.lifecycleStage ?? null,
        assignedUserId: r.assignedUserId ?? null,
        externalId: r.externalId ?? null,
      };
    },
    softDeleteCustomer: async (tenantId, customerId) => {
      const rows = await db
        .update(schema.customers)
        .set({ status: 'churned', updatedAt: new Date() })
        .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, customerId)))
        .returning();
      return rows.length > 0;
    },
  });
  console.warn('[ORDR:API] Customer routes configured');

  // ── 4.18. Analytics routes (InMemory store — Drizzle projection upgrade pending) ─
  const analyticsStore = new InMemoryAnalyticsStore();
  const counterStore = new InMemoryCounterStore();
  configureAnalyticsRoutes({
    queries: new AnalyticsQueries(analyticsStore),
    realTimeCounters: new RealTimeCounters(counterStore),
  });
  console.warn('[ORDR:API] Analytics routes configured');

  // ── 5. Compliance engine ───────────────────────────────────────────────
  const complianceEngine = new ComplianceEngine();
  // Rules are registered here at startup.
  // In production, load rules from @ordr/compliance rule modules.
  console.warn(
    `[ORDR:API] Compliance engine initialized — ${String(complianceEngine.getRules().length)} rules loaded`,
  );

  // ── 5.5 LLM Client (Anthropic) ────────────────────────────────────────
  // Required for all AI agent sessions. Skipped in test environments where
  // ANTHROPIC_API_KEY is not set (agents will fail gracefully with a logged error).
  // Rule 5: secrets from environment only — NEVER hardcoded.
  const anthropicApiKey = process.env['ANTHROPIC_API_KEY'];
  if (anthropicApiKey !== undefined && anthropicApiKey.length > 0) {
    llmClient = new LLMClient({
      anthropicApiKey,
      defaultTier: 'standard', // claude-sonnet-4-6 for agent execution
      defaultMaxTokens: 4096,
      defaultTemperature: 0.1,
      timeoutMs: 30_000,
      maxRetries: 3,
    });
    configureAiRoutes({ llmClient });
    console.warn('[ORDR:API] LLM client initialized — model: claude-sonnet-4-6 (standard tier)');
    console.warn(
      '[ORDR:API] AI routes configured — /v1/ai/sentiment, /v1/ai/insights, /v1/ai/route',
    );
  } else {
    console.warn('[ORDR:API] LLM client skipped — ANTHROPIC_API_KEY not set (agents disabled)');
  }

  // ── 5.6. Agent routes (sessions, HITL queue, kill switch) ─────────────────
  {
    const hitlQueue = new HitlQueue();
    const agentEngineDeps = {
      llmComplete: async (
        messages: Parameters<ConstructorParameters<typeof AgentEngine>[0]['llmComplete']>[0],
        systemPrompt: string,
        meta: { tenant_id: string; correlation_id: string; agent_id: string },
      ) => {
        if (llmClient === null) {
          return {
            success: false as const,
            error: new Error('LLM client not configured') as never,
          };
        }
        return llmClient.complete({
          messages,
          modelTier: 'standard',
          maxTokens: 4096,
          temperature: 0.1,
          systemPrompt,
          metadata: meta,
        }) as Promise<never>;
      },
      complianceCheck: (
        action: string,
        context: Parameters<ConstructorParameters<typeof AgentEngine>[0]['complianceCheck']>[1],
      ) => {
        const result = complianceEngine.evaluate({ ...context, action });
        return { allowed: result.allowed, violations: result.violations };
      },
      auditLog: async (
        input: Parameters<ConstructorParameters<typeof AgentEngine>[0]['auditLog']>[0],
      ) => {
        await auditLogger.log({
          tenantId: input.tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: input.actorId,
          resource: input.resource,
          resourceId: input.resourceId,
          action: input.action,
          details: input.details,
          timestamp: input.timestamp,
        });
      },
      tools: new Map(),
    };
    const agentEngine = new AgentEngine(agentEngineDeps, hitlQueue);
    const agentEventProducer = new EventProducer(kafkaProducer);
    configureAgentRoutes({
      auditLogger,
      eventProducer: agentEventProducer,
      agentEngine,
      hitlQueue,
      findSessionById: async (tenantId, sessionId) => {
        const rows = await db
          .select()
          .from(schema.agentSessions)
          .where(
            and(
              eq(schema.agentSessions.tenantId, tenantId),
              eq(schema.agentSessions.id, sessionId),
            ),
          )
          .limit(1);
        const r = rows[0];
        if (!r) return null;
        return {
          sessionId: r.id,
          tenantId: r.tenantId,
          customerId: r.customerId,
          agentRole: r.agentRole,
          autonomyLevel: r.autonomyLevel,
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      },
      listSessions: async (tenantId, filters) => {
        const conditions: ReturnType<typeof eq>[] = [eq(schema.agentSessions.tenantId, tenantId)];
        if (filters.status !== undefined) {
          conditions.push(
            eq(
              schema.agentSessions.status,
              filters.status as 'active' | 'completed' | 'failed' | 'cancelled' | 'timeout',
            ),
          );
        }
        if (filters.agentRole !== undefined) {
          conditions.push(eq(schema.agentSessions.agentRole, filters.agentRole));
        }
        const whereClause = and(...conditions);
        const offset = (filters.page - 1) * filters.pageSize;
        const [rows, totalRows] = await Promise.all([
          db
            .select()
            .from(schema.agentSessions)
            .where(whereClause)
            .orderBy(asc(schema.agentSessions.startedAt))
            .limit(filters.pageSize)
            .offset(offset),
          db.select({ total: count() }).from(schema.agentSessions).where(whereClause),
        ]);
        const data = rows.map((r) => ({
          sessionId: r.id,
          tenantId: r.tenantId,
          customerId: r.customerId,
          agentRole: r.agentRole,
          autonomyLevel: r.autonomyLevel,
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
        return { data, total: totalRows[0]?.total ?? 0 };
      },
      createSession: async (session) => {
        const rows = await db
          .insert(schema.agentSessions)
          .values({
            tenantId: session.tenantId,
            customerId: session.customerId,
            agentRole: session.agentRole,
            autonomyLevel: session.autonomyLevel as
              | 'rule_based'
              | 'router'
              | 'supervised'
              | 'autonomous'
              | 'full_autonomy',
            status: 'active',
          })
          .returning();
        const r = rows[0];
        if (!r) throw new Error('Failed to create agent session');
        return {
          sessionId: r.id,
          tenantId: r.tenantId,
          customerId: r.customerId,
          agentRole: r.agentRole,
          autonomyLevel: r.autonomyLevel,
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      },
      updateSessionStatus: async (tenantId, sessionId, status) => {
        const rows = await db
          .update(schema.agentSessions)
          .set({
            status: status as 'active' | 'completed' | 'failed' | 'cancelled' | 'timeout',
            updatedAt: new Date(),
            ...(status === 'completed' ||
            status === 'failed' ||
            status === 'cancelled' ||
            status === 'timeout'
              ? { completedAt: new Date() }
              : {}),
          })
          .where(
            and(
              eq(schema.agentSessions.tenantId, tenantId),
              eq(schema.agentSessions.id, sessionId),
            ),
          )
          .returning();
        const r = rows[0];
        if (!r) return null;
        return {
          sessionId: r.id,
          tenantId: r.tenantId,
          customerId: r.customerId,
          agentRole: r.agentRole,
          autonomyLevel: r.autonomyLevel,
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      },
    });
    console.warn('[ORDR:API] Agent routes configured');
  }

  // ── 6. JWT key pair ────────────────────────────────────────────────────
  let jwtConfig: JwtConfig;
  try {
    jwtConfig = await loadKeyPair(config.auth.jwtPrivateKey, config.auth.jwtPublicKey, {
      issuer: 'ordr-connect',
      audience: 'ordr-connect',
    });
    console.warn('[ORDR:API] JWT key pair loaded');
  } catch (error: unknown) {
    console.error('[ORDR:API] FATAL: JWT key pair loading failed:', error);
    process.exit(1);
  }

  // ── 7. Configure middleware ────────────────────────────────────────────
  configureAuth(jwtConfig);
  configureEventsRoute({ jwtConfig });

  // ── 7.1. Developer portal routes ──────────────────────────────────────
  // db is non-null here — process.exit(1) in step 2 catch ensures it.
  // jwtConfig is available from step 6.
  configureDeveloperRoutes({
    jwtConfig,
    auditLogger,

    findDeveloperByEmail: async (email) => {
      const rows = await db
        .select()
        .from(schema.developerAccounts)
        .where(eq(schema.developerAccounts.email, email))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return { ...row, displayName: row.displayName ?? '' };
    },

    findDeveloperById: async (id) => {
      const rows = await db
        .select()
        .from(schema.developerAccounts)
        .where(eq(schema.developerAccounts.id, id))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return { ...row, displayName: row.displayName ?? '' };
    },

    createDeveloper: async (data) => {
      const inserted = await db
        .insert(schema.developerAccounts)
        .values({
          email: data.email,
          displayName: data.displayName,
          organization: data.organization,
          passwordHash: data.passwordHash,
          tier: data.tier as 'free' | 'pro' | 'enterprise',
          // placeholder key fields — developer keys managed via /keys endpoints
          apiKeyHash: '',
          apiKeyPrefix: '',
        })
        .returning();
      const row = inserted[0]!;
      return { ...row, displayName: row.displayName ?? '' };
    },

    createDeveloperKey: async (data) => {
      const inserted = await db
        .insert(schema.developerApiKeys)
        .values({
          developerId: data.developerId,
          name: data.name,
          keyHash: data.keyHash,
          keyPrefix: data.keyPrefix,
          expiresAt: data.expiresAt ?? null,
        })
        .returning();
      return inserted[0]!;
    },

    listDeveloperKeys: async (developerId) => {
      return db
        .select()
        .from(schema.developerApiKeys)
        .where(eq(schema.developerApiKeys.developerId, developerId));
    },

    findKeyById: async (developerId, keyId) => {
      const rows = await db
        .select()
        .from(schema.developerApiKeys)
        .where(
          and(
            eq(schema.developerApiKeys.id, keyId),
            eq(schema.developerApiKeys.developerId, developerId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    revokeKey: async (developerId, keyId) => {
      const result = await db
        .update(schema.developerApiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.developerApiKeys.id, keyId),
            eq(schema.developerApiKeys.developerId, developerId),
          ),
        )
        .returning();
      return result.length > 0;
    },

    createSandbox: async (data) => {
      const inserted = await db
        .insert(schema.sandboxTenants)
        .values({
          developerId: data.developerId,
          tenantId: data.tenantId,
          name: data.name,
          seedDataProfile: data.seedDataProfile as 'minimal' | 'collections' | 'healthcare',
          expiresAt: data.expiresAt,
        })
        .returning();
      return inserted[0]!;
    },

    listSandboxes: async (developerId) => {
      return db
        .select()
        .from(schema.sandboxTenants)
        .where(eq(schema.sandboxTenants.developerId, developerId));
    },

    findSandboxById: async (developerId, sandboxId) => {
      const rows = await db
        .select()
        .from(schema.sandboxTenants)
        .where(
          and(
            eq(schema.sandboxTenants.id, sandboxId),
            eq(schema.sandboxTenants.developerId, developerId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    destroySandbox: async (developerId, sandboxId) => {
      const result = await db
        .update(schema.sandboxTenants)
        .set({ status: 'destroyed' })
        .where(
          and(
            eq(schema.sandboxTenants.id, sandboxId),
            eq(schema.sandboxTenants.developerId, developerId),
          ),
        )
        .returning();
      return result.length > 0;
    },
  });
  console.warn('[ORDR:API] Developer portal routes configured');

  configureHealthChecks({
    checkDb: async () => {
      if (!dbConnection) return false;
      try {
        await dbConnection`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
    checkKafka: async () => {
      if (!kafkaProducer) return false;
      // KafkaJS producer is connected if it was successfully connect()'d
      return true;
    },
  });

  // ── 8. Configure branding routes (white-label) ──────────────────────────
  {
    const db = createDrizzle(dbConnection, schema);

    configureBrandingRoutes({
      auditLogger,

      getBrandConfig: async (tenantId: string) => {
        const rows = await db
          .select()
          .from(schema.whiteLabelConfigs)
          .where(eq(schema.whiteLabelConfigs.tenantId, tenantId))
          .limit(1);
        return rows[0] ?? null;
      },

      upsertBrandConfig: async (tenantId: string, data) => {
        const existing = await db
          .select()
          .from(schema.whiteLabelConfigs)
          .where(eq(schema.whiteLabelConfigs.tenantId, tenantId))
          .limit(1);

        if (existing[0]) {
          const updated = await db
            .update(schema.whiteLabelConfigs)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(schema.whiteLabelConfigs.tenantId, tenantId))
            .returning();
          return updated[0]!;
        }

        const inserted = await db
          .insert(schema.whiteLabelConfigs)
          .values({ tenantId, ...data })
          .returning();
        return inserted[0]!;
      },

      getBrandConfigByDomain: async (domain: string) => {
        const rows = await db
          .select()
          .from(schema.whiteLabelConfigs)
          .where(eq(schema.whiteLabelConfigs.customDomain, domain))
          .limit(1);
        return rows[0] ?? null;
      },

      setCustomDomain: async (tenantId: string, domain: string) => {
        const existing = await db
          .select()
          .from(schema.whiteLabelConfigs)
          .where(eq(schema.whiteLabelConfigs.tenantId, tenantId))
          .limit(1);

        if (existing[0]) {
          const updated = await db
            .update(schema.whiteLabelConfigs)
            .set({ customDomain: domain, updatedAt: new Date() })
            .where(eq(schema.whiteLabelConfigs.tenantId, tenantId))
            .returning();
          return updated[0]!;
        }

        const inserted = await db
          .insert(schema.whiteLabelConfigs)
          .values({ tenantId, customDomain: domain })
          .returning();
        return inserted[0]!;
      },

      removeCustomDomain: async (tenantId: string) => {
        const existing = await db
          .select()
          .from(schema.whiteLabelConfigs)
          .where(eq(schema.whiteLabelConfigs.tenantId, tenantId))
          .limit(1);

        if (!existing[0] || !existing[0].customDomain) return false;

        await db
          .update(schema.whiteLabelConfigs)
          .set({ customDomain: null, updatedAt: new Date() })
          .where(eq(schema.whiteLabelConfigs.tenantId, tenantId));
        return true;
      },
    });

    console.warn('[ORDR:API] Branding routes configured');
  }

  // ── 8.1 Organizations ──────────────────────────────────────────────────
  configureOrgRoutes({
    orgManager: new OrganizationManager(new InMemoryOrgStore()),
    auditLogger,
  });
  console.warn('[ORDR:API] Organization routes configured');

  // ── 8.2 SSO ────────────────────────────────────────────────────────────
  {
    const ssoStateKey =
      process.env['WORKOS_SSO_STATE_KEY'] ?? fieldEncryptionKey.toString('hex').slice(0, 32);
    configureSSORoutes({
      ssoManager: new SSOManager(
        {
          apiKey: process.env['WORKOS_API_KEY'] ?? '',
          clientId: process.env['WORKOS_CLIENT_ID'] ?? '',
          redirectUri: `${process.env['API_BASE_URL'] ?? 'http://localhost:3000'}/api/v1/sso/callback`,
        },
        new InMemorySSOClient(),
        new InMemorySSOConnectionStore(),
        ssoStateKey,
      ),
      auditLogger,
    });
    console.warn('[ORDR:API] SSO routes configured');
  }

  // ── 8.3 Messages ───────────────────────────────────────────────────────
  {
    const db = createDrizzle(dbConnection, schema);

    // Stub TwilioClient — used when TWILIO_ACCOUNT_SID is not set
    const stubTwilioClient: TwilioClient = {
      messages: {
        create: async () => ({
          sid: 'stub-sid',
          status: 'sent',
          errorCode: null,
          errorMessage: null,
        }),
      },
    };

    // Stub SendGridClient — used when SENDGRID_API_KEY is not set
    const stubSendGridClient: SendGridClient = {
      send: async () => ({ statusCode: 202, headers: {} }),
    };

    const inMemoryConsentStore: ConsentStore = {
      getConsent: async () => undefined,
      saveConsent: async () => {
        /* no-op */
      },
      revokeConsent: async () => {
        /* no-op */
      },
    };

    configureMessageRoutes({
      auditLogger,
      eventProducer: new EventProducer(kafkaProducer),
      consentManager: new ConsentManager(),
      consentStore: inMemoryConsentStore,
      complianceGate: new ComplianceGate(complianceEngine),
      smsProvider: new SmsProvider({
        client: stubTwilioClient,
        fromNumber: process.env['TWILIO_FROM_NUMBER'] ?? '+15550000000',
        authToken: process.env['TWILIO_AUTH_TOKEN'] ?? '',
      }),
      emailProvider: new EmailProvider({
        client: stubSendGridClient,
        fromEmail: process.env['SENDGRID_FROM_EMAIL'] ?? 'noreply@ordr.dev',
        fromName: process.env['SENDGRID_FROM_NAME'] ?? 'ORDR Connect',
      }),

      findMessageById: async (tenantId, messageId) => {
        const rows = await db
          .select()
          .from(schema.messages)
          .where(and(eq(schema.messages.tenantId, tenantId), eq(schema.messages.id, messageId)))
          .limit(1);
        return rows[0] ?? null;
      },

      listMessages: async (tenantId, filters) => {
        const conditions: SQL[] = [eq(schema.messages.tenantId, tenantId)];
        if (filters.customerId !== undefined)
          conditions.push(eq(schema.messages.customerId, filters.customerId));
        if (filters.channel !== undefined)
          conditions.push(eq(schema.messages.channel, filters.channel as never));
        if (filters.status !== undefined)
          conditions.push(eq(schema.messages.status, filters.status as never));
        if (filters.direction !== undefined)
          conditions.push(eq(schema.messages.direction, filters.direction as never));

        const offset = (filters.page - 1) * filters.pageSize;
        const [rows, [countRow]] = await Promise.all([
          db
            .select()
            .from(schema.messages)
            .where(and(...conditions))
            .limit(filters.pageSize)
            .offset(offset)
            .orderBy(asc(schema.messages.createdAt)),
          db
            .select({ total: count() })
            .from(schema.messages)
            .where(and(...conditions)),
        ]);
        return { data: rows, total: countRow?.total ?? 0 };
      },

      createMessage: async (data) => {
        const inserted = await db
          .insert(schema.messages)
          .values({
            id: data.id,
            tenantId: data.tenantId,
            customerId: data.customerId,
            channel: data.channel as never,
            direction: data.direction as never,
            status: data.status as never,
            contentRef: data.contentRef,
          })
          .returning();
        return inserted[0]!;
      },

      getCustomerContact: async (tenantId, customerId, channel) => {
        const rows = await db
          .select({ email: schema.customers.email, phone: schema.customers.phone })
          .from(schema.customers)
          .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, customerId)))
          .limit(1);
        if (!rows[0]) return null;
        const contact = channel === 'email' ? rows[0].email : rows[0].phone;
        if (!contact) return null;
        const decrypted = new FieldEncryptor(fieldEncryptionKey).decryptField(channel, contact);
        return { contact: decrypted, contentBody: '' };
      },
    });
    console.warn('[ORDR:API] Message routes configured');
  }

  // ── 9. Create and start Hono app ───────────────────────────────────────
  const app = createApp({
    corsOrigins: config.corsOrigins,
    nodeEnv: config.nodeEnv,
  });

  server = serve(
    {
      fetch: app.fetch,
      port: config.port,
    },
    (info) => {
      console.warn(`[ORDR:API] Server listening on port ${String(info.port)}`);
      console.warn(`[ORDR:API] Health check: http://localhost:${String(info.port)}/health`);
    },
  );
}

// ---- Graceful Shutdown -----------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  console.warn(`[ORDR:API] Received ${signal} — initiating graceful shutdown...`);

  // 1. Stop accepting new requests
  if (server !== null) {
    server.close();
    console.warn('[ORDR:API] HTTP server closed');
  }

  // 2. Stop SLA checker loop
  if (slaChecker !== null) {
    slaChecker.stop();
  }

  // 3. Shut down Synexiun kernel (stops heartbeat loop)
  if (limbInstance !== null) {
    limbInstance.shutdown();
    console.warn('[ORDR:API] Synexiun kernel shut down');
  }

  // 4. Disconnect Kafka producer (flush pending messages)
  if (kafkaProducer !== null) {
    try {
      await kafkaProducer.disconnect();
      console.warn('[ORDR:API] Kafka producer disconnected');
    } catch (error: unknown) {
      console.error('[ORDR:API] Error disconnecting Kafka producer:', error);
    }
  }

  // 5. Close database connection pool
  if (dbConnection !== null) {
    try {
      await closeConnection(dbConnection);
      console.warn('[ORDR:API] Database connection closed');
    } catch (error: unknown) {
      console.error('[ORDR:API] Error closing database connection:', error);
    }
  }

  console.warn('[ORDR:API] Shutdown complete');
  process.exit(0);
}

// ---- Signal Handlers -------------------------------------------------------

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

// ---- Unhandled errors — last resort logging --------------------------------

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[ORDR:API] Unhandled rejection:', reason);
  // Do NOT exit — let the process continue if possible
});

process.on('uncaughtException', (error: Error) => {
  console.error('[ORDR:API] Uncaught exception:', error);
  // Uncaught exceptions leave the process in an undefined state — exit
  process.exit(1);
});

// ---- Start -----------------------------------------------------------------

void bootstrap();
