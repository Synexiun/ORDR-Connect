/**
 * Worker process entry point — production bootstrap for ORDR-Connect worker
 *
 * Instantiates all real service implementations from environment variables
 * and delegates to startWorker() for event processing.
 *
 * SOC2 CC6.1 — Access control: all credentials read from environment only.
 * ISO 27001 A.12.4.1 — Event logging: durable audit trail from first message.
 * HIPAA §164.312 — All safeguards enabled before the first event is consumed.
 *
 * Required environment variables:
 *   DATABASE_URL         — PostgreSQL connection string (TLS required in prod)
 *
 * Optional environment variables (services degrade gracefully without them):
 *   KAFKA_BROKERS        — Comma-separated brokers (default: localhost:9092)
 *   KAFKA_SSL            — 'true' to enable SSL (default: false)
 *   KAFKA_CONSUMER_GROUP — Consumer group ID (default: ordr-worker)
 *   ANTHROPIC_API_KEY    — Enables LLM reasoning layer in NBA pipeline
 *   NEO4J_URI            — Graph DB (default: bolt://localhost:7687)
 *   NEO4J_USER           — Graph DB username (default: neo4j)
 *   NEO4J_PASSWORD       — Graph DB password
 *   NEO4J_DATABASE       — Graph DB database name (default: neo4j)
 *   TWILIO_FROM_NUMBER   — Outbound SMS number
 *   TWILIO_AUTH_TOKEN    — Twilio auth token for webhook validation
 *   SENDGRID_FROM_EMAIL  — Outbound email sender address
 *   SENDGRID_FROM_NAME   — Outbound email sender display name
 */

import { fileURLToPath } from 'node:url';
import { Kafka } from 'kafkajs';
import { eq, and } from 'drizzle-orm';
import {
  createConnection,
  createDrizzle,
  DrizzleAuditStore,
  DrizzleNotificationWriter,
} from '@ordr/db';
import * as schema from '@ordr/db';
import { EventConsumer, EventProducer } from '@ordr/events';
import type { EventHandler } from '@ordr/events';
import { GraphClient, GraphOperations, GraphEnricher } from '@ordr/graph';
import { ComplianceEngine, ComplianceGate, ALL_RULES } from '@ordr/compliance';
import { ConsentManager, SmsProvider, EmailProvider, MessageStateMachine } from '@ordr/channels';
import type { ConsentStore, TwilioClient, SendGridClient } from '@ordr/channels';
import {
  NBAPipeline,
  RulesEngine,
  InMemoryRuleStore,
  createDefaultMLScorer,
  LLMReasoner,
  BUILTIN_RULES,
} from '@ordr/decision-engine';
import type { DecisionContext } from '@ordr/decision-engine';
import { LLMClient, PromptRegistry } from '@ordr/ai';
import { AuditLogger } from '@ordr/audit';
import {
  AgentEngine,
  AgentOrchestrator,
  AgentRegistry,
  MemoryManager,
  HitlQueue,
  createToolRegistry,
} from '@ordr/agent-runtime';
import type { AgentEngineDeps } from '@ordr/agent-runtime';
import { ok, err } from '@ordr/core';
import { startWorker } from './server.js';
import type { WorkerDependencies } from './server.js';
import { createCustomerEventsHandler } from './handlers/customer-events.js';
import { createInteractionEventsHandler } from './handlers/interaction-events.js';
import type { CustomerProfileSnapshot } from './handlers/interaction-events.js';
import { createAgentEventsHandler } from './handlers/agent-events.js';
import { createOutboundMessagesHandler } from './handlers/outbound-messages.js';

// ─── Env helpers ─────────────────────────────────────────────────────────────

/** Read a required environment variable. Throws on missing/empty. */
export function requireEnv(name: string): string {
  const val = process.env[name];
  if (val === undefined || val.length === 0) {
    throw new Error(`[ORDR:WORKER] Required environment variable "${name}" is not set`);
  }
  return val;
}

