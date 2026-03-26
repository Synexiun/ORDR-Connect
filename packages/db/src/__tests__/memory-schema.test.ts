/**
 * Memory Schema Tests — validates table definitions, columns, constraints
 *
 * Verifies:
 * - agent_memories table structure, columns, and types
 * - sentiment_history table structure, columns, and types
 * - Enum values for sentiment_label
 * - Tenant isolation columns present on all tables
 * - Schema barrel exports from index
 *
 * SECURITY: These tests verify compliance with:
 * - Rule 1: content column exists (encrypted at application layer)
 * - Rule 2: tenant_id column present on all tables
 * - Rule 6: sentiment_history uses message_hash, not plaintext
 */

import { describe, it, expect } from 'vitest';
import {
  agentMemories,
  sentimentHistory,
  sentimentLabelEnum,
} from '../schema/memory.js';

// ─── agent_memories table ───────────────────────────────────────

describe('agent_memories schema', () => {
  it('exports the agentMemories table', () => {
    expect(agentMemories).toBeDefined();
  });

  it('has all required columns', () => {
    const columns = Object.keys(agentMemories);
    expect(columns).toContain('id');
    expect(columns).toContain('tenantId');
    expect(columns).toContain('sessionId');
    expect(columns).toContain('content');
    expect(columns).toContain('embedding');
    expect(columns).toContain('metadata');
    expect(columns).toContain('similarityScore');
    expect(columns).toContain('consolidationCount');
    expect(columns).toContain('keyId');
    expect(columns).toContain('createdAt');
    expect(columns).toContain('updatedAt');
  });

  it('has id as primary key with uuid type', () => {
    const col = agentMemories.id;
    expect(col.dataType).toBe('string');
    expect(col.notNull).toBe(true);
    expect(col.columnType).toBe('PgUUID');
  });

  it('has tenantId as not null (tenant isolation)', () => {
    expect(agentMemories.tenantId.notNull).toBe(true);
  });

  it('has sessionId as not null', () => {
    expect(agentMemories.sessionId.notNull).toBe(true);
  });

  it('has content as not null (encrypted field)', () => {
    expect(agentMemories.content.notNull).toBe(true);
  });

  it('has embedding as not null (vector storage)', () => {
    expect(agentMemories.embedding.notNull).toBe(true);
  });

  it('has metadata as not null with JSONB type', () => {
    expect(agentMemories.metadata.notNull).toBe(true);
    expect(agentMemories.metadata.columnType).toBe('PgJsonb');
  });

  it('has keyId as not null (for cryptographic erasure)', () => {
    expect(agentMemories.keyId.notNull).toBe(true);
  });

  it('has createdAt as not null', () => {
    expect(agentMemories.createdAt.notNull).toBe(true);
  });

  it('has updatedAt as not null', () => {
    expect(agentMemories.updatedAt.notNull).toBe(true);
  });
});

// ─── sentiment_history table ────────────────────────────────────

describe('sentiment_history schema', () => {
  it('exports the sentimentHistory table', () => {
    expect(sentimentHistory).toBeDefined();
  });

  it('has all required columns', () => {
    const columns = Object.keys(sentimentHistory);
    expect(columns).toContain('id');
    expect(columns).toContain('tenantId');
    expect(columns).toContain('customerId');
    expect(columns).toContain('score');
    expect(columns).toContain('label');
    expect(columns).toContain('confidence');
    expect(columns).toContain('messageHash');
    expect(columns).toContain('analyzedAt');
  });

  it('has id as primary key with uuid type', () => {
    const col = sentimentHistory.id;
    expect(col.dataType).toBe('string');
    expect(col.notNull).toBe(true);
    expect(col.columnType).toBe('PgUUID');
  });

  it('has tenantId as not null (tenant isolation)', () => {
    expect(sentimentHistory.tenantId.notNull).toBe(true);
  });

  it('has customerId as not null', () => {
    expect(sentimentHistory.customerId.notNull).toBe(true);
  });

  it('has score as not null (real type)', () => {
    expect(sentimentHistory.score.notNull).toBe(true);
  });

  it('has label as not null (enum type)', () => {
    expect(sentimentHistory.label.notNull).toBe(true);
  });

  it('has confidence as not null', () => {
    expect(sentimentHistory.confidence.notNull).toBe(true);
  });

  it('has messageHash as not null (SHA-256 hash, not plaintext)', () => {
    expect(sentimentHistory.messageHash.notNull).toBe(true);
  });

  it('has analyzedAt as not null', () => {
    expect(sentimentHistory.analyzedAt.notNull).toBe(true);
  });

  it('uses messageHash instead of raw message text (PHI protection)', () => {
    const columns = Object.keys(sentimentHistory);
    // MUST NOT have a plaintext message column
    expect(columns).not.toContain('message');
    expect(columns).not.toContain('messageText');
    expect(columns).not.toContain('rawMessage');
    // MUST have hash column
    expect(columns).toContain('messageHash');
  });
});

// ─── Enums ──────────────────────────────────────────────────────

describe('memory enums', () => {
  it('sentimentLabelEnum has correct values', () => {
    expect(sentimentLabelEnum.enumValues).toEqual(['negative', 'neutral', 'positive']);
  });
});

// ─── Barrel Export Verification ─────────────────────────────────

describe('schema index exports', () => {
  it('re-exports all memory tables and enums from index', async () => {
    const schema = await import('../schema/index.js');
    expect(schema.agentMemories).toBeDefined();
    expect(schema.sentimentHistory).toBeDefined();
    expect(schema.sentimentLabelEnum).toBeDefined();
  });
});
