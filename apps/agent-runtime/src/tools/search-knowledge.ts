/**
 * Knowledge base search tool — tenant-isolated internal KB retrieval
 *
 * SECURITY (CLAUDE.md Rules 2, 6, 9):
 * - ALL queries include tenant_id for tenant isolation
 * - Search results NEVER include cross-tenant data
 * - Audit log records the search (query metadata, no result content)
 *
 * COMPLIANCE:
 * - Data access logged per ISO 27001 A.12.4
 * - Tenant isolation enforced per SOC2 CC6.1
 */

import { z } from 'zod';
import {
  type Result,
  ok,
  err,
  type AppError,
  ValidationError,
} from '@ordr/core';
import type { AgentTool, AgentContext } from '../types.js';

// ─── Tool Parameter Schema ──────────────────────────────────────

const searchKnowledgeParamsSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(20).optional().default(5),
});

// ─── Knowledge Article Type ─────────────────────────────────────

export interface KnowledgeArticle {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly category: string;
  readonly relevanceScore: number;
}

// ─── Dependency Interface ───────────────────────────────────────

export interface SearchKnowledgeDeps {
  readonly searchKB: (
    query: string,
    tenantId: string,
    maxResults: number,
  ) => Promise<readonly KnowledgeArticle[]>;
  readonly auditLog: (input: {
    readonly tenantId: string;
    readonly eventType: 'agent.action';
    readonly actorType: 'agent';
    readonly actorId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly action: string;
    readonly details: Record<string, unknown>;
    readonly timestamp: Date;
  }) => Promise<void>;
}

// ─── Tool Factory ───────────────────────────────────────────────

/**
 * Create the search-knowledge tool with injected dependencies.
 *
 * SECURITY: Query is validated for length/format before execution.
 * Results are tenant-isolated. Search activity is audit-logged.
 */
export function createSearchKnowledgeTool(deps: SearchKnowledgeDeps): AgentTool {
  return {
    name: 'search_knowledge',
    description: 'Search the internal knowledge base for articles matching a query. Returns ranked results with relevance scores. Tenant-isolated.',
    parameters: searchKnowledgeParamsSchema,
    execute: async (
      params: unknown,
      context: AgentContext,
    ): Promise<Result<unknown, AppError>> => {
      // ── Validate parameters ──
      const parsed = searchKnowledgeParamsSchema.safeParse(params);
      if (!parsed.success) {
        return err(
          new ValidationError('Invalid search parameters', {
            params: parsed.error.errors.map((e) => e.message),
          }),
        );
      }

      const { query, maxResults } = parsed.data;

      // ── Tenant-isolated search ──
      const results = await deps.searchKB(query, context.tenantId, maxResults);

      // ── Audit log — metadata only, no search content ──
      await deps.auditLog({
        tenantId: context.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: context.sessionId,
        resource: 'knowledge_base',
        resourceId: context.sessionId,
        action: 'search_knowledge',
        details: {
          resultCount: results.length,
          maxResults,
          sessionId: context.sessionId,
        },
        timestamp: new Date(),
      });

      return ok({
        results: results.map((article) => ({
          id: article.id,
          title: article.title,
          content: article.content,
          category: article.category,
          relevanceScore: article.relevanceScore,
        })),
        totalResults: results.length,
      });
    },
  };
}