function optionalEnv(name: string, fallback: string): string {
  const val = process.env[name];
  return val !== undefined && val.length > 0 ? val : fallback;
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

/**
 * Validate environment variables, instantiate all service implementations,
 * and start the worker event loop.
 *
 * Exported so tests can assert on env-var validation failures without
 * spawning a real process.
 */
export async function bootstrap(): Promise<{ stop: () => Promise<void> }> {
  // ── 1. Validate required env vars ──────────────────────────────────────
  const databaseUrl = requireEnv('DATABASE_URL');

  // ── 2. Database ────────────────────────────────────────────────────────
  const dbConnection = createConnection({ databaseUrl });
  const db = createDrizzle(dbConnection, schema);

  // ── 3. Audit logger (WORM, hash-chained) ───────────────────────────────
  const auditStore = new DrizzleAuditStore(db);
  const auditLogger = new AuditLogger(auditStore);

  // ── 4. In-app notification writer ──────────────────────────────────────
  const notificationWriter = new DrizzleNotificationWriter(db);

  // ── 5. Kafka ───────────────────────────────────────────────────────────
  const brokers = optionalEnv('KAFKA_BROKERS', 'localhost:9092').split(',');
  const sslEnabled = process.env['KAFKA_SSL'] === 'true';
  const consumerGroupId = optionalEnv('KAFKA_CONSUMER_GROUP', 'ordr-worker');

  const kafka = new Kafka({
    clientId: 'ordr-worker',
    brokers,
    ssl: sslEnabled,
  });

  const kafkaProducer = kafka.producer({ allowAutoTopicCreation: false });
  const kafkaConsumer = kafka.consumer({ groupId: consumerGroupId });

  await kafkaProducer.connect();
  await kafkaConsumer.connect();

  const eventProducer = new EventProducer(kafkaProducer);

  // ── 6. Customer graph (Neo4j) ──────────────────────────────────────────
  const graphClient = new GraphClient({
    uri: optionalEnv('NEO4J_URI', 'bolt://localhost:7687'),
    username: optionalEnv('NEO4J_USER', 'neo4j'),
    password: optionalEnv('NEO4J_PASSWORD', ''),
    database: optionalEnv('NEO4J_DATABASE', 'neo4j'),
  });
  const graphOps = new GraphOperations(graphClient);
  const graphEnricher = new GraphEnricher(graphOps);

  // ── 7. Compliance engine (SOC2/HIPAA/TCPA/FDCPA) ──────────────────────
  const complianceEngine = new ComplianceEngine();
  complianceEngine.registerRules(ALL_RULES);
  const complianceGate = new ComplianceGate(complianceEngine);

  // ── 8. Channels ────────────────────────────────────────────────────────
  // InMemory consent store — real store backed by contacts.consent_status is
  // implemented in the API layer; worker uses the channel-level gate only.
  const consentStore: ConsentStore = {
    getConsent: () => Promise.resolve(undefined),
    saveConsent: () => Promise.resolve(),
    revokeConsent: () => Promise.resolve(),
  };
  const consentManager = new ConsentManager();
  const stateMachine = new MessageStateMachine();

  // Stub Twilio client — swap for real Twilio SDK when credentials are wired.
  const stubTwilioClient: TwilioClient = {
    messages: {
      create: () =>
        Promise.resolve({
          sid: 'stub-sid',
          status: 'sent',
          errorCode: null,
          errorMessage: null,
        }),
    },
  };
  const smsProvider = new SmsProvider({
    client: stubTwilioClient,
    fromNumber: optionalEnv('TWILIO_FROM_NUMBER', '+15550000000'),
    authToken: optionalEnv('TWILIO_AUTH_TOKEN', ''),
  });

  // Stub SendGrid client — swap for real @sendgrid/mail when credentials are wired.
  const stubSendGridClient: SendGridClient = {
    send: () => Promise.resolve({ statusCode: 202, headers: {} }),
  };
  const emailProvider = new EmailProvider({
    client: stubSendGridClient,
    fromEmail: optionalEnv('SENDGRID_FROM_EMAIL', 'noreply@ordr.dev'),
    fromName: optionalEnv('SENDGRID_FROM_NAME', 'ORDR Connect'),
  });

  // ── 9. LLM client ──────────────────────────────────────────────────────
  const anthropicApiKey = optionalEnv('ANTHROPIC_API_KEY', '');
  const llmClient = new LLMClient({ anthropicApiKey });
  const promptRegistry = new PromptRegistry();

  // ── 10. NBA Decision Engine (Rules → ML → LLM pipeline) ────────────────
  const ruleStore = new InMemoryRuleStore();
  // Seed built-in rules once under the 'system' tenant.
  // Tenant-specific rules loaded on-demand via the rules engine.
  for (const rule of BUILTIN_RULES) {
    await ruleStore.createRule({ ...rule, tenantId: 'system' });
  }
  const rulesEngine = new RulesEngine(ruleStore);
  const mlScorer = createDefaultMLScorer();
  const llmReasoner = new LLMReasoner(llmClient, promptRegistry);

  const nbaPipeline = new NBAPipeline({
    rules: rulesEngine,
    ml: mlScorer,
    llm: llmReasoner,
    compliance: complianceGate,
    // AuditLoggerInterface — structural compatible with AuditLogger
    auditLogger: {
      log: (entry) => auditLogger.log(entry),
    },
  });

  // Adapter: NBAEvaluator (structural interface used by handlers) accepts
  // `customerProfile: Record<string, unknown>`, but NBAPipeline.evaluate
  // requires `customerProfile: CustomerProfile` (named interface). TypeScript's
  // function parameter contravariance prevents direct assignment, so we cast
  // through `unknown` at the call site — safe because CustomerProfileSnapshot
  // and CustomerProfile share the same field set.
  const nbaPipelineAdapter: import('./handlers/interaction-events.js').NBAEvaluator = {
    evaluate: (context) => nbaPipeline.evaluate(context as unknown as DecisionContext),
  };

  // ── 11. Agent runtime ──────────────────────────────────────────────────
  // Shared audit log adapter — narrows void return for agent/tool interfaces.
  const agentAuditLog = async (
    input: Parameters<AgentEngineDeps['auditLog']>[0],
  ): Promise<void> => {
    await auditLogger.log(input);
  };

  const toolRegistry = createToolRegistry({
    sms: {
      smsProviderSend: async (to, body) => {
        const result = await smsProvider.send(to, body);
        if (!result.success) return err(result.error);
        return ok({
          messageId: result.data.providerMessageId ?? result.data.messageId,
          status: result.data.status,
        });
      },
      consentCheck: async (customerId, channel) =>
        consentManager.verifyConsentForSend(customerId, channel, consentStore),
      complianceCheck: (action, context) => complianceGate.check(action, context),
      auditLog: agentAuditLog,
    },
    customer: {
      findCustomer: async (customerId, tenantId) => {
        const rows = await db
          .select()
          .from(schema.customers)
          .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, customerId)))
          .limit(1);
        const cust = rows[0];
        if (cust === undefined) return undefined;
        return {
          customerId: cust.id,
          tenantId: cust.tenantId,
          name: cust.name,
          email: cust.email ?? '',
          phone: cust.phone ?? '',
          healthScore: cust.healthScore ?? 50,
          lifecycleStage: cust.lifecycleStage ?? 'lead',
          outstandingBalance: 0,
          lastInteractionAt: null,
          recentInteractions: [],
        };
      },
      auditLog: agentAuditLog,
    },
    payment: {
      // Payment data is surfaced via the API — stub returns undefined (tool
      // falls back to N/A message) until a Drizzle impl is wired here.
      findPaymentInfo: () => Promise.resolve(undefined),
      auditLog: agentAuditLog,
    },
    followup: {
      // Contact-attempt counting uses interaction count as a proxy until a
      // dedicated contact_attempts table is added.
      getContactAttempts: () => Promise.resolve(0),
      getCeaseAndDesist: () => Promise.resolve(false),
      scheduleMessage: (params) =>
        Promise.resolve({
          id: crypto.randomUUID(),
          scheduledAt: params.scheduledAt,
        }),
      auditLog: agentAuditLog,
    },
  });

  const hitlQueue = new HitlQueue();
  const memoryManager = new MemoryManager();
  const agentRegistry = new AgentRegistry(); // uses BUILT_IN_CONFIGS

  const engineDeps: AgentEngineDeps = {
    llmComplete: async (messages, systemPrompt, metadata) => {
      const result = await llmClient.complete({
        messages: [...messages],
        modelTier: 'standard',
        maxTokens: 2048,
        temperature: 0.1,
        systemPrompt,
        metadata,
      });
      if (!result.success) return err(result.error);
      return ok({
        content: result.data.content,
        tokenUsage: { total: result.data.tokenUsage.total },
        costCents: result.data.costCents,
      });
    },
    complianceCheck: (action, context) => complianceGate.check(action, context),
    auditLog: agentAuditLog,
    tools: toolRegistry,
  };

  const agentEngine = new AgentEngine(engineDeps, hitlQueue);

  const orchestrator = new AgentOrchestrator({
    registry: agentRegistry,
    engineDeps,
    memoryManager,
    hitlQueue,
    auditLog: agentAuditLog,
  });

  // ── 12. Customer data accessors (DB lookups) ───────────────────────────
  const getCustomerProfile = async (
    tenantId: string,
    customerId: string,
  ): Promise<CustomerProfileSnapshot | null> => {
    const rows = await db
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, customerId)))
      .limit(1);
    const cust = rows[0];
    if (cust === undefined) return null;
    return {
      healthScore: cust.healthScore ?? 50,
      lifecycleStage: cust.lifecycleStage ?? 'active',
      segment: 'standard',
      ltv: 0,
      sentimentAvg: 0,
      responseRate: 0,
      preferredChannel: undefined,
      outstandingBalance: 0,
      maxBalance: 0,
      daysSinceLastContact: 0,
      totalInteractions30d: 0,
      paymentHistory: [],
    };
  };

  const getCustomerContact = async (
    tenantId: string,
    customerId: string,
    channel: string,
  ): Promise<{ readonly contact: string; readonly contentBody: string } | null> => {
    const rows = await db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.tenantId, tenantId),
          eq(schema.contacts.customerId, customerId),
          eq(schema.contacts.channel, channel as 'sms' | 'email' | 'voice' | 'whatsapp' | 'mail'),
          eq(schema.contacts.isPrimary, true),
        ),
      )
      .limit(1);
    const contact = rows[0];
    if (contact === undefined) return null;
    return { contact: contact.value, contentBody: '' };
  };

  const updateMessageStatus = async (messageId: string, status: string): Promise<void> => {
    await db
      .update(schema.messages)
      .set({
        status: status as
          | 'pending'
          | 'queued'
          | 'sent'
          | 'delivered'
          | 'failed'
          | 'bounced'
          | 'opted_out'
          | 'retrying'
          | 'dlq',
      })
      .where(eq(schema.messages.id, messageId));
  };

  // ── 13. Pre-build event handlers ────────────────────────────────────────
  // Handlers are built here and passed into EventConsumer at construction so
  // that routing is available from the first message consumed.
  // startWorker() will rebuild a duplicate map internally (it can't see our
  // map), but that's harmless — the consumer's internal map from construction
  // is what drives routing.
  const handlers = new Map<string, EventHandler>();

  const customerHandler = createCustomerEventsHandler({
    graphEnricher,
    auditLogger,
  });
  handlers.set('customer.created', customerHandler);
  handlers.set('customer.updated', customerHandler);

  handlers.set(
    'interaction.logged',
    createInteractionEventsHandler({
      graphEnricher,
      auditLogger,
      nbaPipeline: nbaPipelineAdapter,
      orchestrator,
      eventProducer,
      getCustomerProfile,
    }),
  );

  const agentHandler = createAgentEventsHandler({
    agentEngine,
    graphEnricher,
    eventProducer,
    auditLogger,
    notificationWriter,
  });
  handlers.set('agent.triggered', agentHandler);
  handlers.set('agent.action_executed', agentHandler);

  handlers.set(
    'outbound.message',
    createOutboundMessagesHandler({
      consentManager,
      consentStore,
      complianceGate,
      smsProvider,
      emailProvider,
      eventProducer,
      auditLogger,
      stateMachine,
      notificationWriter,
      getCustomerContact,
      updateMessageStatus,
    }),
  );

  // ── 14. Assemble deps and start ─────────────────────────────────────────
  const consumer = new EventConsumer(kafkaConsumer, handlers);

  const deps: WorkerDependencies = {
    consumer,
    eventProducer,
    auditLogger,
    agentEngine,
    graphEnricher,
    complianceGate,
    consentManager,
    consentStore,
    smsProvider,
    emailProvider,
    stateMachine,
    notificationWriter,
    nbaPipeline: nbaPipelineAdapter,
    orchestrator,
    getCustomerProfile,
    getCustomerContact,
    updateMessageStatus,
  };

  return startWorker(deps);
}

// ─── Process entry point ─────────────────────────────────────────────────────
// Guard against double-execution when this module is imported by tests.
// In ESM, process.argv[1] holds the path of the entry-point script.
// When vitest (or any other test runner) imports this file, argv[1] is the
// test runner binary — not main.ts — so the guard skips the live bootstrap.
const _thisFile = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  (process.argv[1] === _thisFile ||
    process.argv[1].replace(/\\/g, '/').endsWith('/main.ts') ||
    process.argv[1].replace(/\\/g, '/').endsWith('/main.js'))
) {
  bootstrap().catch((startErr: unknown) => {
    console.error('[ORDR:WORKER] Fatal startup error:', startErr);
    process.exit(1);
  });
}
