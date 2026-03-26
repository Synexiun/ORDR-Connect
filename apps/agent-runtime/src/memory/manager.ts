/**
 * Memory manager — 3-tier memory system for agent context
 *
 * Tiers:
 * 1. Working Memory — in-memory session state (existing AgentMemory)
 * 2. Episodic Memory — structured records of past sessions per customer
 * 3. Semantic Memory — vector embeddings for similarity search (pgvector)
 *
 * SECURITY (CLAUDE.md Rules 6, 9):
 * - NO raw PII in episodic or semantic memory — only tokenized references
 * - Tenant isolation on ALL memory queries
 * - Memory promotion strips sensitive data before persistence
 * - Semantic search results are tenant-scoped
 *
 * COMPLIANCE:
 * - Memory access logged for HIPAA §164.312(b)
 * - Tenant isolation per SOC2 CC6.1
 * - Data minimization per ISO 27001 A.8.2
 */

import { randomUUID } from 'node:crypto';
import {
  type Result,
  ok,
  err,
  type AppError,
  InternalError,
} from '@ordr/core';
import type { AgentRole } from '@ordr/core';
import { AgentMemory } from '../memory.js';

// ─── Episodic Memory Types ──────────────────────────────────────

/**
 * A structured record of a completed agent session.
 *
 * SECURITY: keyObservations and outcome contain metadata only —
 * NO raw PII/PHI. Customer referenced by tokenized ID.
 */
export interface EpisodicMemory {
  readonly id: string;
  readonly sessionId: string;
  readonly customerId: string;
  readonly tenantId: string;
  readonly agentRole: AgentRole;
  readonly keyObservations: readonly string[];
  readonly outcome: string;
  readonly confidence: number;
  readonly timestamp: Date;
}

// ─── Semantic Memory Types ──────────────────────────────────────

/**
 * A semantic search match from the vector store.
 */
export interface SemanticMatch {
  readonly content: string;
  readonly similarity: number;
  readonly source: string;
}

// ─── Episodic Store Interface ───────────────────────────────────

/**
 * Storage interface for episodic memories.
 * In-memory for testing, PostgreSQL-backed in production.
 */
export interface EpisodicStore {
  save(memory: EpisodicMemory): Promise<Result<void, AppError>>;
  findByCustomer(
    customerId: string,
    tenantId: string,
    limit: number,
  ): Promise<Result<readonly EpisodicMemory[], AppError>>;
  findBySession(
    sessionId: string,
    tenantId: string,
  ): Promise<Result<EpisodicMemory | undefined, AppError>>;
}

// ─── In-Memory Episodic Store ───────────────────────────────────

export class InMemoryEpisodicStore implements EpisodicStore {
  private readonly memories: Map<string, EpisodicMemory> = new Map();

  async save(memory: EpisodicMemory): Promise<Result<void, AppError>> {
    this.memories.set(memory.id, memory);
    return ok(undefined);
  }

  async findByCustomer(
    customerId: string,
    tenantId: string,
    limit: number,
  ): Promise<Result<readonly EpisodicMemory[], AppError>> {
    const results: EpisodicMemory[] = [];

    for (const memory of this.memories.values()) {
      if (memory.customerId === customerId && memory.tenantId === tenantId) {
        results.push(memory);
      }
    }

    // Sort by timestamp descending (most recent first)
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return ok(results.slice(0, limit));
  }

  async findBySession(
    sessionId: string,
    tenantId: string,
  ): Promise<Result<EpisodicMemory | undefined, AppError>> {
    for (const memory of this.memories.values()) {
      if (memory.sessionId === sessionId && memory.tenantId === tenantId) {
        return ok(memory);
      }
    }
    return ok(undefined);
  }

  /** Test helper — get total count of stored memories. */
  get size(): number {
    return this.memories.size;
  }

  /** Test helper — clear all memories. */
  clear(): void {
    this.memories.clear();
  }
}

// ─── MemoryManager ──────────────────────────────────────────────

