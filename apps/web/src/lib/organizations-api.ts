/**
 * Organizations API Service
 *
 * Typed wrappers over /api/v1/organizations endpoints.
 * Covers: CRUD + hierarchy traversal.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export interface Organization {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly slug: string;
  readonly parentId: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OrganizationNode extends Organization {
  readonly children: OrganizationNode[];
}

export interface OrganizationListResponse {
  readonly success: true;
  readonly data: Organization[];
  readonly total: number;
}

// ── API Functions ──────────────────────────────────────────────────

export function listOrganizations(): Promise<OrganizationListResponse> {
  return apiClient.get<OrganizationListResponse>('/v1/organizations');
}

export function getOrganization(
  id: string,
): Promise<{ readonly success: true; readonly data: Organization }> {
  return apiClient.get<{ readonly success: true; readonly data: Organization }>(
    `/v1/organizations/${id}`,
  );
}

export function createOrganization(body: {
  readonly name: string;
  readonly slug: string;
  readonly parentId?: string | null;
  readonly metadata?: Record<string, unknown>;
}): Promise<{ readonly success: true; readonly data: Organization }> {
  return apiClient.post<{ readonly success: true; readonly data: Organization }>(
    '/v1/organizations',
    body,
  );
}

export function updateOrganization(
  id: string,
  body: {
    readonly name?: string;
    readonly slug?: string;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<{ readonly success: true; readonly data: Organization }> {
  return apiClient.patch<{ readonly success: true; readonly data: Organization }>(
    `/v1/organizations/${id}`,
    body,
  );
}

export async function deleteOrganization(id: string): Promise<void> {
  await apiClient.delete(`/v1/organizations/${id}`);
}

export function getOrganizationHierarchy(
  id: string,
): Promise<{ readonly success: true; readonly data: OrganizationNode }> {
  return apiClient.get<{ readonly success: true; readonly data: OrganizationNode }>(
    `/v1/organizations/${id}/hierarchy`,
  );
}
