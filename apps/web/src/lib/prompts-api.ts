/**
 * Prompt Templates API Service
 *
 * Typed wrappers over /api/v1/prompts endpoints.
 * Covers: template management, version history, variable schema,
 * and compliance review workflow.
 *
 * SECURITY:
 * - Template mutations WORM-logged with actor identity — Rule 3
 * - Unapproved templates cannot be assigned to production roles — Rule 9
 * - PHI must not appear in prompt templates — use {{variable}} refs — Rule 6
 * - Template render (with variable substitution) audit-logged — Rule 3
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.25 | HIPAA §164.312(a)(1)
 */

import { apiClient } from './api';
import type { AgentRole } from './ai-models-api';

// ── Types ──────────────────────────────────────────────────────────────────

export type TemplateStatus = 'draft' | 'in_review' | 'approved' | 'deprecated';

export interface TemplateVariable {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
  readonly exampleValue: string;
}

export interface PromptTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly role: AgentRole;
  readonly version: number;
  readonly content: string;
  readonly variables: readonly TemplateVariable[];
  readonly status: TemplateStatus;
  readonly tokenCount: number;
  readonly reviewedBy: string | null;
  readonly approvedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
}

export interface PromptVersion {
  readonly id: string;
  readonly templateId: string;
  readonly version: number;
  readonly content: string;
  readonly tokenCount: number;
  readonly status: TemplateStatus;
  readonly changeNote: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface PromptStats {
  readonly totalTemplates: number;
  readonly approvedTemplates: number;
  readonly pendingReview: number;
  readonly totalVersions: number;
}

export interface RenderPreviewBody {
  readonly templateId: string;
  readonly variables: Record<string, string>;
}

export interface RenderPreviewResult {
  readonly rendered: string;
  readonly tokenCount: number;
  readonly estimatedCostUsd: number;
  readonly missingVariables: readonly string[];
}

export interface SubmitReviewBody {
  readonly action: 'approve' | 'reject';
  readonly note?: string;
}

// ── API Client ─────────────────────────────────────────────────────────────

export const promptsApi = {
  async getStats(): Promise<PromptStats> {
    return apiClient.get<PromptStats>('/prompts/stats');
  },

  async listTemplates(): Promise<PromptTemplate[]> {
    return apiClient.get<PromptTemplate[]>('/prompts');
  },

  async listVersions(templateId: string): Promise<PromptVersion[]> {
    return apiClient.get<PromptVersion[]>(`/prompts/${templateId}/versions`);
  },

  async renderPreview(body: RenderPreviewBody): Promise<RenderPreviewResult> {
    return apiClient.post<RenderPreviewResult>('/prompts/render', body);
  },

  async submitReview(templateId: string, body: SubmitReviewBody): Promise<PromptTemplate> {
    return apiClient.post<PromptTemplate>(`/prompts/${templateId}/review`, body);
  },
};