export class MemoryManager {
  private readonly episodicStore: EpisodicStore;

  constructor(episodicStore?: EpisodicStore) {
    this.episodicStore = episodicStore ?? new InMemoryEpisodicStore();
  }

  /**
   * Create a new working memory instance for an agent session.
   * This is the tier-1 in-memory state used during the agent loop.
   */
  createWorkingMemory(): AgentMemory {
    return new AgentMemory();
  }

  /**
   * Promote working memory to episodic memory when a session ends.
   *
   * Extracts key observations and outcome from the working memory,
   * strips any raw PII/PHI, and saves as a structured episodic record.
   *
   * SECURITY: Only metadata is preserved — step types, tool names,
   * confidence scores, and outcome status. NO raw content.
   */
  async promoteToEpisodic(
    sessionId: string,
    customerId: string,
    tenantId: string,
    agentRole: AgentRole,
    memory: AgentMemory,
    outcome: string,
  ): Promise<Result<void, AppError>> {
    // Extract key observations — metadata only, no raw content
    const keyObservations: string[] = [];
    const steps = memory.getAllSteps();

    for (const step of steps) {
      if (step.type === 'act' && step.toolUsed !== undefined) {
        keyObservations.push(
          `Tool "${step.toolUsed}" executed (confidence: ${String(step.confidence)})`,
        );
      }
      if (step.type === 'check' && step.output.includes('HITL')) {
        keyObservations.push('Decision routed to human review');
      }
      if (step.type === 'check' && step.output.toLowerCase().includes('compliance')) {
        keyObservations.push('compliance gate triggered');
      }
    }

    // Calculate average confidence across all steps
    const avgConfidence = steps.length > 0
      ? steps.reduce((sum, s) => sum + s.confidence, 0) / steps.length
      : 0;

    const episodicMemory: EpisodicMemory = {
      id: randomUUID(),
      sessionId,
      customerId,
      tenantId,
      agentRole,
      keyObservations,
      outcome,
      confidence: avgConfidence,
      timestamp: new Date(),
    };

    return this.episodicStore.save(episodicMemory);
  }

  /**
   * Retrieve episodic memories for a customer.
   * Used to give agents context about prior interactions.
   *
   * SECURITY: All queries are tenant-scoped.
   */
  async getEpisodic(
    customerId: string,
    tenantId: string,
    limit: number = 10,
  ): Promise<Result<readonly EpisodicMemory[], AppError>> {
    return this.episodicStore.findByCustomer(customerId, tenantId, limit);
  }

  /**
   * Get episodic memory for a specific session.
   *
   * SECURITY: Tenant isolation enforced.
   */
  async getEpisodicBySession(
    sessionId: string,
    tenantId: string,
  ): Promise<Result<EpisodicMemory | undefined, AppError>> {
    return this.episodicStore.findBySession(sessionId, tenantId);
  }

  /**
   * Promote episodic memories to semantic embeddings.
   *
   * STUB for MVP — interface designed for real embedding pipeline later.
   * In production, this would batch process episodic memories into
   * pgvector embeddings for similarity search.
   */
  async promoteToSemantic(
    _tenantId: string,
  ): Promise<Result<void, AppError>> {
    // MVP stub — returns success, no-op
    // Production: batch episodic memories -> embedding model -> pgvector
    return ok(undefined);
  }

  /**
   * Search semantic memory for similar content.
   *
   * STUB for MVP — returns empty results.
   * In production, this queries pgvector with the embedded query.
   */
  async searchSemantic(
    _query: string,
    _tenantId: string,
    _topK: number = 5,
  ): Promise<Result<readonly SemanticMatch[], AppError>> {
    // MVP stub — returns empty array
    // Production: embed query -> pgvector similarity search -> return matches
    return ok([]);
  }

  /**
   * Get the underlying episodic store.
   * Exposed for testing only.
   */
  getEpisodicStore(): EpisodicStore {
    return this.episodicStore;
  }
}
