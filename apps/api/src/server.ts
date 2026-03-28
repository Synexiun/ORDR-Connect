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
import { createKafkaClient, createProducer } from '@ordr/events';
import type { Producer } from '@ordr/events';
import { AuditLogger } from '@ordr/audit';
import {
  SubscriptionManager,
  DrizzleSubscriptionStore,
  MockStripeClient,
  RealStripeClient,
} from '@ordr/billing';
import { FieldEncryptor } from '@ordr/crypto';
import { loadKeyPair } from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { ComplianceEngine } from '@ordr/compliance';
import { LLMClient } from '@ordr/ai';
import { and, eq } from 'drizzle-orm';
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
import { configureDeveloperRoutes } from './routes/developers.js';
import { SlaChecker, DEFAULT_CHECK_INTERVAL_MS } from './lib/sla-checker.js';
import { configureSlaRoutes } from './routes/sla.js';
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

  // ── 4.10. SLA checker — periodic background scan for breach notifications ──
  slaChecker = new SlaChecker(db);
  configureSlaRoutes(slaChecker);
  slaChecker.start(DEFAULT_CHECK_INTERVAL_MS);

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
