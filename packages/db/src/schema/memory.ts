/**
 * Memory Storage Schema — agent_memories + sentiment_history
 *
 * SECURITY (CLAUDE.md Rules 1, 2, 3, 6):
 * - content column stores ENCRYPTED data (AES-256-GCM, field-level)
 * - embedding column uses pgvector (1536-dim for ada-002 compatibility)
 * - All queries MUST be scoped by tenant_id (RLS enforced)
 * - No PHI stored in metadata or sentiment tables
 * - Audit logging on all reads/writes (handled at application layer)
 *
 * SOC2 CC6.1 — Granular access controls per tenant.
 * HIPAA §164.312(a)(2)(iv) — Encryption of ePHI at rest.
 * ISO 27001 A.8.10 — Information deletion via cryptographic erasure.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  jsonb,
  real,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const sentimentLabelEnum = pgEnum('sentiment_label', [
  'negative',
  'neutral',
  'positive',
]);

// ---------------------------------------------------------------------------
// agent_memories — Long-term semantic memory with pgvector embeddings
//
// Content is ALWAYS encrypted before storage (field-level encryption).
// Embedding vectors are derived from plaintext BEFORE encryption and
// stored as float arrays for similarity search.
// Cryptographic erasure: destroy the encryption key to erase all memories.
// ---------------------------------------------------------------------------

export const agentMemories = pgTable(
  'agent_memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    sessionId: varchar('session_id', { length: 255 }).notNull(),

    /** ENCRYPTED — AES-256-GCM field-level encrypted content */
    content: text('content').notNull(),

    /**
     * pgvector embedding (1536 dimensions for OpenAI ada-002 / Cohere embed-v3).
     * Stored as a text representation of the vector since Drizzle ORM
     * does not natively support the pgvector `vector` type.
     * At migration time, create as: embedding vector(1536)
     *
     * Application layer casts to/from number[] <-> vector.
     */
    embedding: text('embedding').notNull(),

    /** Non-PHI metadata: tags, source, memory_type, etc. */
    metadata: jsonb('metadata').notNull().default('{}'),

    /** Cosine similarity score from last search hit (nullable, set by application) */
    similarityScore: real('similarity_score'),

    /** Number of times this memory has been consolidated / merged */
    consolidationCount: integer('consolidation_count').notNull().default(0),

    /** Key ID for cryptographic erasure — references the encryption key used */
    keyId: varchar('key_id', { length: 255 }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_memories_tenant_id_idx').on(table.tenantId),
    index('agent_memories_tenant_session_idx').on(table.tenantId, table.sessionId),
    index('agent_memories_tenant_created_idx').on(table.tenantId, table.createdAt),
    // NOTE: pgvector index (ivfflat or hnsw) must be created via raw SQL migration:
    // CREATE INDEX agent_memories_embedding_idx ON agent_memories
    //   USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
  ],
);

// ---------------------------------------------------------------------------
// sentiment_history — Customer sentiment tracking over time
//
// NEVER stores raw message text. Only stores a SHA-256 hash of the
// message for deduplication and correlation, plus the numeric score.
//
// SOC2 CC7.2 — Monitoring for anomalous sentiment patterns.
// HIPAA: No PHI in this table — only scores and hashed references.
// ---------------------------------------------------------------------------

export const sentimentHistory = pgTable(
  'sentiment_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** Customer being analyzed — NOT a FK to avoid coupling */
    customerId: varchar('customer_id', { length: 255 }).notNull(),

    /** Sentiment score: -1.0 (very negative) to 1.0 (very positive) */
    score: real('score').notNull(),

    /** Categorical label derived from score */
    label: sentimentLabelEnum('label').notNull(),

    /** Model confidence in the analysis: 0.0 to 1.0 */
    confidence: real('confidence').notNull(),

    /** SHA-256 hash of the original message — NEVER the message itself */
    messageHash: varchar('message_hash', { length: 64 }).notNull(),

    analyzedAt: timestamp('analyzed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sentiment_history_tenant_id_idx').on(table.tenantId),
    index('sentiment_history_tenant_customer_idx').on(table.tenantId, table.customerId),
    index('sentiment_history_tenant_analyzed_idx').on(table.tenantId, table.analyzedAt),
  ],
);
