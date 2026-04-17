/**
 * Knowledge Base API Service
 *
 * Typed wrappers over /api/v1/knowledge endpoints.
 * Covers: document management, category organisation,
 * chunk-level inspection, and RAG retrieval preview.
 *
 * SECURITY:
 * - Documents may contain CONFIDENTIAL data — access logged with full trail — Rule 3
 * - PHI MUST NOT be ingested into the knowledge base — use tokenised refs — Rule 6
 * - All uploads scanned for malware before indexing — Rule 8
 * - Retrieval queries logged for audit (RAG chain evidence) — Rule 9
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.11 | HIPAA §164.312(a)(1)
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export type DocumentStatus = 'pending' | 'indexing' | 'indexed' | 'failed';
export type SourceType = 'upload' | 'url' | 'confluence' | 'notion' | 'github';
export type DocumentCategory =
  | 'product'
  | 'policy'
  | 'procedure'
  | 'faq'
  | 'legal'
  | 'technical'
  | 'training';

export interface KbDocument {
  readonly id: string;
  readonly title: string;
  readonly category: DocumentCategory;
  readonly sourceType: SourceType;
  readonly status: DocumentStatus;
  readonly fileSizeBytes: number;
  /** Number of text chunks stored in pgvector */
  readonly chunkCount: number;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  readonly createdAt: string;
  readonly indexedAt: string | null;
  readonly createdBy: string;
  /** Tags for scoped agent retrieval */
  readonly tags: readonly string[];
}

export interface KbChunk {
  readonly id: string;
  readonly documentId: string;
  readonly chunkIndex: number;
  readonly text: string;
  readonly tokenCount: number;
}

export interface KbSearchResult {
  readonly documentId: string;
  readonly documentTitle: string;
  readonly chunkId: string;
  readonly chunkIndex: number;
  readonly text: string;
  /** Cosine similarity 0.0 – 1.0 */
  readonly score: number;
  readonly tokenCount: number;
}

export interface KbStats {
  readonly totalDocuments: number;
  readonly totalChunks: number;
  readonly totalEmbeddingBytes: number;
  readonly averageRetrievalMs: number;
  readonly queriesLast24h: number;
}

export interface KbSearchParams {
  readonly query: string;
  readonly topK?: number;
  readonly category?: DocumentCategory;
  readonly minScore?: number;
}

// ── API Client ─────────────────────────────────────────────────────────────

export const knowledgeApi = {
  async getStats(): Promise<KbStats> {
    return apiClient.get<KbStats>('/knowledge/stats');
  },

  async listDocuments(): Promise<KbDocument[]> {
    return apiClient.get<KbDocument[]>('/knowledge/documents');
  },

  async deleteDocument(id: string): Promise<void> {
    return apiClient.delete(`/knowledge/documents/${id}`);
  },

  async listChunks(documentId: string): Promise<KbChunk[]> {
    return apiClient.get<KbChunk[]>(`/knowledge/documents/${documentId}/chunks`);
  },

  async search(params: KbSearchParams): Promise<KbSearchResult[]> {
    return apiClient.post<KbSearchResult[]>('/knowledge/search', params);
  },
};
