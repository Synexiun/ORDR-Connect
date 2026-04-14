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
import {
  createKafkaClient,
  createProducer,
  EventProducer,
  TOPICS,
  EventType,
  ConfluentRegistryClient,
  eventSchemaRegistry,
} from '@ordr/events';
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
  RedisRateLimiter,
  InMemoryRateLimiter,
} from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { ComplianceEngine, ComplianceGate, ALL_RULES } from '@ordr/compliance';
import {
  NBAPipeline,
  RulesEngine,
  createDefaultMLScorer,
  LLMReasoner,
} from '@ordr/decision-engine';
import type {
  ComplianceGateInterface as NBAComplianceGateInterface,
  DecisionAuditEntry,
} from '@ordr/decision-engine';
import {
  ConsentManager,
  SmsProvider,
  EmailProvider,
  createRealTwilioClient,
  createRealSendGridClient,
} from '@ordr/channels';
import type { ConsentStore, TwilioClient, SendGridClient } from '@ordr/channels';
import { LLMClient, PromptRegistry } from '@ordr/ai';
import {
  AnalyticsQueries,
  RealTimeCounters,
  InMemoryAnalyticsStore,
  InMemoryCounterStore,
  AnalyticsClient,
} from '@ordr/analytics';
import type { AnalyticsStore } from '@ordr/analytics';
import { AgentEngine, HitlQueue } from '@ordr/agent-runtime';
import {
  and,
  eq,
  gt,
  gte,
  inArray,
  sum,
  count,
  max,
  sql,
  desc,
  ilike,
  or,
  asc,
  type SQL,
} from 'drizzle-orm';
import { MetricsRegistry } from '@ordr/observability';
import { Redis } from 'ioredis';
import { createApp } from './app.js';
import { configureAuth } from './middleware/auth.js';
import { configureAudit } from './middleware/audit.js';
import { configureRateLimit } from './middleware/rate-limit.js';
import { configureBillingGate } from './middleware/plan-gate.js';
import { configureHealthChecks } from './routes/health.js';
import { configureBrandingRoutes } from './routes/branding.js';
import { configureOnboardingRoutes } from './routes/onboarding.js';
import { configureFeatureFlagRoutes } from './routes/feature-flags.js';
import { configureAiRoutes } from './routes/ai.js';
import { configureEventsRoute } from './routes/events.js';
import { configureNotificationsRoute } from './routes/notifications.js';
import { configureAuditLogsRoute } from './routes/audit-logs.js';
import { configureHealthcareRoutes } from './routes/healthcare.js';
import { configureFhirRoutes } from './routes/fhir.js';
import { configureDevUsageRoute } from './routes/developer-usage.js';
import { configureWebhookRoutes } from './routes/developer-webhooks.js';
// NOTE: renamed to avoid collision with the existing `configureAgentRoutes` import at line ~95
import { configureAgentRoutes as configureDeveloperAgentRoutes } from './routes/developer-agents.js';
import { configurePartnerStatsRoute } from './routes/partner-stats.js';
import { configurePartnerRoutes } from './routes/partners.js';
import { configureDeveloperRoutes } from './routes/developers.js';
import { SlaChecker, DEFAULT_CHECK_INTERVAL_MS } from './lib/sla-checker.js';
import { DrizzleRuleStore } from './lib/drizzle-rule-store.js';
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
import { configureSCIMRoutes } from './routes/scim.js';
import { createWorkOSWebhookRouter } from './routes/webhooks-workos.js';
import { SCIMHandler, DrizzleUserStore, DrizzleGroupStore, DrizzleTokenStore } from '@ordr/auth';
import { configureMessageRoutes } from './routes/messages.js';
import { configureBillingRoutes } from './routes/billing.js';
import { configureRealtimeRoutes } from './routes/realtime.js';
import { configureWorkflowRoutes } from './routes/workflow.js';
import { configureSearchRoutes } from './routes/search.js';
import { configureSchedulerRoutes } from './routes/scheduler.js';
import { configureIntegrationRoutes } from './routes/integrations.js';
import { configureDsrRoutes } from './routes/dsr.js';
import {
  configureComplianceDashboardRoutes,
  type ViolationRegulation,
} from './routes/compliance-dashboard.js';
import { configureTenantRoutes } from './routes/tenants.js';
import { ChannelManager } from '@ordr/realtime';
import { EventPublisher } from '@ordr/realtime';
import {
  WorkflowEngine,
  InMemoryDefinitionStore,
  InMemoryInstanceStore,
  InMemoryStepResultStore,
  DrizzleDefinitionStore,
  DrizzleInstanceStore,
  DrizzleStepResultStore,
} from '@ordr/workflow';
import { SearchEngine, SearchIndexer, InMemorySearchStore, DrizzleSearchStore } from '@ordr/search';
import { JobScheduler, InMemorySchedulerStore, DrizzleSchedulerStore } from '@ordr/scheduler';
import { SalesforceAdapter, HubSpotAdapter } from '@ordr/integrations';
import type { CRMAdapter } from './routes/integrations.js';
import { UsageTracker, InMemoryUsageStore, DrizzleUsageStore } from '@ordr/billing';
import { VaultClient, initSecretStore, secretStore, KeyRotationTracker } from '@ordr/vault';
import { createKeyRotationCheckDefinition, createKeyRotationCheckHandler } from '@ordr/scheduler';
import type { KeyRotationCheckDeps } from '@ordr/scheduler';
import { runKeyRotation } from './jobs/key-rotation.js';
import type postgres from 'postgres';

// ---- Vault secret keys -----------------------------------------------------

/** Secrets that must be loaded from Vault and hot-reloaded on rotation. */
const TRACKED_SECRET_KEYS = [
  'JWT_PRIVATE_KEY',
  'ENCRYPTION_MASTER_KEY',
  'STRIPE_SECRET_KEY',
  'TWILIO_AUTH_TOKEN',
  'SENDGRID_API_KEY',
  'OPENAI_API_KEY',
] as const;

// Module-level — allows JWT config to be hot-swapped on Vault rotation
let activeJwtConfig: JwtConfig | null = null;

function setJwtConfig(config: JwtConfig): void {
  activeJwtConfig = config;
}

// ---- State -----------------------------------------------------------------

