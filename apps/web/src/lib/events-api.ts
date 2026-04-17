/**
 * Event Stream API Service
 *
 * Typed wrappers over /api/v1/events endpoints.
 * Provides a read-only window into Kafka topics, consumer group lag,
 * and schema registry versions.
 *
 * SECURITY:
 * - PHI payload fields are masked server-side before API response — Rule 6
 * - Consumer access is read-only; no produce capability via this API — Rule 2
 * - All reads are audit-logged with accessor identity — Rule 3
 * - Tenant isolation enforced by JWT-derived tenant_id, never client param — Rule 2
 *
 * SOC 2 CC7.1, A1.2 | ISO 27001 A.8.16 | HIPAA §164.312(b)
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface KafkaTopic {
  readonly name: string;
  readonly partitions: number;
  readonly replicationFactor: number;
  readonly messageCount: number;
  readonly messagesPerSecond: number;
  readonly sizeBytes: number;
  readonly retentionMs: number;
  readonly lastMessageAt: string;
  readonly schemaSubject: string | null;
}

export type ConsumerGroupState = 'Stable' | 'Rebalancing' | 'Dead' | 'Empty';

export interface ConsumerGroup {
  readonly groupId: string;
  readonly topicName: string;
  readonly totalLag: number;
  readonly state: ConsumerGroupState;
  readonly membersCount: number;
}

export interface KafkaEvent {
  readonly topic: string;
  readonly partition: number;
  readonly offset: number;
  readonly timestamp: string;
  readonly key: string | null;
  readonly eventType: string;
  readonly sizeBytes: number;
  readonly schemaVersion: string | null;
  /**
   * Payload fields. PHI values are replaced with `"[MASKED — HIPAA §164.312(b)]"`
   * server-side before this response is constructed.
   */
  readonly payload: Record<string, unknown>;
}

export interface TopicStats {
  readonly totalTopics: number;
  readonly totalMessagesPerSecond: number;
  readonly totalConsumerGroups: number;
  readonly maxConsumerLag: number;
}

export interface ListEventsParams {
  readonly topic: string;
  readonly partition?: number;
  readonly eventType?: string;
  readonly limit?: number;
  readonly fromOffset?: number;
}

export interface ListEventsResponse {
  readonly items: KafkaEvent[];
  readonly hasMore: boolean;
}

// ── API Client ─────────────────────────────────────────────────────────────

export const eventsApi = {
  async listTopics(): Promise<KafkaTopic[]> {
    return apiClient.get<KafkaTopic[]>('/events/topics');
  },

  async getTopicStats(): Promise<TopicStats> {
    return apiClient.get<TopicStats>('/events/stats');
  },

  async listEvents(params: ListEventsParams): Promise<ListEventsResponse> {
    const q = new URLSearchParams({ topic: params.topic });
    if (params.partition !== undefined) q.set('partition', String(params.partition));
    if (params.eventType !== undefined && params.eventType !== '')
      q.set('eventType', params.eventType);
    q.set('limit', String(params.limit ?? 50));
    if (params.fromOffset !== undefined) q.set('fromOffset', String(params.fromOffset));
    return apiClient.get<ListEventsResponse>(`/events?${q}`);
  },

  async listConsumerGroups(topic: string): Promise<ConsumerGroup[]> {
    return apiClient.get<ConsumerGroup[]>(`/events/topics/${encodeURIComponent(topic)}/consumers`);
  },

  async getSchemaVersions(subject: string): Promise<string[]> {
    return apiClient.get<string[]>(`/events/schemas/${encodeURIComponent(subject)}/versions`);
  },
};
