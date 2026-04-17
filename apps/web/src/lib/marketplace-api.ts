/**
 * Marketplace API Service
 *
 * Typed wrappers over /api/v1/marketplace endpoints.
 * Covers: listing, detail, install, reviews.
 *
 * Also includes admin review pipeline:
 * /api/v1/admin/marketplace/queue — list pending agents
 * /api/v1/admin/marketplace/:id/approve|reject|suspend
 *
 * SOC2 CC8.1 — Change management: agents reviewed before publishing.
 * ISO 27001 A.14.2.1 — Secure development: manifest validation.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type AgentCategory =
  | 'collections'
  | 'support'
  | 'sales'
  | 'compliance'
  | 'healthcare'
  | 'analytics'
  | 'automation';

export type AgentStatus = 'pending' | 'published' | 'suspended' | 'deprecated';
export type InstallStatus = 'installed' | 'not_installed' | 'pending';

export interface MarketplaceAgent {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly category: AgentCategory;
  readonly status: AgentStatus;
  readonly installStatus: InstallStatus;
  readonly rating: number | null;
  readonly reviewCount: number;
  readonly installCount: number;
  readonly priceMonthly: number | null;
  readonly license: string;
  readonly publishedAt: string;
  readonly updatedAt: string;
}

export interface AgentReview {
  readonly id: string;
  readonly agentId: string;
  readonly userId: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly createdAt: string;
}

export interface MarketplaceListParams {
  page?: number;
  pageSize?: number;
  category?: AgentCategory;
  status?: AgentStatus;
  search?: string;
  installed?: boolean;
}

export interface MarketplaceListResponse {
  readonly success: true;
  readonly data: MarketplaceAgent[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface ReviewListResponse {
  readonly success: true;
  readonly data: AgentReview[];
  readonly total: number;
}

// ── API Functions ──────────────────────────────────────────────────

export function listMarketplaceAgents(
  params: MarketplaceListParams = {},
): Promise<MarketplaceListResponse> {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  if (params.category !== undefined) query.set('category', params.category);
  if (params.status !== undefined) query.set('status', params.status);
  if (params.search !== undefined && params.search.length > 0) query.set('search', params.search);
  if (params.installed !== undefined) query.set('installed', String(params.installed));
  const qs = query.toString();
  return apiClient.get<MarketplaceListResponse>(`/v1/marketplace${qs.length > 0 ? `?${qs}` : ''}`);
}

export function getMarketplaceAgent(
  agentId: string,
): Promise<{ readonly success: true; readonly data: MarketplaceAgent }> {
  return apiClient.get<{ readonly success: true; readonly data: MarketplaceAgent }>(
    `/v1/marketplace/${agentId}`,
  );
}

export function installAgent(agentId: string): Promise<{ readonly success: true }> {
  return apiClient.post<{ readonly success: true }>(`/v1/marketplace/${agentId}/install`, {});
}

export async function uninstallAgent(agentId: string): Promise<void> {
  await apiClient.delete(`/v1/marketplace/${agentId}/install`);
}

export function listReviews(agentId: string): Promise<ReviewListResponse> {
  return apiClient.get<ReviewListResponse>(`/v1/marketplace/${agentId}/reviews`);
}

export function submitReview(
  agentId: string,
  body: { readonly rating: number; readonly comment?: string },
): Promise<{ readonly success: true; readonly data: AgentReview }> {
  return apiClient.post<{ readonly success: true; readonly data: AgentReview }>(
    `/v1/marketplace/${agentId}/review`,
    body,
  );
}

// ── Admin Review Pipeline ──────────────────────────────────────────

export type ReviewAgentStatus = 'draft' | 'review' | 'published' | 'suspended' | 'rejected';

export interface ReviewQueueAgent {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly license: string;
  readonly status: ReviewAgentStatus;
  readonly publisherId: string;
  readonly createdAt: string;
}

export interface ReviewActionResult {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly status: ReviewAgentStatus;
  readonly rejectionReason?: string;
}

export function listReviewQueue(): Promise<{
  readonly success: true;
  readonly data: ReviewQueueAgent[];
}> {
  return apiClient.get<{ readonly success: true; readonly data: ReviewQueueAgent[] }>(
    '/v1/admin/marketplace/queue',
  );
}

export function approveAgent(agentId: string): Promise<{
  readonly success: true;
  readonly data: ReviewActionResult;
}> {
  return apiClient.post<{ readonly success: true; readonly data: ReviewActionResult }>(
    `/v1/admin/marketplace/${agentId}/approve`,
    {},
  );
}

export function rejectAgent(
  agentId: string,
  reason: string,
): Promise<{ readonly success: true; readonly data: ReviewActionResult }> {
  return apiClient.post<{ readonly success: true; readonly data: ReviewActionResult }>(
    `/v1/admin/marketplace/${agentId}/reject`,
    { reason },
  );
}

export function suspendAgent(
  agentId: string,
  reason: string,
): Promise<{ readonly success: true; readonly data: ReviewActionResult }> {
  return apiClient.post<{ readonly success: true; readonly data: ReviewActionResult }>(
    `/v1/admin/marketplace/${agentId}/suspend`,
    { reason },
  );
}