let limbInstance: Limb | null = null;
let vaultClientInstance: VaultClient | null = null;
let dbConnection: postgres.Sql | null = null;
let kafkaProducer: Producer | null = null;
let confluentRegistry: ConfluentRegistryClient | undefined;
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

  // ── 1.5. Vault secret store ────────────────────────────────────────────
  vaultClientInstance = new VaultClient();
  const vaultClient = vaultClientInstance;
  try {
    await vaultClient.authenticate();
    await initSecretStore(vaultClient, [...TRACKED_SECRET_KEYS]);
    console.warn('[ORDR:API] Secret store initialized (Vault enabled:', vaultClient.isEnabled, ')');
  } catch (error: unknown) {
    console.error(
      '[ORDR:API] FATAL: Vault secret store initialization failed:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }

  // ── 1.6. Hot-reload callbacks ──────────────────────────────────────────
  secretStore.onRotate('JWT_PRIVATE_KEY', (val: string) => {
    console.warn('[ORDR:API] JWT_PRIVATE_KEY rotated — reloading key pair');
    void loadKeyPair(val, config.auth.jwtPublicKey, {
      issuer: 'ordr-connect',
      audience: 'ordr-connect',
    })
      .then(setJwtConfig)
      .catch((err: unknown) => {
        console.error(
          '[ORDR:API] JWT_PRIVATE_KEY rotation failed:',
          err instanceof Error ? err.message : err,
        );
      });
  });

  secretStore.onRotate('ENCRYPTION_MASTER_KEY', (_val: string) => {
    console.warn(
      '[ORDR:API] ENCRYPTION_MASTER_KEY rotated — pod restart recommended for full re-init',
    );
  });

  secretStore.onRotate('STRIPE_SECRET_KEY', (_val: string) => {
    console.warn('[ORDR:API] STRIPE_SECRET_KEY rotated — pod restart recommended');
  });

  secretStore.onRotate('TWILIO_AUTH_TOKEN', (_val: string) => {
    console.warn('[ORDR:API] TWILIO_AUTH_TOKEN rotated — pod restart recommended');
  });

  secretStore.onRotate('SENDGRID_API_KEY', (_val: string) => {
    console.warn('[ORDR:API] SENDGRID_API_KEY rotated — pod restart recommended');
  });

  secretStore.onRotate('OPENAI_API_KEY', (_val: string) => {
    console.warn('[ORDR:API] OPENAI_API_KEY rotated — pod restart recommended');
  });

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

  // ── 3.5. Confluent Schema Registry (optional) ──────────────────────────
  // Wires an external schema registry for schema versioning + compatibility
  // enforcement.  No-op when CONFLUENT_SCHEMA_REGISTRY_URL is unset so the
  // service starts cleanly in local dev without a registry.
  //
  // SOC2 CC6.6 / ISO 27001 A.8.9 — Change management: all event schemas are
  // registered and their compatibility is verified before traffic flows.
  {
    const registryUrl = process.env['CONFLUENT_SCHEMA_REGISTRY_URL'];
    if (registryUrl !== undefined && registryUrl.length > 0) {
      const schemaRegistryClient = new ConfluentRegistryClient({
        url: registryUrl,
        apiKey: process.env['CONFLUENT_SCHEMA_REGISTRY_API_KEY'],
        apiSecret: process.env['CONFLUENT_SCHEMA_REGISTRY_API_SECRET'],
      });

      // Eagerly register all schemas and warm the local cache.
      // Failures are non-fatal: warn and continue — Zod validation is the
      // hard gate; the registry is additive compliance hardening.
      const schemaProducer = new EventProducer(
        kafkaProducer,
        eventSchemaRegistry,
        schemaRegistryClient,
      );
      await schemaProducer.registerAllSchemas();

      // Expose the registry client for use by all EventProducer instances.
      // Re-assign the module-level variable so all subsequent constructors
      // share one client (and one warm cache).
      confluentRegistry = schemaRegistryClient;
      console.warn('[ORDR:API] Confluent Schema Registry: all schemas registered');
    } else {
      console.warn(
        '[ORDR:API] Confluent Schema Registry: not configured (CONFLUENT_SCHEMA_REGISTRY_URL unset)',
      );
    }
  }

  // ── 4. Audit logger ────────────────────────────────────────────────────
  const auditStore = new DrizzleAuditStore(db);
  const auditLogger = new AuditLogger(auditStore);
  configureAudit(auditLogger);
  console.warn('[ORDR:API] Audit logger initialized');

  // ── 4.4. Military-grade threat detection ───────────────────────────────
  // All security components are singletons — initialized here and wired into
  // the threat detection middleware via configureThreatDetection().
  // DLP is enabled in production only (response scanning adds CPU overhead).
  {
    const {
      AnomalyDetector,
      AttackDetector,
      DLPScanner,
      ThreatScorer,
      SecurityEventBus,
      IPIntelligence,
    } = await import('@ordr/security');
    const { configureThreatDetection } = await import('./middleware/threat-detection.js');

    const securityEventBus = new SecurityEventBus();
    // Log all critical/high security events to WORM audit trail
    securityEventBus.subscribe((secEvent) => {
      if (secEvent.severity === 'critical' || secEvent.severity === 'high') {
        void auditLogger.log({
          tenantId: secEvent.tenantId ?? 'system',
          actorId: secEvent.actorId ?? 'unknown',
          actorType: 'system',
          eventType: 'compliance.violation',
          action: `security.${secEvent.type}`,
          resource: 'request',
          resourceId: secEvent.requestId,
          details: {
            ip: secEvent.ip,
            userAgent: secEvent.userAgent,
            path: secEvent.path,
            severity: secEvent.severity,
            eventDetails: secEvent.details,
          },
          timestamp: new Date(),
        });
      }
    });

    configureThreatDetection({
      anomalyDetector: new AnomalyDetector(),
      attackDetector: new AttackDetector(),
      dlpScanner: new DLPScanner(),
      threatScorer: new ThreatScorer(),
      securityEventBus,
      ipIntelligence: new IPIntelligence(),
      dlpEnabled: config.nodeEnv === 'production',
    });
    console.warn('[ORDR:API] Military-grade threat detection initialized');
  }

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

  // ── 4.6.1. Audit logs route ────────────────────────────────────────────
  configureAuditLogsRoute(db);
  console.warn('[ORDR:API] Audit logs route configured');

  // ── 4.7. Healthcare routes ─────────────────────────────────────────────
  configureHealthcareRoutes(db);
  console.warn('[ORDR:API] Healthcare routes configured');

  // ── 4.7b. FHIR R4 routes ──────────────────────────────────────────────
  // Mounted at /api/v1/fhir/r4 — Patient import/export + Communication
  // FHIR_BASE_URL env var should match the public API URL for self-links.
  configureFhirRoutes({
    db,
    auditLogger,
    fieldEncryptor: new FieldEncryptor(fieldEncryptionKey),
    baseUrl:
      process.env['FHIR_BASE_URL'] ?? process.env['API_BASE_URL'] ?? 'http://localhost:3000/api/v1',
  });
  console.warn('[ORDR:API] FHIR R4 routes configured — /api/v1/fhir/r4');

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
  const customerEventProducer = new EventProducer(kafkaProducer, undefined, confluentRegistry);
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

  // ── 4.18. Analytics routes ────────────────────────────────────────────────
  // Use real ClickHouse when CLICKHOUSE_URL is set; fall back to in-memory for
  // local dev and test environments where ClickHouse is not provisioned.
  let analyticsStore: AnalyticsStore;
  const clickhouseUrl = process.env['CLICKHOUSE_URL'];
  if (clickhouseUrl) {
    const chClient = new AnalyticsClient({
      url: clickhouseUrl,
      database: process.env['CLICKHOUSE_DATABASE'] ?? 'ordr_analytics',
      username: process.env['CLICKHOUSE_USERNAME'] ?? 'default',
      password: process.env['CLICKHOUSE_PASSWORD'] ?? '',
      tls: process.env['CLICKHOUSE_TLS'] !== 'false',
    });
    await chClient.connect();
    analyticsStore = chClient;
    console.warn('[ORDR:API] Analytics routes configured — ClickHouse connected');
  } else {
    analyticsStore = new InMemoryAnalyticsStore();
    console.warn(
      '[ORDR:API] Analytics routes configured — in-memory store (set CLICKHOUSE_URL for production)',
    );
  }
  const counterStore = new InMemoryCounterStore();
  configureAnalyticsRoutes({
    queries: new AnalyticsQueries(analyticsStore),
    realTimeCounters: new RealTimeCounters(counterStore),
    db,
  });

  // ── 5. Compliance engine ───────────────────────────────────────────────
  const complianceEngine = new ComplianceEngine();
  complianceEngine.registerRules(ALL_RULES);
  console.warn(
    `[ORDR:API] Compliance engine initialized — ${String(complianceEngine.getRules().length)} rules loaded`,
  );

  // Map lowercase engine regulation → uppercase DB enum value.
  // Regulations not in the DB enum (ccpa, fec, respa, pipeda, lgpd) return null
  // and are skipped for violation persistence — audit log is still written.
  const DB_REGULATION: Record<string, string | undefined> = {
    hipaa: 'HIPAA',
    fdcpa: 'FDCPA',
    tcpa: 'TCPA',
    gdpr: 'GDPR',
    ccpa: 'CCPA',
    fec: 'FEC',
    respa: 'RESPA',
    soc2: 'SOC2',
    iso27001: 'ISO27001',
  };
  const DB_SEVERITY = new Set(['critical', 'high', 'medium', 'low']);

  /** Insert a single compliance violation into the operator dashboard table. */
  const insertComplianceViolation = async (v: {
    readonly tenantId: string;
    readonly ruleName: string;
    readonly regulation: string;
    readonly severity: string;
    readonly description: string;
    readonly customerId: string | null;
  }): Promise<void> => {
    const dbReg = DB_REGULATION[v.regulation.toLowerCase()];
    if (dbReg === undefined) return; // regulation not tracked in violations table
    const dbSev = DB_SEVERITY.has(v.severity) ? v.severity : 'medium';
    await db.insert(schema.complianceViolations).values({
      tenantId: v.tenantId,
      ruleName: v.ruleName,
      regulation: dbReg as never,
      severity: dbSev as never,
      description: v.description,
      customerId: v.customerId ?? null,
    });
  };

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
        // Persist violations to operator dashboard (fire-and-forget)
        if (!result.allowed) {
          void Promise.allSettled(
            result.violations.map((v) =>
              insertComplianceViolation({
                tenantId: context.tenantId,
                ruleName: v.ruleId,
                regulation: v.regulation,
                severity: v.violation?.severity ?? 'medium',
                description: v.violation?.message ?? v.ruleId,
                customerId: context.customerId ?? null,
              }),
            ),
          );
        }
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
    const agentEventProducer = new EventProducer(kafkaProducer, undefined, confluentRegistry);

    // ── NBA pipeline (3-layer: Rules → ML → LLM) ───────────────────────────
    // DrizzleRuleStore merges built-in rules with per-tenant DB rules on every
    // getRules() call. The CRUD API (GET/POST/PUT/DELETE /agents/rules) manages
    // custom rules stored in the decision_rules table.
    const nbaRuleStore = new DrizzleRuleStore(db);
    const nbaRulesEngine = new RulesEngine(nbaRuleStore);
    const nbaMLScorer = createDefaultMLScorer();

    // PromptRegistry — real registry with built-in collections templates.
    // NBA-specific system prompt registered under 'nba.decision_engine'.
    const nbaPromptRegistry = new PromptRegistry();
    nbaPromptRegistry.register({
      id: 'nba.decision_engine',
      name: 'NBA Decision Engine',
      version: 1,
      systemPrompt: [
        'You are an expert customer operations decision engine operating within a HIPAA, SOC2, and ISO 27001 compliant environment.',
        'RULES YOU MUST FOLLOW:',
        '- Analyze the provided context and recommend the single best next action.',
        '- NEVER include customer names, emails, phone numbers, account numbers, or any PII/PHI in your response.',
        '- Base decisions on scores, lifecycle stage, balance data, and interaction patterns only.',
        '- If confidence is below 0.5, recommend escalate_to_human.',
        '- Return valid JSON only — no prose, no markdown, no code blocks.',
        '- Every decision must include a brief compliance-safe reasoning string.',
      ].join('\n'),
      userTemplate: '{{context_summary}}',
      variables: ['context_summary'],
    });
    const nbaLLMReasoner =
      llmClient !== null
        ? new LLMReasoner(llmClient, nbaPromptRegistry)
        : new LLMReasoner(
            // Null-safe stub — returns a no-action result when LLM is unavailable
            {
              complete: async () => ({
                success: false as const,
                error: new Error('LLM client not configured') as never,
              }),
            } as never,
            nbaPromptRegistry,
          );
    const nbaComplianceAdapter: NBAComplianceGateInterface = {
      check: (action, context) => {
        const result = complianceEngine.evaluate({ ...context, action });
        return { allowed: result.allowed, violations: result.violations };
      },
    };
    const nbaAuditAdapter = {
      log: async (input: Parameters<(typeof auditLogger)['log']>[0]) => {
        const event = await auditLogger.log(input);
        return { id: event.id };
      },
    };
    const nbaPipeline = new NBAPipeline({
      rules: nbaRulesEngine,
      ml: nbaMLScorer,
      llm: nbaLLMReasoner,
      compliance: nbaComplianceAdapter,
      auditLogger: nbaAuditAdapter,
      writeDecisionAudit: async (entries: readonly DecisionAuditEntry[]) => {
        await db.insert(schema.decisionAudit).values(
          entries.map((e: DecisionAuditEntry) => ({
            tenantId: e.tenantId,
            decisionId: e.decisionId,
            customerId: e.customerId,
            layer: e.layer,
            inputSummary: e.inputSummary,
            outputSummary: e.outputSummary,
            durationMs: e.durationMs,
            score: e.score,
            confidence: e.confidence,
            actionSelected: e.actionSelected,
            metadata: e.metadata,
            createdAt: e.createdAt,
          })),
        );
      },
    });

    configureAgentRoutes({
      auditLogger,
      eventProducer: agentEventProducer,
      agentEngine,
      hitlQueue,
      nbaPipeline,
      ruleStore: nbaRuleStore,
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
      listRoutingDecisions: async (tenantId, customerId, limit) => {
        const rows = await db
          .select({
            id: schema.agentSessions.id,
            customerId: schema.agentSessions.customerId,
            agentRole: schema.agentSessions.agentRole,
            confidenceAvg: schema.agentSessions.confidenceAvg,
            outcome: schema.agentSessions.outcome,
            createdAt: schema.agentSessions.createdAt,
          })
          .from(schema.agentSessions)
          .where(
            and(
              eq(schema.agentSessions.tenantId, tenantId),
              eq(schema.agentSessions.customerId, customerId),
            ),
          )
          .orderBy(desc(schema.agentSessions.createdAt))
          .limit(limit);
        return rows.map((r) => ({
          id: r.id,
          entityId: r.customerId,
          entityType: 'customer' as const,
          selectedRoute: r.agentRole,
          channel: null,
          confidence: r.confidenceAvg ?? 0,
          reasoning: r.outcome ?? 'Agent session initiated',
          sessionId: r.id,
          modelUsed: 'claude-sonnet-4-6',
          timestamp: r.createdAt.toISOString(),
        }));
      },
    });
    console.warn('[ORDR:API] Agent routes configured (NBA pipeline wired)');
  }

  // ── 6. JWT key pair ────────────────────────────────────────────────────
  try {
    activeJwtConfig = await loadKeyPair(config.auth.jwtPrivateKey, config.auth.jwtPublicKey, {
      issuer: 'ordr-connect',
      audience: 'ordr-connect',
    });
    console.warn('[ORDR:API] JWT key pair loaded');
  } catch (error: unknown) {
    console.error('[ORDR:API] FATAL: JWT key pair loading failed:', error);
    process.exit(1);
  }

  // ── 7. Configure middleware ────────────────────────────────────────────
  configureAuth(activeJwtConfig);

  // Rate limiter -- Redis-backed in production (REDIS_URL set), in-memory otherwise.
  // RedisRateLimiter shares window state across K8s pod replicas (SOC2 CC6.6).
  const redisUrl = process.env['REDIS_URL']?.trim();
  if (redisUrl !== undefined && redisUrl !== '') {
    const redisClient = new Redis(redisUrl, { lazyConnect: true });
    redisClient.on('error', (err: Error) => {
      console.error('[ORDR:API] Redis connection error:', err.message);
    });
    configureRateLimit(new RedisRateLimiter(redisClient));
    console.warn('[ORDR:API] Rate limiter initialized (Redis sliding window)');
  } else {
    configureRateLimit(new InMemoryRateLimiter());
    console.warn('[ORDR:API] Rate limiter initialized (InMemory -- set REDIS_URL for production)');
  }

  configureEventsRoute({ jwtConfig: activeJwtConfig });

  // ── 7.1. Developer portal routes ──────────────────────────────────────
  // db is non-null here — process.exit(1) in step 2 catch ensures it.
  // jwtConfig is available from step 6.
  configureDeveloperRoutes({
    jwtConfig: activeJwtConfig,
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

  // ── 7.2. Developer webhook routes (Phase 53) ──────────────────────────────
  const fieldEncryptor = new FieldEncryptor(fieldEncryptionKey);
  configureWebhookRoutes({
    auditLogger,
    fieldEncryptor,
    createWebhook: (data) =>
      db
        .insert(schema.developerWebhooks)
        .values({
          developerId: data.developerId,
          url: data.url,
          events: data.events,
          hmacSecretEncrypted: data.hmacSecretEncrypted,
          active: true,
        })
        .returning()
        .then((rows) => {
          const row = rows[0];
          if (!row) throw new Error('Insert returned no rows');
          return row;
        }),
    listWebhooks: (developerId) =>
      db
        .select()
        .from(schema.developerWebhooks)
        .where(eq(schema.developerWebhooks.developerId, developerId))
        .orderBy(asc(schema.developerWebhooks.createdAt)),
    countActiveWebhooks: async (developerId) => {
      const rows = await db
        .select({ total: count() })
        .from(schema.developerWebhooks)
        .where(
          and(
            eq(schema.developerWebhooks.developerId, developerId),
            eq(schema.developerWebhooks.active, true),
          ),
        );
      return rows[0]?.total ?? 0;
    },
    findWebhook: async (developerId, webhookId) => {
      const rows = await db
        .select()
        .from(schema.developerWebhooks)
        .where(
          and(
            eq(schema.developerWebhooks.id, webhookId),
            eq(schema.developerWebhooks.developerId, developerId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    deleteWebhook: async (developerId, webhookId) => {
      await db
        .delete(schema.developerWebhooks)
        .where(
          and(
            eq(schema.developerWebhooks.id, webhookId),
            eq(schema.developerWebhooks.developerId, developerId),
          ),
        );
    },
    toggleWebhook: async (developerId, webhookId, active) => {
      const rows = await db
        .update(schema.developerWebhooks)
        .set({ active, updatedAt: new Date() })
        .where(
          and(
            eq(schema.developerWebhooks.id, webhookId),
            eq(schema.developerWebhooks.developerId, developerId),
          ),
        )
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Webhook not found');
      return row;
    },
  });
  console.warn('[ORDR:API] Developer webhook routes configured');

  // ── 7.3. Developer agent submission routes (Phase 53) ─────────────────────
  configureDeveloperAgentRoutes({
    auditLogger,
    listAgentsByPublisher: async (publisherId) => {
      const rows = await db
        .select({
          id: schema.marketplaceAgents.id,
          name: schema.marketplaceAgents.name,
          version: schema.marketplaceAgents.version,
          status: schema.marketplaceAgents.status,
          installCount: schema.marketplaceAgents.downloads,
          createdAt: schema.marketplaceAgents.createdAt,
        })
        .from(schema.marketplaceAgents)
        .where(eq(schema.marketplaceAgents.publisherId, publisherId))
        .orderBy(desc(schema.marketplaceAgents.createdAt));
      return rows;
    },
    createMarketplaceListing: async (data) => {
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
          status: 'review',
          downloads: 0,
        })
        .returning({
          id: schema.marketplaceAgents.id,
          name: schema.marketplaceAgents.name,
          version: schema.marketplaceAgents.version,
          status: schema.marketplaceAgents.status,
          installCount: schema.marketplaceAgents.downloads,
          createdAt: schema.marketplaceAgents.createdAt,
        });
      const row = rows[0];
      if (!row) throw new Error('Insert returned no rows');
      return row;
    },
  });
  console.warn('[ORDR:API] Developer agent routes configured');

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

  // ── 8.1a Onboarding wizard ────────────────────────────────────────────────
  {
    const db = createDrizzle(dbConnection, schema);

    configureOnboardingRoutes({
      auditLogger,

      getOnboardingState: async (tenantId: string) => {
        const rows = await db
          .select({
            onboardingComplete: schema.tenants.onboardingComplete,
            onboardingStep: schema.tenants.onboardingStep,
            onboardingCompletedAt: schema.tenants.onboardingCompletedAt,
          })
          .from(schema.tenants)
          .where(eq(schema.tenants.id, tenantId))
          .limit(1);
        const row = rows[0];
        return {
          tenantId,
          complete: row?.onboardingComplete ?? false,
          step: row?.onboardingStep ?? 0,
          completedAt: row?.onboardingCompletedAt ?? null,
        };
      },

      setOnboardingStep: async (tenantId: string, step: number) => {
        await db
          .update(schema.tenants)
          .set({ onboardingStep: step, updatedAt: new Date() })
          .where(eq(schema.tenants.id, tenantId));
        return {
          tenantId,
          complete: false,
          step,
          completedAt: null,
        };
      },

      completeOnboarding: async (tenantId: string) => {
        const completedAt = new Date();
        await db
          .update(schema.tenants)
          .set({
            onboardingComplete: true,
            onboardingStep: 4,
            onboardingCompletedAt: completedAt,
            updatedAt: new Date(),
          })
          .where(eq(schema.tenants.id, tenantId));
        return {
          tenantId,
          complete: true,
          step: 4,
          completedAt,
        };
      },
    });

    console.warn('[ORDR:API] Onboarding routes configured');
  }

  // ── 8.1b Feature flags ────────────────────────────────────────────────────
  {
    const db = createDrizzle(dbConnection, schema);

    configureFeatureFlagRoutes({
      auditLogger,

      listFlags: async (tenantId: string) => {
        const rows = await db
          .select()
          .from(schema.featureFlags)
          .where(eq(schema.featureFlags.tenantId, tenantId))
          .orderBy(schema.featureFlags.flagName);
        // Cast JSONB metadata: Drizzle types jsonb as unknown; metadata is always an object
        return rows.map((r) => ({ ...r, metadata: (r.metadata ?? {}) as Record<string, unknown> }));
      },

      getFlag: async (tenantId: string, flagName: string) => {
        const rows = await db
          .select()
          .from(schema.featureFlags)
          .where(
            and(
              eq(schema.featureFlags.tenantId, tenantId),
              eq(schema.featureFlags.flagName, flagName),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (!row) return null;
        return { ...row, metadata: (row.metadata ?? {}) as Record<string, unknown> };
      },

      createFlag: async (tenantId: string, data) => {
        const inserted = await db
          .insert(schema.featureFlags)
          .values({
            tenantId,
            flagName: data.flagName,
            enabled: data.enabled,
            rolloutPct: data.rolloutPct,
            description: data.description ?? null,
            metadata: data.metadata,
          })
          .returning();
        const row = inserted[0]!;
        return { ...row, metadata: (row.metadata ?? {}) as Record<string, unknown> };
      },

      updateFlag: async (tenantId: string, flagName: string, data) => {
        const updated = await db
          .update(schema.featureFlags)
          .set({ ...data, updatedAt: new Date() })
          .where(
            and(
              eq(schema.featureFlags.tenantId, tenantId),
              eq(schema.featureFlags.flagName, flagName),
            ),
          )
          .returning();
        const row = updated[0];
        if (!row) return null;
        return { ...row, metadata: (row.metadata ?? {}) as Record<string, unknown> };
      },

      deleteFlag: async (tenantId: string, flagName: string) => {
        const deleted = await db
          .delete(schema.featureFlags)
          .where(
            and(
              eq(schema.featureFlags.tenantId, tenantId),
              eq(schema.featureFlags.flagName, flagName),
            ),
          )
          .returning();
        return deleted.length > 0;
      },
    });

    console.warn('[ORDR:API] Feature flag routes configured');
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

    // Twilio: real client when credentials are present, stub otherwise.
    // SECURITY: credentials sourced from environment only — never hardcoded (Rule 5).
    const twilioAccountSid = process.env['TWILIO_ACCOUNT_SID'];
    const twilioAuthToken = process.env['TWILIO_AUTH_TOKEN'];
    const twilioClient: TwilioClient =
      twilioAccountSid && twilioAuthToken
        ? createRealTwilioClient(twilioAccountSid, twilioAuthToken)
        : {
            messages: {
              create: async () => ({
                sid: 'stub-sid',
                status: 'sent',
                errorCode: null,
                errorMessage: null,
              }),
            },
          };
    if (!(twilioAccountSid && twilioAuthToken)) {
      console.warn(
        '[ORDR:API] Twilio not configured — SMS/voice will be stubbed (set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN)',
      );
    }

    // SendGrid: real client when API key is present, stub otherwise.
    const sendgridApiKey = process.env['SENDGRID_API_KEY'];
    const sendgridClient: SendGridClient = sendgridApiKey
      ? createRealSendGridClient(sendgridApiKey)
      : { send: async () => ({ statusCode: 202, headers: {} }) };
    if (!sendgridApiKey) {
      console.warn(
        '[ORDR:API] SendGrid not configured — email will be stubbed (set SENDGRID_API_KEY)',
      );
    }

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
      eventProducer: new EventProducer(kafkaProducer, undefined, confluentRegistry),
      consentManager: new ConsentManager(),
      consentStore: inMemoryConsentStore,
      complianceGate: new ComplianceGate(complianceEngine),
      smsProvider: new SmsProvider({
        client: twilioClient,
        fromNumber: process.env['TWILIO_FROM_NUMBER'] ?? '+15550000000',
        authToken: twilioAuthToken ?? '',
      }),
      emailProvider: new EmailProvider({
        client: sendgridClient,
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

      insertViolation: insertComplianceViolation,
    });
    console.warn('[ORDR:API] Message routes configured');
  }

  // ── Phase 6: Operational Completeness ─────────────────────────────────

  // ── P6.1. Billing routes (subscription + usage + Stripe webhooks) ─────
  const usageStore =
    config.nodeEnv === 'production' ? new DrizzleUsageStore(db) : new InMemoryUsageStore();
  configureBillingRoutes({
    subscriptionManager,
    usageTracker: new UsageTracker(usageStore),
    stripeWebhookSecret: process.env['STRIPE_WEBHOOK_SECRET'] ?? '',
  });
  console.warn('[ORDR:API] Billing routes configured');

  // ── P6.2. Realtime SSE routes (ChannelManager + EventPublisher) ─────
  const channelManager = new ChannelManager();
  channelManager.startCleanup(60_000); // prune stale connections every 60s
  const realtimeAuditLogger = {
    log: (entry: {
      readonly eventType: string;
      readonly tenantId: string;
      readonly resource: string;
      readonly resourceId: string;
      readonly action: string;
      readonly details: Record<string, unknown>;
      readonly timestamp: Date;
    }): Promise<void> =>
      auditLogger
        .log({ ...entry, eventType: 'agent.action', actorType: 'system', actorId: 'realtime' })
        .then(() => undefined),
  };
  configureRealtimeRoutes({
    channelManager,
    publisher: new EventPublisher(channelManager, realtimeAuditLogger),
    jwtConfig: activeJwtConfig,
  });
  console.warn('[ORDR:API] Realtime routes configured');

  // ── P6.3. Workflow engine routes ──────────────────────────────────────
  const workflowAuditLogger = {
    log: async (entry: {
      readonly tenantId: string;
      readonly eventType: string;
      readonly actorType: 'system' | 'user';
      readonly actorId: string;
      readonly resource: string;
      readonly resourceId: string;
      readonly action: string;
      readonly details: Record<string, unknown>;
      readonly timestamp: Date;
    }) =>
      auditLogger.log({
        ...entry,
        eventType: 'agent.action',
      }),
  };
  const workflowDb = createDrizzle(
    dbConnection,
    schema,
  ) as unknown as import('drizzle-orm/postgres-js').PostgresJsDatabase<typeof schema>;
  const isProduction = config.nodeEnv === 'production';
  const workflowInstanceStore = isProduction
    ? new DrizzleInstanceStore(workflowDb)
    : new InMemoryInstanceStore();
  const workflowEngine = new WorkflowEngine({
    definitionStore: isProduction
      ? new DrizzleDefinitionStore(workflowDb)
      : new InMemoryDefinitionStore(),
    instanceStore: workflowInstanceStore,
    stepResultStore: isProduction
      ? new DrizzleStepResultStore(workflowDb)
      : new InMemoryStepResultStore(),
    auditLogger: workflowAuditLogger,
  });
  configureWorkflowRoutes({ engine: workflowEngine, instanceStore: workflowInstanceStore });
  console.warn(
    `[ORDR:API] Workflow routes configured (${isProduction ? 'Drizzle' : 'InMemory'} store)`,
  );

  // ── P6.4. Search engine routes ────────────────────────────────────────
  const searchDb = createDrizzle(
    dbConnection,
    schema,
  ) as unknown as import('drizzle-orm/postgres-js').PostgresJsDatabase<typeof schema>;
  const searchStore = isProduction ? new DrizzleSearchStore(searchDb) : new InMemorySearchStore();
  configureSearchRoutes({
    engine: new SearchEngine(searchStore),
    indexer: new SearchIndexer(searchStore),
  });
  console.warn(
    `[ORDR:API] Search routes configured (${isProduction ? 'Drizzle' : 'InMemory'} store)`,
  );

  // ── P6.5. Scheduler routes ────────────────────────────────────────────
  const schedulerAuditLog = async (entry: {
    readonly eventType: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly action: string;
    readonly details: Record<string, unknown>;
    readonly timestamp: Date;
  }) => {
    await auditLogger.log({
      tenantId: 'system',
      eventType: entry.eventType as import('@ordr/audit').AuditEventType,
      actorType: 'system',
      actorId: 'scheduler',
      resource: entry.resource,
      resourceId: entry.resourceId,
      action: entry.action,
      details: entry.details,
      timestamp: entry.timestamp,
    });
  };
  const schedulerAlert = async (_alert: {
    readonly severity: 'p1' | 'p2' | 'p3';
    readonly jobType: string;
    readonly instanceId: string;
    readonly error: string;
    readonly timestamp: Date;
  }) => {
    // In production: page on-call via PagerDuty for p1, alert for p2/p3
    console.error('[ORDR:Scheduler] Dead-letter alert:', _alert);
  };
  const schedulerDb = createDrizzle(
    dbConnection,
    schema,
  ) as unknown as import('drizzle-orm/postgres-js').PostgresJsDatabase<typeof schema>;
  const schedulerStore = isProduction
    ? new DrizzleSchedulerStore(schedulerDb)
    : new InMemorySchedulerStore();
  const jobScheduler = new JobScheduler(schedulerStore, schedulerAuditLog, schedulerAlert);
  configureSchedulerRoutes({ scheduler: jobScheduler, store: schedulerStore });
  console.warn(
    `[ORDR:API] Scheduler routes configured (${isProduction ? 'Drizzle' : 'InMemory'} store)`,
  );

  // ── Key Rotation Check job (Phase 55) ─────────────────────────────────
  {
    const tracker = new KeyRotationTracker();

    const keyRotationDeps: KeyRotationCheckDeps = {
      isKeyApproachingExpiry: (thresholdDays: number) =>
        tracker.isApproachingExpiry(vaultClient, 'ENCRYPTION_MASTER_KEY', thresholdDays),

      runKeyRotation: async () => {
        const meta = await vaultClient.getMetadata('ENCRYPTION_MASTER_KEY');
        const oldVersion = meta.version;

        const { version: newVersion, value: newKekHex } = await tracker.requestNewVersion(
          vaultClient,
          'ENCRYPTION_MASTER_KEY',
        );

        const oldKekHex = await tracker.getVersion(
          vaultClient,
          'ENCRYPTION_MASTER_KEY',
          oldVersion,
        );

        const result = await runKeyRotation({
          oldKekHex,
          newKekHex,
          oldVersion,
          newVersion,
          pageSize: 500,

          findActiveJob: async (keyName) => {
            const rows = await db
              .select({ id: schema.keyRotationJobs.id })
              .from(schema.keyRotationJobs)
              .where(
                and(
                  eq(schema.keyRotationJobs.keyName, keyName),
                  eq(schema.keyRotationJobs.status, 'running'),
                ),
              )
              .limit(1);
            return rows[0] ?? null;
          },

          insertJob: async (params) => {
            const [row] = await db
              .insert(schema.keyRotationJobs)
              .values({
                keyName: params.keyName,
                oldVersion: params.oldVersion,
                newVersion: params.newVersion,
              })
              .returning({ id: schema.keyRotationJobs.id });
            if (row === undefined)
              throw new Error('[ORDR:VAULT] Failed to insert key_rotation_jobs row');
            return row.id;
          },

          updateJobCursor: async (jobId, lastProcessedId, rowsDone) => {
            await db
              .update(schema.keyRotationJobs)
              .set({ lastProcessedId, rowsDone })
              .where(eq(schema.keyRotationJobs.id, jobId));
          },

          completeJob: async (jobId) => {
            await db
              .update(schema.keyRotationJobs)
              .set({ status: 'completed', completedAt: new Date() })
              .where(eq(schema.keyRotationJobs.id, jobId));
          },

          failJob: async (jobId) => {
            await db
              .update(schema.keyRotationJobs)
              .set({ status: 'failed', completedAt: new Date() })
              .where(eq(schema.keyRotationJobs.id, jobId));
          },

          getPage: async (lastProcessedId, limit) => {
            if (lastProcessedId !== null) {
              return db
                .select({
                  id: schema.encryptedFields.id,
                  dek_envelope: schema.encryptedFields.dekEnvelope,
                })
                .from(schema.encryptedFields)
                .where(gt(schema.encryptedFields.id, lastProcessedId))
                .orderBy(schema.encryptedFields.id)
                .limit(limit);
            }
            return db
              .select({
                id: schema.encryptedFields.id,
                dek_envelope: schema.encryptedFields.dekEnvelope,
              })
              .from(schema.encryptedFields)
              .orderBy(schema.encryptedFields.id)
              .limit(limit);
          },

          updateRows: async (updates) => {
            for (const { id, dek_envelope } of updates) {
              await db
                .update(schema.encryptedFields)
                .set({ dekEnvelope: dek_envelope })
                .where(eq(schema.encryptedFields.id, id));
            }
          },

          emitAudit: async (eventType: string, details: Record<string, unknown>): Promise<void> => {
            await auditLogger.log({
              tenantId: 'system',
              eventType: eventType as import('@ordr/audit').AuditEventType,
              actorType: 'system',
              actorId: 'scheduler:key-rotation-check',
              resource: 'encryption_key',
              resourceId: 'ENCRYPTION_MASTER_KEY',
              action: eventType,
              details,
              timestamp: new Date(),
            });
          },
        });
        // Soft-delete old KEK version — retains data for 7-year audit (Rule 3), marks inactive
        await tracker.markVersionInactive(vaultClient, 'ENCRYPTION_MASTER_KEY', oldVersion);
        return result;
      },

      auditLogger: {
        log: async (event): Promise<void> => {
          await auditLogger.log({
            tenantId: event.tenantId,
            eventType: event.eventType as import('@ordr/audit').AuditEventType,
            actorType: event.actorType as import('@ordr/audit').ActorType,
            actorId: event.actorId,
            resource: event.resource,
            resourceId: event.resourceId,
            action: event.action,
            details: event.details,
            timestamp: event.timestamp,
          });
        },
      },
    };

    await jobScheduler.registerJob(
      createKeyRotationCheckDefinition(),
      createKeyRotationCheckHandler(keyRotationDeps),
    );
    console.warn('[ORDR:API] Key rotation check job registered');
  }

  // ── P6.5b. DSR Routes (GDPR Art. 12, 15, 17, 20) ────────────────────────
  {
    const dsrEventProducer = new EventProducer(kafkaProducer, undefined, confluentRegistry);
    configureDsrRoutes({
      createDsr: async (params) => {
        const result = await db
          .insert(schema.dataSubjectRequests)
          .values({
            tenantId: params.tenantId,
            customerId: params.customerId,
            type: params.type,
            requestedBy: params.requestedBy,
            reason: params.reason ?? null,
            deadlineAt: params.deadlineAt,
          })
          .returning();
        if (!result[0]) throw new Error('DSR insert returned no row');
        return result[0] as never;
      },
      listDsrs: async (params) => {
        const conditions = [
          eq(schema.dataSubjectRequests.tenantId, params.tenantId),
          ...(params.status !== undefined
            ? [eq(schema.dataSubjectRequests.status, params.status as never)]
            : []),
          ...(params.type !== undefined
            ? [eq(schema.dataSubjectRequests.type, params.type as never)]
            : []),
        ];
        const whereClause = and(...conditions);
        const offset = (params.page - 1) * params.limit;
        const [items, overdueRows] = await Promise.all([
          db
            .select()
            .from(schema.dataSubjectRequests)
            .where(whereClause)
            .limit(params.limit)
            .offset(offset),
          db
            .select({ cnt: count() })
            .from(schema.dataSubjectRequests)
            .where(
              and(
                eq(schema.dataSubjectRequests.tenantId, params.tenantId),
                eq(schema.dataSubjectRequests.status, 'pending' as never),
              ),
            ),
        ]);
        return {
          items: items as never,
          total: items.length,
          overdue_count: overdueRows[0]?.cnt ?? 0,
        };
      },
      getDsr: async (params) => {
        const dsrs = await db
          .select()
          .from(schema.dataSubjectRequests)
          .where(
            and(
              eq(schema.dataSubjectRequests.id, params.dsrId),
              eq(schema.dataSubjectRequests.tenantId, params.tenantId),
            ),
          )
          .limit(1);
        if (!dsrs[0]) return null;
        const exports = await db
          .select()
          .from(schema.dsrExports)
          .where(eq(schema.dsrExports.dsrId, params.dsrId))
          .limit(1);
        const exp = exports[0];
        return {
          dsr: dsrs[0] as never,
          export: exp
            ? {
                expiresAt: exp.expiresAt.toISOString(),
                checksumSha256: exp.checksumSha256,
                s3Key: exp.s3Key,
                s3Bucket: exp.s3Bucket,
                fileSizeBytes: exp.fileSizeBytes ?? null,
              }
            : null,
        };
      },
      approveDsr: async (params) => {
        const rows = await db
          .update(schema.dataSubjectRequests)
          .set({ status: 'approved' as never, updatedAt: new Date() })
          .where(
            and(
              eq(schema.dataSubjectRequests.id, params.dsrId),
              eq(schema.dataSubjectRequests.tenantId, params.tenantId),
              eq(schema.dataSubjectRequests.status, 'pending' as never),
            ),
          )
          .returning();
        if (!rows[0])
          throw Object.assign(new Error('DSR not pending or not found'), {
            code: 'DSR_STATE_ERROR',
          });
        return rows[0] as never;
      },
      rejectDsr: async (params) => {
        const rows = await db
          .update(schema.dataSubjectRequests)
          .set({
            status: 'rejected' as never,
            rejectionReason: params.rejectionReason,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.dataSubjectRequests.id, params.dsrId),
              eq(schema.dataSubjectRequests.tenantId, params.tenantId),
              eq(schema.dataSubjectRequests.status, 'pending' as never),
            ),
          )
          .returning();
        if (!rows[0])
          throw Object.assign(new Error('DSR not pending or not found'), {
            code: 'DSR_STATE_ERROR',
          });
        return rows[0] as never;
      },
      cancelDsr: async (params) => {
        const rows = await db
          .update(schema.dataSubjectRequests)
          .set({ status: 'cancelled' as never, updatedAt: new Date() })
          .where(
            and(
              eq(schema.dataSubjectRequests.id, params.dsrId),
              eq(schema.dataSubjectRequests.tenantId, params.tenantId),
              eq(schema.dataSubjectRequests.status, 'pending' as never),
            ),
          )
          .returning();
        if (!rows[0])
          throw Object.assign(new Error('DSR not pending or not found'), {
            code: 'DSR_STATE_ERROR',
          });
        return rows[0] as never;
      },
      publishApproved: async (params) => {
        await dsrEventProducer.publish(TOPICS.DSR_EVENTS, {
          id: crypto.randomUUID(),
          type: EventType.DSR_APPROVED,
          tenantId: params.tenantId,
          payload: params,
          metadata: {
            correlationId: crypto.randomUUID(),
            causationId: crypto.randomUUID(),
            source: 'api',
            version: 1,
          },
          timestamp: new Date().toISOString(),
        });
      },
      auditLogger,
    });
    console.warn('[ORDR:API] DSR routes configured');
  }

  // ── P6.5c. Compliance dashboard routes (Phase 58) ────────────────────────
  {
    const mapViolation = (row: typeof schema.complianceViolations.$inferSelect) => ({
      id: row.id,
      rule: row.ruleName,
      regulation: row.regulation as ViolationRegulation,
      severity: row.severity,
      description: row.description,
      customerId: row.customerId ?? null,
      customerName: null,
      timestamp: row.detectedAt.toISOString(),
      resolved: row.resolved,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      resolvedBy: row.resolvedBy ?? null,
      resolutionNote: row.resolutionNote ?? null,
    });

    configureComplianceDashboardRoutes({
      auditLogger,

      listViolations: async (tenantId, opts) => {
        const conditions: SQL[] = [eq(schema.complianceViolations.tenantId, tenantId)];
        if (opts.regulation !== undefined) {
          conditions.push(eq(schema.complianceViolations.regulation, opts.regulation as never));
        }
        if (opts.resolved !== undefined) {
          conditions.push(eq(schema.complianceViolations.resolved, opts.resolved));
        }
        const offset = (opts.page - 1) * opts.pageSize;
        const [rows, countRows] = await Promise.all([
          db
            .select()
            .from(schema.complianceViolations)
            .where(and(...conditions))
            .orderBy(desc(schema.complianceViolations.detectedAt))
            .limit(opts.pageSize)
            .offset(offset),
          db
            .select({ n: count() })
            .from(schema.complianceViolations)
            .where(and(...conditions)),
        ]);
        return {
          items: rows.map(mapViolation),
          total: countRows[0]?.n ?? 0,
        };
      },

      getViolation: async (tenantId, id) => {
        const rows = await db
          .select()
          .from(schema.complianceViolations)
          .where(
            and(
              eq(schema.complianceViolations.tenantId, tenantId),
              eq(schema.complianceViolations.id, id),
            ),
          )
          .limit(1);
        return rows[0] ? mapViolation(rows[0]) : null;
      },

      resolveViolation: async (tenantId, id, data) => {
        const rows = await db
          .update(schema.complianceViolations)
          .set({
            resolved: true,
            resolvedAt: new Date(),
            resolvedBy: data.resolvedBy,
            resolutionNote: data.resolutionNote,
          })
          .where(
            and(
              eq(schema.complianceViolations.tenantId, tenantId),
              eq(schema.complianceViolations.id, id),
              eq(schema.complianceViolations.resolved, false),
            ),
          )
          .returning();
        return rows[0] ? mapViolation(rows[0]) : null;
      },

      getViolationCounts: async (tenantId) => {
        const rows = await db
          .select({
            regulation: schema.complianceViolations.regulation,
            resolved: schema.complianceViolations.resolved,
            n: count(),
          })
          .from(schema.complianceViolations)
          .where(eq(schema.complianceViolations.tenantId, tenantId))
          .groupBy(schema.complianceViolations.regulation, schema.complianceViolations.resolved);

        const result: Record<string, { open: number; resolved: number }> = {};
        for (const row of rows) {
          const reg = row.regulation;
          if (!result[reg]) result[reg] = { open: 0, resolved: 0 };
          if (row.resolved) result[reg].resolved += row.n;
          else result[reg].open += row.n;
        }
        return result;
      },

      getConsentRates: async (tenantId) => {
        const rows = await db
          .select({
            channel: schema.contacts.channel,
            total: count(),
            consented: sql<number>`COUNT(*) FILTER (WHERE ${schema.contacts.consentStatus} = 'opted_in')`,
          })
          .from(schema.contacts)
          .where(eq(schema.contacts.tenantId, tenantId))
          .groupBy(schema.contacts.channel);

        return rows.map((row) => ({
          channel: row.channel,
          total: row.total,
          consented: row.consented,
          percentage: row.total > 0 ? Math.round((row.consented / row.total) * 1000) / 10 : 0,
        }));
      },

      getLastAuditTime: async (tenantId) => {
        const rows = await db
          .select({ ts: max(schema.complianceRecords.enforcedAt) })
          .from(schema.complianceRecords)
          .where(eq(schema.complianceRecords.tenantId, tenantId));
        return rows[0]?.ts ?? null;
      },
    });
    console.warn('[ORDR:API] Compliance dashboard routes configured');
  }

  // ── P6.6. CRM integration routes ────────────────────────────────────────
  // Adapters are initialized with a lightweight fetch-based HTTP client.
  // Credentials come from per-tenant OAuth tokens stored in DB (not env vars).
  const fetchHttpClient = {
    get: async (url: string, headers: Readonly<Record<string, string>>) => {
      const res = await fetch(url, { headers });
      const body: unknown = res.headers.get('content-type')?.includes('application/json')
        ? await res.json()
        : await res.text();
      return { status: res.status, headers: Object.fromEntries(res.headers), body };
    },
    post: async (url: string, body: unknown, headers: Readonly<Record<string, string>>) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resBody: unknown = res.headers.get('content-type')?.includes('application/json')
        ? await res.json()
        : await res.text();
      return { status: res.status, headers: Object.fromEntries(res.headers), body: resBody };
    },
    patch: async (url: string, body: unknown, headers: Readonly<Record<string, string>>) => {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resBody: unknown = res.headers.get('content-type')?.includes('application/json')
        ? await res.json()
        : await res.text();
      return { status: res.status, headers: Object.fromEntries(res.headers), body: resBody };
    },
    delete: async (url: string, headers: Readonly<Record<string, string>>) => {
      const res = await fetch(url, { method: 'DELETE', headers });
      const resBody: unknown = res.headers.get('content-type')?.includes('application/json')
        ? await res.json()
        : await res.text();
      return { status: res.status, headers: Object.fromEntries(res.headers), body: resBody };
    },
  };
  const crmAdapters = new Map<string, CRMAdapter>([
    ['salesforce', new SalesforceAdapter(fetchHttpClient) as unknown as CRMAdapter],
    ['hubspot', new HubSpotAdapter(fetchHttpClient) as unknown as CRMAdapter],
  ]);
  const crmFieldEncryptor = new FieldEncryptor(fieldEncryptionKey);
  const integrationEventProducer = new EventProducer(kafkaProducer, undefined, confluentRegistry);
  configureIntegrationRoutes({
    adapters: crmAdapters,
    lookupTenantByProvider: async ({ provider, instanceUrl, portalId }) => {
      // Look up tenant by instance_url (Salesforce) or portalId (HubSpot)
      if (provider === 'salesforce' && instanceUrl !== undefined) {
        const rows = await db
          .select({ tenantId: schema.integrationConfigs.tenantId })
          .from(schema.integrationConfigs)
          .where(
            and(
              eq(schema.integrationConfigs.provider, 'salesforce' as never),
              eq(schema.integrationConfigs.instanceUrl, instanceUrl),
            ),
          )
          .limit(1);
        return rows[0]?.tenantId ?? null;
      }
      if (provider === 'hubspot' && portalId !== undefined) {
        const rows = await db
          .select({ tenantId: schema.integrationConfigs.tenantId })
          .from(schema.integrationConfigs)
          .where(
            and(
              eq(schema.integrationConfigs.provider, 'hubspot' as never),
              eq(schema.integrationConfigs.instanceUrl, portalId),
            ),
          )
          .limit(1);
        return rows[0]?.tenantId ?? null;
      }
      return null;
    },
    insertWebhookLog: async ({ tenantId, provider, eventType, payloadHash, signatureValid }) => {
      const rows = await db
        .insert(schema.webhookLogs)
        .values({
          tenantId: tenantId ?? null,
          provider: provider as never,
          eventType,
          payloadHash,
          signatureValid,
        })
        .returning({ id: schema.webhookLogs.id });
      const row = rows[0];
      if (!row) throw new Error('Failed to insert webhook log');
      return row.id;
    },
    updateWebhookLogProcessed: async ({ id }) => {
      await db
        .update(schema.webhookLogs)
        .set({ processed: true })
        .where(eq(schema.webhookLogs.id, id));
    },
    getWebhookSecret: async ({ tenantId, provider }) => {
      const rows = await db
        .select({ webhookSecretEnc: schema.integrationConfigs.webhookSecretEnc })
        .from(schema.integrationConfigs)
        .where(
          and(
            eq(schema.integrationConfigs.tenantId, tenantId),
            eq(schema.integrationConfigs.provider, provider as never),
          ),
        )
        .limit(1);
      return rows[0]?.webhookSecretEnc ?? null;
    },
    isRecentDuplicateWebhook: async ({ provider, payloadHash, withinMs }) => {
      const cutoff = new Date(Date.now() - withinMs);
      const rows = await db
        .select({ id: schema.webhookLogs.id })
        .from(schema.webhookLogs)
        .where(
          and(
            eq(schema.webhookLogs.provider, provider as never),
            eq(schema.webhookLogs.payloadHash, payloadHash),
            gte(schema.webhookLogs.receivedAt, cutoff),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
    fieldEncryptor: crmFieldEncryptor,
    credManagerDeps: {
      getIntegrationConfig: async ({ tenantId, provider }) => {
        const rows = await db
          .select()
          .from(schema.integrationConfigs)
          .where(
            and(
              eq(schema.integrationConfigs.tenantId, tenantId),
              eq(schema.integrationConfigs.provider, provider as never),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (!row) return null;
        return {
          id: row['id'],
          tenantId: row['tenantId'],
          provider: row['provider'],
          status: row['status'],
          accessTokenEnc: row['accessTokenEnc'],
          refreshTokenEnc: row['refreshTokenEnc'],
          webhookSecretEnc: row['webhookSecretEnc'],
          tokenExpiresAt: row['tokenExpiresAt'],
          scopes: row['scopes'],
          instanceUrl: row['instanceUrl'],
        };
      },
      upsertIntegrationConfig: async (params) => {
        await db
          .insert(schema.integrationConfigs)
          .values({
            tenantId: params.tenantId,
            provider: params.provider as never,
            accessTokenEnc: params.accessTokenEnc,
            refreshTokenEnc: params.refreshTokenEnc,
            tokenExpiresAt: params.tokenExpiresAt,
            scopes: params.scopes,
            instanceUrl: params.instanceUrl ?? null,
            status: 'connected' as never,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [schema.integrationConfigs.tenantId, schema.integrationConfigs.provider],
            set: {
              accessTokenEnc: params.accessTokenEnc,
              refreshTokenEnc: params.refreshTokenEnc,
              tokenExpiresAt: params.tokenExpiresAt,
              scopes: params.scopes,
              instanceUrl: params.instanceUrl ?? null,
              status: 'connected' as never,
              updatedAt: new Date(),
            },
          });
      },
      setIntegrationStatus: async ({ tenantId, provider, status, lastError }) => {
        await db
          .update(schema.integrationConfigs)
          .set({ status: status as never, lastError: lastError ?? null, updatedAt: new Date() })
          .where(
            and(
              eq(schema.integrationConfigs.tenantId, tenantId),
              eq(schema.integrationConfigs.provider, provider as never),
            ),
          );
      },
      nullifyCredentials: async ({ tenantId, provider }) => {
        await db
          .update(schema.integrationConfigs)
          .set({
            accessTokenEnc: null,
            refreshTokenEnc: null,
            status: 'disconnected' as never,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.integrationConfigs.tenantId, tenantId),
              eq(schema.integrationConfigs.provider, provider as never),
            ),
          );
      },
      auditLogger,
    },
    oauthConfigs: new Map([
      [
        'salesforce',
        {
          clientId: process.env['SALESFORCE_CLIENT_ID'] ?? '',
          clientSecret: process.env['SALESFORCE_CLIENT_SECRET'] ?? '',
          redirectUri: process.env['SALESFORCE_REDIRECT_URI'] ?? '',
          scopes: ['api', 'refresh_token'],
        },
      ],
      [
        'hubspot',
        {
          clientId: process.env['HUBSPOT_CLIENT_ID'] ?? '',
          clientSecret: process.env['HUBSPOT_CLIENT_SECRET'] ?? '',
          redirectUri: process.env['HUBSPOT_REDIRECT_URI'] ?? '',
          scopes: ['contacts', 'crm.objects.deals.read', 'crm.objects.deals.write'],
        },
      ],
    ]),
    listFieldMappings: async ({ tenantId, provider, direction }) => {
      const conditions = [
        eq(schema.integrationFieldMappings.tenantId, tenantId),
        eq(schema.integrationFieldMappings.provider, provider as never),
      ];
      if (direction !== undefined) {
        conditions.push(eq(schema.integrationFieldMappings.direction, direction as never));
      }
      const rows = await db
        .select()
        .from(schema.integrationFieldMappings)
        .where(and(...conditions));
      return rows.map((r) => ({
        id: r.id,
        entityType: r.entityType,
        direction: r.direction,
        sourceField: r.sourceField,
        targetField: r.targetField,
        transform: r.transform,
      }));
    },
    replaceFieldMappings: async ({ tenantId, provider, mappings }) => {
      await db.transaction(async (tx) => {
        await tx
          .delete(schema.integrationFieldMappings)
          .where(
            and(
              eq(schema.integrationFieldMappings.tenantId, tenantId),
              eq(schema.integrationFieldMappings.provider, provider as never),
            ),
          );
        if (mappings.length > 0) {
          await tx.insert(schema.integrationFieldMappings).values(
            mappings.map((m) => ({
              tenantId,
              provider: provider as never,
              entityType: m.entityType as never,
              direction: m.direction as never,
              sourceField: m.sourceField,
              targetField: m.targetField,
              transform: m.transform ?? null,
            })),
          );
        }
      });
    },
    getAdapterDefaultMappings: (_provider) => {
      // Default mappings are defined per-adapter; return empty array as baseline.
      // Adapter-specific defaults will be wired in Task 16 when adapters expose defaultMappings().
      return [];
    },
    disconnectIntegration: async ({ tenantId, provider }) => {
      await db
        .update(schema.integrationConfigs)
        .set({
          accessTokenEnc: null,
          refreshTokenEnc: null,
          status: 'disconnected' as never,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.integrationConfigs.tenantId, tenantId),
            eq(schema.integrationConfigs.provider, provider as never),
          ),
        );
    },
    getEntityMappingsByExternalIds: async ({ tenantId, provider, entityType, externalIds }) => {
      if (externalIds.length === 0) return [];
      const rows = await db
        .select({
          externalId: schema.integrationEntityMappings.externalId,
          ordrId: schema.integrationEntityMappings.ordrId,
          updatedAt: schema.integrationEntityMappings.updatedAt,
        })
        .from(schema.integrationEntityMappings)
        .where(
          and(
            eq(schema.integrationEntityMappings.tenantId, tenantId),
            eq(schema.integrationEntityMappings.provider, provider as never),
            eq(schema.integrationEntityMappings.entityType, entityType as never),
            inArray(schema.integrationEntityMappings.externalId, [...externalIds]),
          ),
        );
      return rows.map((r) => ({
        externalId: r.externalId,
        ordrId: r.ordrId,
        lastSyncedAt: r.updatedAt,
      }));
    },
    upsertCustomerFromSync: async ({ tenantId, externalId, ordrEntityId, encryptedFields }) => {
      if (ordrEntityId !== undefined) {
        // Update existing customer by ORDR ID
        await db
          .update(schema.customers)
          .set({
            name: encryptedFields.name,
            ...(encryptedFields.email !== undefined && { email: encryptedFields.email }),
            ...(encryptedFields.phone !== undefined && { phone: encryptedFields.phone }),
            updatedAt: new Date(),
          })
          .where(
            and(eq(schema.customers.id, ordrEntityId), eq(schema.customers.tenantId, tenantId)),
          );
        return ordrEntityId;
      }
      // Insert or update by externalId (ON CONFLICT on tenant_id + external_id)
      const rows = await db
        .insert(schema.customers)
        .values({
          tenantId,
          externalId,
          type: 'individual' as never,
          status: 'active' as never,
          name: encryptedFields.name,
          email: encryptedFields.email ?? null,
          phone: encryptedFields.phone ?? null,
          lifecycleStage: 'lead' as never,
        })
        .onConflictDoUpdate({
          target: [schema.customers.tenantId, schema.customers.externalId],
          set: {
            name: encryptedFields.name,
            ...(encryptedFields.email !== undefined && { email: encryptedFields.email }),
            ...(encryptedFields.phone !== undefined && { phone: encryptedFields.phone }),
            updatedAt: new Date(),
          },
        })
        .returning({ id: schema.customers.id });
      const row = rows[0];
      if (!row) throw new Error('Failed to upsert customer from sync');
      return row.id;
    },
    insertSyncEvent: async ({
      tenantId,
      integrationId,
      provider,
      direction,
      entityType,
      entityId,
      externalId,
      status,
      conflictResolution,
      errorSummary,
    }) => {
      await db.insert(schema.syncEvents).values({
        tenantId,
        integrationId,
        provider: provider as never,
        direction: direction as never,
        entityType: entityType as never,
        entityId: entityId ?? null,
        externalId: externalId ?? null,
        status: status as never,
        conflictResolution: conflictResolution ?? null,
        errorSummary: errorSummary ?? null,
      });
    },
    upsertEntityMapping: async ({ tenantId, provider, entityType, ordrId, externalId }) => {
      await db
        .insert(schema.integrationEntityMappings)
        .values({
          tenantId,
          provider: provider as never,
          entityType: entityType as never,
          ordrId,
          externalId,
        })
        .onConflictDoUpdate({
          target: [
            schema.integrationEntityMappings.tenantId,
            schema.integrationEntityMappings.provider,
            schema.integrationEntityMappings.entityType,
            schema.integrationEntityMappings.externalId,
          ],
          set: {
            ordrId,
            updatedAt: new Date(),
          },
        });
    },
    updateLastSyncAt: async ({ tenantId, provider, syncedAt }) => {
      await db
        .update(schema.integrationConfigs)
        .set({ lastSyncAt: syncedAt, updatedAt: new Date() })
        .where(
          and(
            eq(schema.integrationConfigs.tenantId, tenantId),
            eq(schema.integrationConfigs.provider, provider as never),
          ),
        );
    },
    listOrdrContactsForOutbound: async ({ tenantId, limit, offset }) => {
      return db
        .select({
          id: schema.customers.id,
          externalId: schema.customers.externalId,
          name: schema.customers.name,
          email: schema.customers.email,
          phone: schema.customers.phone,
          updatedAt: schema.customers.updatedAt,
        })
        .from(schema.customers)
        .where(eq(schema.customers.tenantId, tenantId))
        .orderBy(asc(schema.customers.updatedAt))
        .limit(limit)
        .offset(offset);
    },
    getSyncHistory: async ({
      tenantId,
      provider,
      entityType,
      status,
      direction,
      limit,
      offset,
    }) => {
      const conditions = [
        eq(schema.syncEvents.tenantId, tenantId),
        eq(schema.syncEvents.provider, provider as never),
      ];
      if (entityType !== undefined)
        conditions.push(eq(schema.syncEvents.entityType, entityType as never));
      if (status !== undefined) conditions.push(eq(schema.syncEvents.status, status as never));
      if (direction !== undefined)
        conditions.push(eq(schema.syncEvents.direction, direction as never));
      const [rows, countRows] = await Promise.all([
        db
          .select()
          .from(schema.syncEvents)
          .where(and(...conditions))
          .orderBy(desc(schema.syncEvents.syncedAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ total: count() })
          .from(schema.syncEvents)
          .where(and(...conditions)),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          provider: r.provider,
          direction: r.direction,
          entityType: r.entityType,
          entityId: r.entityId ?? null,
          externalId: r.externalId ?? null,
          status: r.status,
          conflictResolution: r.conflictResolution ?? null,
          errorSummary: r.errorSummary ?? null,
          syncedAt: r.syncedAt.toISOString(),
        })),
        total: countRows[0]?.total ?? 0,
      };
    },
    eventProducer: integrationEventProducer,
    auditLogger,
  });
  console.warn('[ORDR:API] Integration routes configured (salesforce, hubspot)');

  // ── P6.7. Tenant management routes ──────────────────────────────────────
  configureTenantRoutes({
    getTenant: async (id) => {
      const rows = await db
        .select({
          id: schema.tenants.id,
          name: schema.tenants.name,
          slug: schema.tenants.slug,
          plan: schema.tenants.plan,
          status: schema.tenants.status,
          isolationTier: schema.tenants.isolationTier,
          createdAt: schema.tenants.createdAt,
          updatedAt: schema.tenants.updatedAt,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, id))
        .limit(1);
      return rows[0];
    },
    listTenants: async (filters) => {
      const conditions = [
        filters.status !== undefined ? eq(schema.tenants.status, filters.status) : undefined,
        filters.plan !== undefined ? eq(schema.tenants.plan, filters.plan) : undefined,
      ].filter((c): c is NonNullable<typeof c> => c !== undefined);
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const cols = {
        id: schema.tenants.id,
        name: schema.tenants.name,
        slug: schema.tenants.slug,
        plan: schema.tenants.plan,
        status: schema.tenants.status,
        isolationTier: schema.tenants.isolationTier,
        createdAt: schema.tenants.createdAt,
        updatedAt: schema.tenants.updatedAt,
      };
      const [rows, countRows] = await Promise.all([
        db
          .select(cols)
          .from(schema.tenants)
          .where(where)
          .orderBy(desc(schema.tenants.createdAt))
          .limit(filters.limit)
          .offset(filters.offset),
        db.select({ total: count() }).from(schema.tenants).where(where),
      ]);
      return { data: rows, total: countRows[0]?.total ?? 0 };
    },
    createTenant: async (data) => {
      const rows = await db
        .insert(schema.tenants)
        .values({
          name: data.name,
          slug: data.slug,
          plan: data.plan,
          isolationTier: data.isolationTier,
          status: 'active',
        })
        .returning({
          id: schema.tenants.id,
          name: schema.tenants.name,
          slug: schema.tenants.slug,
          plan: schema.tenants.plan,
          status: schema.tenants.status,
          isolationTier: schema.tenants.isolationTier,
          createdAt: schema.tenants.createdAt,
          updatedAt: schema.tenants.updatedAt,
        });
      if (rows[0] === undefined) throw new Error('[ORDR:API] Failed to create tenant');
      return rows[0];
    },
    updateTenant: async (id, patch) => {
      const rows = await db
        .update(schema.tenants)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.tenants.id, id))
        .returning({
          id: schema.tenants.id,
          name: schema.tenants.name,
          slug: schema.tenants.slug,
          plan: schema.tenants.plan,
          status: schema.tenants.status,
          isolationTier: schema.tenants.isolationTier,
          createdAt: schema.tenants.createdAt,
          updatedAt: schema.tenants.updatedAt,
        });
      return rows[0];
    },
    updateTenantStatus: async (id, status) => {
      const rows = await db
        .update(schema.tenants)
        .set({ status, updatedAt: new Date() })
        .where(eq(schema.tenants.id, id))
        .returning({
          id: schema.tenants.id,
          name: schema.tenants.name,
          slug: schema.tenants.slug,
          plan: schema.tenants.plan,
          status: schema.tenants.status,
          isolationTier: schema.tenants.isolationTier,
          createdAt: schema.tenants.createdAt,
          updatedAt: schema.tenants.updatedAt,
        });
      return rows[0];
    },
    auditLogger,
  });
  console.warn('[ORDR:API] Tenant routes configured');

  // ── 8.9. SCIM stores + handler (Phase 56) ─────────────────────────────
  // Wires the DrizzleUserStore, DrizzleGroupStore, and DrizzleTokenStore into
  // the SCIMHandler and configures the module-level deps for scimRouter.
  // Also registers the WorkOS webhook route on the Hono app when
  // WORKOS_WEBHOOK_SECRET is set (optional — not all deployments use WorkOS).
  const scimDb = createDrizzle(
    dbConnection,
    schema,
  ) as unknown as import('drizzle-orm/node-postgres').NodePgDatabase;
  const scimUserStore = new DrizzleUserStore(scimDb);
  const scimGroupStore = new DrizzleGroupStore(scimDb);
  const scimTokenStore = new DrizzleTokenStore(scimDb);
  const scimHandler = new SCIMHandler({
    userStore: scimUserStore,
    groupStore: scimGroupStore,
    db: scimDb,
    eventProducer: new EventProducer(kafkaProducer, undefined, confluentRegistry),
    auditLogger,
  });
  configureSCIMRoutes({ scimHandler, tokenStore: scimTokenStore });
  console.warn('[ORDR:API] SCIM routes configured');

  // ── 9. Create and start Hono app ───────────────────────────────────────
  // MetricsRegistry collects Node.js runtime defaults + ORDR-specific metrics.
  // /metrics is network-restricted — NOT behind the public load balancer.
  const metricsRegistry = new MetricsRegistry();

  const app = createApp({
    corsOrigins: config.corsOrigins,
    nodeEnv: config.nodeEnv,
    metrics: metricsRegistry,
  });

  // ── 9.1. WorkOS webhook route (optional — requires WORKOS_WEBHOOK_SECRET) ─
  // Mounted on the Hono app after createApp() so it shares all middleware.
  // Only active when WORKOS_WEBHOOK_SECRET is configured (Rule 5: optional
  // integration, never required in all deployments).
  const workosSecret = config.workosWebhookSecret ?? process.env['WORKOS_WEBHOOK_SECRET'];
  if (workosSecret !== undefined && workosSecret.length >= 32) {
    app.route(
      '/',
      createWorkOSWebhookRouter({
        webhookSecret: workosSecret,
        handler: scimHandler,
        tokenStore: scimTokenStore,
        db: scimDb,
      }),
    );
    console.warn('[ORDR:API] WorkOS webhook route configured — POST /webhooks/workos');
  }

  server = serve(
    {
      fetch: app.fetch,
      port: config.port,
    },
    (info) => {
      console.warn(`[ORDR:API] Server listening on port ${String(info.port)}`);
      console.warn(`[ORDR:API] Health check: http://localhost:${String(info.port)}/health`);
      console.warn(`[ORDR:API] Metrics:      http://localhost:${String(info.port)}/metrics`);
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

  // 5. Stop Vault token renewal timer and SecretStore polling interval
  if (vaultClientInstance !== null) {
    vaultClientInstance.destroy();
    console.warn('[ORDR:API] Vault client token renewal timer cleared');
  }
  secretStore.destroy();
  console.warn('[ORDR:API] SecretStore polling interval cleared');

  // 6. Close database connection pool
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
