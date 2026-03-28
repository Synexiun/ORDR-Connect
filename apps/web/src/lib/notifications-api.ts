/**
 * Notifications API Service
 *
 * Typed wrappers over /api/v1/notifications endpoints.
 * Covers: list, mark-read, dismiss, mark-all-read.
 *
 * COMPLIANCE: No PHI in notification payloads — metadata only.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type NotificationType = 'hitl' | 'compliance' | 'escalation' | 'sla' | 'system';
export type NotificationSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface Notification {
  readonly id: string;
  readonly type: NotificationType;
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly description: string;
  readonly timestamp: string;
  readonly read: boolean;
  readonly dismissed: boolean;
  readonly actionLabel?: string;
  readonly actionRoute?: string;
  readonly metadata?: Record<string, string>;
}

export interface NotificationListResponse {
  readonly success: true;
  readonly data: Notification[];
  readonly meta: {
    readonly total: number;
    readonly unreadCount: number;
  };
}

export interface NotificationResponse {
  readonly success: true;
  readonly data: Notification;
}

export interface MarkReadAllResponse {
  readonly success: true;
  readonly data: { readonly markedRead: number };
}

// ── API calls ──────────────────────────────────────────────────────

export interface ListNotificationsParams {
  type?: NotificationType;
  read?: boolean;
  includeDismissed?: boolean;
  limit?: number;
}

export function listNotifications(
  params?: ListNotificationsParams,
): Promise<NotificationListResponse> {
  const query = new URLSearchParams();
  if (params?.type !== undefined) query.set('type', params.type);
  if (params?.read !== undefined) query.set('read', String(params.read));
  if (params?.includeDismissed !== undefined)
    query.set('includeDismissed', String(params.includeDismissed));
  if (params?.limit !== undefined) query.set('limit', String(params.limit));

  const qs = query.toString();
  return apiClient.get<NotificationListResponse>(
    `/v1/notifications${qs.length > 0 ? `?${qs}` : ''}`,
  );
}

export function markNotificationRead(id: string): Promise<NotificationResponse> {
  return apiClient.patch<NotificationResponse>(
    `/v1/notifications/${encodeURIComponent(id)}/read`,
    {},
  );
}

export function dismissNotification(id: string): Promise<NotificationResponse> {
  return apiClient.patch<NotificationResponse>(
    `/v1/notifications/${encodeURIComponent(id)}/dismiss`,
    {},
  );
}

export function markAllNotificationsRead(): Promise<MarkReadAllResponse> {
  return apiClient.post<MarkReadAllResponse>('/v1/notifications/mark-read-all', {});
}
