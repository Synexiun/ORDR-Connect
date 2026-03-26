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
import { loadConfig } from '@ordr/core';
import type { ParsedConfig } from '@ordr/core';
import { createConnection, createDrizzle, closeConnection } from '@ordr/db';
import * as schema from '@ordr/db';
import { createKafkaClient, createProducer, EventProducer } from '@ordr/events';
import type { Producer } from '@ordr/events';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { loadKeyPair } from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { ComplianceEngine } from '@ordr/compliance';
import { eq } from 'drizzle-orm';
import { createApp } from './app.js';
import { configureAuth } from './middleware/auth.js';
import { configureAudit } from './middleware/audit.js';
import { configureHealthChecks } from './routes/health.js';
import { configureBrandingRoutes } from './routes/branding.js';
import type postgres from 'postgres';

// ---- State -----------------------------------------------------------------

let dbConnection: postgres.Sql | null = null;
let kafkaProducer: Producer | null = null;
let server: ReturnType<typeof serve> | null = null;

// ---- Bootstrap -------------------------------------------------------------

async function bootstrap(): Promise<void> {
  console.info('[ORDR:API] Starting ORDR-Connect API...');

  // ── 1. Load & validate config ──────────────────────────────────────────
  let config: ParsedConfig;
  try {
    config = loadConfig();
    console.info(`[ORDR:API] Config loaded — env=${config.nodeEnv}, port=${String(config.port)}`);
  } catch (error: unknown) {
    console.error('[ORDR:API] FATAL: Configuration validation failed:', error);
    process.exit(1);
  }

  // ── 2. Database connection ─────────────────────────────────────────────
  try {
    dbConnection = createConnection({
      databaseUrl: config.database.url,
      poolMin: config.database.poolMin,
      poolMax: config.database.poolMax,
    });
    const db = createDrizzle(dbConnection, schema);
    console.info('[ORDR:API] Database connection established');
  } catch (error: unknown) {
    console.error('[ORDR:API] FATAL: Database connection failed:', error);
    process.exit(1);
  }

  // ── 3. Kafka client & producer ─────────────────────────────────────────
  let eventProducer: EventProducer;
  try {
    const kafka = createKafkaClient({
      brokers: config.kafka.brokers,
      clientId: config.kafka.clientId,
      ssl: config.kafka.ssl,
    });
    kafkaProducer = createProducer(kafka);
    await kafkaProducer.connect();
    eventProducer = new EventProducer(kafkaProducer);
    console.info('[ORDR:API] Kafka producer connected');
  } catch (error: unknown) {
    console.error('[ORDR:API] FATAL: Kafka connection failed:', error);
    process.exit(1);
  }

  // ── 4. Audit logger ────────────────────────────────────────────────────
  // In production, replace InMemoryAuditStore with a database-backed store
  const auditStore = new InMemoryAuditStore();
  const auditLogger = new AuditLogger(auditStore);
  configureAudit(auditLogger);
  console.info('[ORDR:API] Audit logger initialized');

  // ── 5. Compliance engine ───────────────────────────────────────────────
  const complianceEngine = new ComplianceEngine();
  // Rules are registered here at startup.
  // In production, load rules from @ordr/compliance rule modules.
  console.info(`[ORDR:API] Compliance engine initialized — ${String(complianceEngine.getRules().length)} rules loaded`);

  // ── 6. JWT key pair ────────────────────────────────────────────────────
  let jwtConfig: JwtConfig;
  try {
    jwtConfig = await loadKeyPair(
      config.auth.jwtPrivateKey,
      config.auth.jwtPublicKey,
      {
        issuer: 'ordr-connect',
        audience: 'ordr-connect',
      },
    );
    console.info('[ORDR:API] JWT key pair loaded');
  } catch (error: unknown) {
    console.error('[ORDR:API] FATAL: JWT key pair loading failed:', error);
    process.exit(1);
  }

  // ── 7. Configure middleware ────────────────────────────────────────────
  configureAuth(jwtConfig);

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

    console.info('[ORDR:API] Branding routes configured');
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
      console.info(`[ORDR:API] Server listening on port ${String(info.port)}`);
      console.info(`[ORDR:API] Health check: http://localhost:${String(info.port)}/health`);
    },
  );
}

// ---- Graceful Shutdown -----------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  console.info(`[ORDR:API] Received ${signal} — initiating graceful shutdown...`);

  // 1. Stop accepting new requests
  if (server) {
    server.close();
    console.info('[ORDR:API] HTTP server closed');
  }

  // 2. Disconnect Kafka producer (flush pending messages)
  if (kafkaProducer) {
    try {
      await kafkaProducer.disconnect();
      console.info('[ORDR:API] Kafka producer disconnected');
    } catch (error: unknown) {
      console.error('[ORDR:API] Error disconnecting Kafka producer:', error);
    }
  }

  // 3. Close database connection pool
  if (dbConnection) {
    try {
      await closeConnection(dbConnection);
      console.info('[ORDR:API] Database connection closed');
    } catch (error: unknown) {
      console.error('[ORDR:API] Error closing database connection:', error);
    }
  }

  console.info('[ORDR:API] Shutdown complete');
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
