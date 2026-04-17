/**
 * Contact Segments API Service
 *
 * Typed wrappers over /api/v1/segments endpoints.
 * Covers: segment CRUD, filter builder, and live member-count preview.
 *
 * SECURITY:
 * - All segments are tenant-scoped via JWT — Rule 2
 * - Segment mutations WORM-logged with actor identity — Rule 3
 * - Filter values must not contain PHI — Rule 6
 * - Preview count queries run server-side with tenant RLS — Rule 2
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.6 | HIPAA §164.312(a)(1)
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export type SegmentField =
  | 'channel'
  | 'tag'
  | 'region'
  | 'plan_tier'
  | 'engagement_score'
  | 'contact_count'
  | 'days_since_contact'
  | 'lifetime_value'
  | 'language'
  | 'status'
  | 'custom_field';

export type SegmentOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'contains'
  | 'not_contains'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'is_not_null';

export type SegmentFilterLogic = 'all' | 'any';

export type SegmentStatus = 'active' | 'archived' | 'draft';

export interface SegmentFilter {
  readonly id: string;
  readonly field: SegmentField;
  readonly operator: SegmentOperator;
  /** Comma-separated for 'in'/'not_in' operators */
  readonly value: string;
}

export interface Segment {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string;
  readonly filters: SegmentFilter[];
  readonly filterLogic: SegmentFilterLogic;
  readonly memberCount: number;
  readonly status: SegmentStatus;
  /** System segments (e.g. "All Contacts") cannot be deleted */
  readonly isSystem: boolean;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
}

export interface SegmentPreview {
  readonly memberCount: number;
  readonly sampleCustomerIds: readonly string[];
}

export interface CreateSegmentBody {
  readonly name: string;
  readonly description: string;
  readonly filters: Omit<SegmentFilter, 'id'>[];
  readonly filterLogic: SegmentFilterLogic;
}

export interface UpdateSegmentBody {
  readonly name?: string;
  readonly description?: string;
  readonly filters?: Omit<SegmentFilter, 'id'>[];
  readonly filterLogic?: SegmentFilterLogic;
  readonly status?: SegmentStatus;
}

// ── API Client ─────────────────────────────────────────────────────────────

export const segmentsApi = {
  async listSegments(): Promise<Segment[]> {
    return apiClient.get<Segment[]>('/segments');
  },

  async getSegment(id: string): Promise<Segment> {
    return apiClient.get<Segment>(`/segments/${id}`);
  },

  async createSegment(body: CreateSegmentBody): Promise<Segment> {
    return apiClient.post<Segment>('/segments', body);
  },

  async updateSegment(id: string, body: UpdateSegmentBody): Promise<Segment> {
    return apiClient.put<Segment>(`/segments/${id}`, body);
  },

  async deleteSegment(id: string): Promise<void> {
    await apiClient.delete<unknown>(`/segments/${id}`);
  },

  async previewSegment(
    filters: Omit<SegmentFilter, 'id'>[],
    filterLogic: SegmentFilterLogic,
  ): Promise<SegmentPreview> {
    return apiClient.post<SegmentPreview>('/segments/preview', { filters, filterLogic });
  },
};
